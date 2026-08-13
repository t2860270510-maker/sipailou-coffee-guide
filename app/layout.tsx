import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "四牌楼咖啡指北",
  description: "输入一句需求，快速缩到四牌楼校区周边更适合你的两家咖啡店。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
