import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/bottom-nav";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "공연 스케줄",
  description: "연극·뮤지컬 공연 일정과 회차별 캐스팅을 한곳에서",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} h-full antialiased`}>
      <body className="bg-background min-h-full font-sans">
        {/* 하단 탭바 높이만큼 여백을 준다 */}
        <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-24">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
