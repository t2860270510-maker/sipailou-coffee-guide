import type { Metadata } from "next";
import { Manrope, Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";

import "./globals.css";

const sans = Noto_Sans_SC({
  variable: "--font-sans",
  weight: ["300", "400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

const accent = Manrope({
  variable: "--font-accent",
  subsets: ["latin"],
  display: "swap",
});

const display = Noto_Serif_SC({
  variable: "--font-display",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "四牌楼咖啡指北",
  description: "输入一句需求，快速缩到四牌楼校区周边更退合你的两家咖啡店。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${sans.variable} ${accent.variable} ${display.variable}`}>
        {children}
      </body>
    </html>
  );
}
