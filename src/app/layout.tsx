import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QRcode AR",
  description: "Persistent GLB project workspace with QR codes and MindAR image-target AR links."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
