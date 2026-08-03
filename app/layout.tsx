import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";

const title = "EMS Relay | 심혈관 응급환자 실시간 인계";
const description =
  "구급대원, 이송조정 상황실, 병원이 확인된 환자정보와 타임라인을 공유하고 구급활동 기록 초안까지 연결하는 응급환자 이송·인계 MVP";
const productionOrigin = "https://main.d2edch3bt6kxej.amplifyapp.com";

export const metadata: Metadata = {
  metadataBase: new URL(productionOrigin),
  title,
  description,
  icons: {
    icon: "/ems-relay-icon.png",
    shortcut: "/ems-relay-icon.png",
    apple: "/ems-relay-icon.png",
  },
  manifest: "/manifest.webmanifest",
  alternates: { canonical: productionOrigin },
  openGraph: {
    title,
    description,
    type: "website",
    locale: "ko_KR",
    url: productionOrigin,
    images: [{ url: "/og.png", width: 1728, height: 900, alt: "EMS Relay 응급환자 정보 연결" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
