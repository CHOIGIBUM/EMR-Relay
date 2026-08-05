"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, MapPinned } from "lucide-react";
import { buildKakaoDirectionsLink } from "@/lib/v2/map";
import type { Coordinate } from "@/lib/v2/types";
import styles from "./KakaoRouteMap.module.css";

export type KakaoMapInstance = {
  setBounds: (bounds: unknown) => void;
  relayout: () => void;
  panTo: (position: unknown) => void;
  getLevel: () => number;
  setLevel: (level: number, options?: { animate?: boolean; anchor?: unknown }) => void;
  setMinLevel: (level: number) => void;
  setMaxLevel: (level: number) => void;
};
export type KakaoMapsApi = {
  load: (callback: () => void) => void;
  LatLng: new (latitude: number, longitude: number) => unknown;
  LatLngBounds: new () => { extend: (position: unknown) => void };
  Map: new (container: HTMLElement, options: { center: unknown; level: number }) => KakaoMapInstance;
  Marker: new (options: { map: KakaoMapInstance; position: unknown; title: string }) => unknown;
  CustomOverlay: new (options: { map: KakaoMapInstance; position: unknown; content: HTMLElement; yAnchor?: number }) => unknown;
  Polyline: new (options: { map: KakaoMapInstance; path: unknown[]; strokeWeight: number; strokeColor: string; strokeOpacity: number; strokeStyle: string }) => unknown;
  Circle: new (options: { map: KakaoMapInstance; center: unknown; radius: number; strokeWeight: number; strokeColor: string; strokeOpacity: number; strokeStyle: string; fillColor: string; fillOpacity: number }) => unknown;
};

type KakaoWindow = Window & { kakao?: { maps: KakaoMapsApi } };

const SCRIPT_ID = "ems-relay-kakao-map-sdk";
let kakaoMapsPromise: Promise<KakaoMapsApi> | null = null;

export function loadKakaoMaps(appKey: string) {
  if (kakaoMapsPromise) return kakaoMapsPromise;

  kakaoMapsPromise = new Promise<KakaoMapsApi>((resolve, reject) => {
    const ready = () => {
      const kakao = (window as KakaoWindow).kakao;
      if (!kakao?.maps) return reject(new Error("KAKAO_MAP_SDK_UNAVAILABLE"));
      kakao.maps.load(() => resolve(kakao.maps));
    };
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if ((window as KakaoWindow).kakao?.maps) ready();
      else {
        existing.addEventListener("load", ready, { once: true });
        existing.addEventListener("error", () => reject(new Error("KAKAO_MAP_SDK_LOAD_FAILED")), { once: true });
      }
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.addEventListener("load", ready, { once: true });
    script.addEventListener("error", () => reject(new Error("KAKAO_MAP_SDK_LOAD_FAILED")), { once: true });
    document.head.appendChild(script);
  });

  kakaoMapsPromise = kakaoMapsPromise.catch((error) => {
    kakaoMapsPromise = null;
    document.getElementById(SCRIPT_ID)?.remove();
    throw error;
  });
  return kakaoMapsPromise;
}

export type KakaoRouteMapProps = {
  origin: Coordinate;
  destination: Coordinate;
  destinationName: string;
  originName?: string;
  path?: readonly Coordinate[];
};

export default function KakaoRouteMap({ origin, destination, destinationName, originName = "출발지", path }: KakaoRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JAVASCRIPT_KEY?.trim() ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!appKey || !containerRef.current) {
      const timer = window.setTimeout(() => setStatus("unavailable"), 0);
      return () => window.clearTimeout(timer);
    }
    loadKakaoMaps(appKey).then((maps) => {
      if (cancelled || !containerRef.current) return;
      const start = new maps.LatLng(origin.latitude, origin.longitude);
      const end = new maps.LatLng(destination.latitude, destination.longitude);
      const map = new maps.Map(containerRef.current, { center: start, level: 7 });
      new maps.Marker({ map, position: start, title: originName });
      new maps.Marker({ map, position: end, title: destinationName });
      const originLabel = document.createElement("div");
      originLabel.className = `${styles.routeLabel} ${styles.routeLabelOrigin}`;
      originLabel.textContent = originName;
      const destinationLabel = document.createElement("div");
      destinationLabel.className = `${styles.routeLabel} ${styles.routeLabelDestination}`;
      destinationLabel.textContent = destinationName;
      new maps.CustomOverlay({ map, position: start, content: originLabel, yAnchor: 1.75 });
      new maps.CustomOverlay({ map, position: end, content: destinationLabel, yAnchor: 1.75 });

      const hasRoadPath = Boolean(path && path.length > 1);
      const routeCoordinates: readonly Coordinate[] = path && path.length > 1 ? path : [
        { latitude: origin.latitude, longitude: origin.longitude },
        { latitude: destination.latitude, longitude: destination.longitude },
      ];
      const roadPath = routeCoordinates.map((point) => new maps.LatLng(point.latitude, point.longitude));
      new maps.Polyline({
        map,
        path: roadPath,
        strokeWeight: hasRoadPath ? 6 : 4,
        strokeColor: "#087f8c",
        strokeOpacity: hasRoadPath ? 0.9 : 0.72,
        strokeStyle: hasRoadPath ? "solid" : "shortdash",
      });
      const bounds = new maps.LatLngBounds();
      roadPath.forEach((point) => bounds.extend(point));
      map.setBounds(bounds);
      window.setTimeout(() => map.relayout(), 0);
      setStatus("ready");
    }).catch(() => {
      if (!cancelled) setStatus("unavailable");
    });
    return () => { cancelled = true; };
  }, [appKey, destination.latitude, destination.longitude, destinationName, origin.latitude, origin.longitude, originName, path]);

  const directionsUrl = buildKakaoDirectionsLink(
    { ...origin, name: originName },
    { ...destination, name: destinationName },
  );

  return (
    <div className={styles.shell} data-status={status}>
      <div className={styles.map} ref={containerRef} role="img" aria-label={`${originName}에서 ${destinationName}까지 카카오 지도`} />
      {status !== "ready" ? (
        <div className={styles.fallback}>
          <MapPinned size={26} />
          <strong>{status === "loading" ? "지도를 불러오는 중" : "지도를 표시할 수 없습니다"}</strong>
          <small>경로 버튼으로 카카오맵 길찾기를 바로 열 수 있습니다.</small>
        </div>
      ) : null}
      <a className={styles.openDirections} href={directionsUrl} target="_blank" rel="noreferrer">
        <ExternalLink size={13} /> 카카오맵 길찾기
      </a>
    </div>
  );
}
