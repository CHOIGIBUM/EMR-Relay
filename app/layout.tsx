import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";

const title = "EMS Relay | 응급환자 병원 연계";
const description =
  "구급대원과 병원 수용 담당자가 확인된 환자 카드와 병원 회신을 실시간으로 공유하는 응급환자 이송 연계 서비스";
const productionOrigin = "https://main.d1b1dqlcfz85e3.amplifyapp.com";

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
