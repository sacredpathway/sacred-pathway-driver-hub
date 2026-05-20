import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Driver Hub — Sacred Pathway",
  description: "Trucking ops, loads, and CPA-ready exports — Cloud Sync dashboard.",
  applicationName: "Driver Hub",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#111111",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh bg-sp-background text-sp-textPrimary font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
