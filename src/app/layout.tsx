import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { DiagnosticsProvider } from "@/components/DiagnosticsProvider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Torque · AI car diagnostics",
  description: "Plug in an OBD-II adapter and an AI technician diagnoses your car.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <DiagnosticsProvider>
          <AppShell>{children}</AppShell>
        </DiagnosticsProvider>
      </body>
    </html>
  );
}
