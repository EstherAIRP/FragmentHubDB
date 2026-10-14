import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "FragmentHub",
  description: "Private GitHub-backed fragment management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
