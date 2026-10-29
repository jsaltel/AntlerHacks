import type Anthropic from "@anthropic-ai/sdk";

export type AttachmentKind = "image" | "log";
export type ChatAttachment = { name: string; kind: AttachmentKind; url: string };

const IMAGE_MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const LOG_TEXT_MAX = 200_000;

export function kindOf(file: File): AttachmentKind {
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|bmp|svg)$/i.test(file.name)) return "image";
  return "log";
}

export function isAttachable(file: File) {
  if (file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)) return false;
  if (file.type.startsWith("image/")) return true;
  if (/^(text\/|application\/json)/.test(file.type)) return true;
  return /\.(png|jpe?g|gif|webp|heic|bmp|svg|log|txt|csv|json)$/i.test(file.name);
}

const MAX_IMAGE_EDGE = 1568;

function dataUrlToBase64(dataUrl: string) {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return dataUrlToBase64(canvas.toDataURL("image/jpeg", 0.85));
}

function drawScaled(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw image");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasToJpeg(canvas);
}

async function fileToBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
  return dataUrlToBase64(dataUrl);
}

async function imageToJpegBase64(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return drawScaled(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Could not decode image"));
        el.src = url;
      });
      return drawScaled(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function imageBlock(file: File): Promise<Anthropic.Beta.BetaImageBlockParam> {
  try {
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: await imageToJpegBase64(file) } };
  } catch {
    if (!IMAGE_MEDIA.has(file.type) && file.type !== "image/jpg") throw new Error(`Could not decode ${file.name}`);
    return { type: "image", source: { type: "base64", media_type: file.type === "image/jpg" ? "image/jpeg" : (file.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp"), data: await fileToBase64(file) } };
  }
}

/** Turn attached files into Claude content blocks (images and log/text files). */
export async function filesToContent(files: File[]): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const file of files) {
    if (!isAttachable(file)) continue;
    try {
      if (kindOf(file) === "image") {
        blocks.push(await imageBlock(file));
      } else {
        const raw = await file.text();
        const data = raw.length > LOG_TEXT_MAX ? `${raw.slice(0, LOG_TEXT_MAX)}\n\n[truncated after ${LOG_TEXT_MAX} characters]` : raw;
        blocks.push({ type: "document", title: file.name, source: { type: "text", media_type: "text/plain", data } });
      }
    } catch {
      blocks.push({ type: "text", text: `[Could not attach "${file.name}".]` });
    }
  }
  return blocks;
}
