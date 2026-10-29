import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Chromium will refuse Web Bluetooth / Web Serial if a parent iframe or a
  // default Permissions-Policy omits them. Declare them explicitly so Chrome
  // (and Cursor's preview, if the iframe allows it) can prompt.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: "bluetooth=(self), serial=(self), hid=(self), usb=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
