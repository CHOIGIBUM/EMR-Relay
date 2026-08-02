import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "EMS Relay | 급성 뇌졸중 의심 환자 정보 연결";
const description =
  "구급대원, 이송조정 상황실, 병원이 하나의 확인된 환자정보와 타임라인을 공유하는 응급환자 이송·인계 MVP";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title,
    description,
    icons: {
      icon: "/ems-relay-icon.png",
      shortcut: "/ems-relay-icon.png",
      apple: "/ems-relay-icon.png",
    },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ko_KR",
      images: [{ url: imageUrl, width: 1728, height: 900, alt: "EMS Relay 응급환자 정보 연결" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
