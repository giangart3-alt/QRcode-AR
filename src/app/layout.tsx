import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QRcode AR",
  description: "Upload GLB files, generate QR codes, and open models in mobile AR."
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
