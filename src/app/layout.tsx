import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppNav } from "@/components/AppNav";
import { DiagnosticsProvider } from "@/components/DiagnosticsProvider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Torque · AI diagnostics & tuning",
  description: "Plug in an OBD-II adapter for AI diagnostics, build simulated ECU tunes with an agent team, and test them in a car simulator.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <DiagnosticsProvider>
          <AppNav />
          {children}
        </DiagnosticsProvider>
      </body>
    </html>
  );
}
