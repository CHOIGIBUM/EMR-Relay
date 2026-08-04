"use client";

import { useEffect, useRef, useState } from "react";
import { Hospital, MapPin } from "lucide-react";
import { loadKakaoMaps } from "./KakaoRouteMap";
import type { Coordinate, HospitalRequestStatus } from "@/lib/v2/types";
import styles from "./V2.module.css";

export type MatchMapMarker = {
  id: string;
  name: string;
  location: Coordinate;
  status: HospitalRequestStatus;
};

export default function HospitalMatchMap({ scene, sceneAddress, markers }: { scene: Coordinate; sceneAddress: string; markers: MatchMapMarker[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JAVASCRIPT_KEY?.trim() ?? "";

  useEffect(() => {
    let cancelled = false;
    if (!appKey || !containerRef.current) {
      setStatus("unavailable");
      return;
    }
    loadKakaoMaps(appKey).then((maps) => {
      if (cancelled || !containerRef.current) return;
      const center = new maps.LatLng(scene.latitude, scene.longitude);
      const map = new maps.Map(containerRef.current, { center, level: 8 });
      const bounds = new maps.LatLngBounds();
      bounds.extend(center);

      const sceneNode = document.createElement("div");
      sceneNode.className = `${styles.mapPin} ${styles.mapPinScene}`;
      sceneNode.textContent = "현장";
      new maps.CustomOverlay({ map, position: center, content: sceneNode, yAnchor: 1 });

      markers.forEach((marker) => {
        const position = new maps.LatLng(marker.location.latitude, marker.location.longitude);
        const node = document.createElement("button");
        node.type = "button";
        node.className = styles.mapPin;
        node.dataset.status = marker.status;
        node.textContent = marker.name;
        node.title = `${marker.name} · ${label(marker.status)}`;
        new maps.CustomOverlay({ map, position, content: node, yAnchor: 1 });
        bounds.extend(position);
      });
      map.setBounds(bounds);
      window.setTimeout(() => map.relayout(), 0);
      setStatus("ready");
    }).catch(() => {
      if (!cancelled) setStatus("unavailable");
    });
    return () => { cancelled = true; };
  }, [appKey, markers, scene.latitude, scene.longitude]);

  return (
    <section className={styles.liveMatchMap} data-status={status}>
      <div ref={containerRef} className={styles.liveMatchCanvas} role="img" aria-label={`${sceneAddress} 주변 병원 요청 현황`} />
      {status !== "ready" ? <div className={styles.mapFallback}>
        <MapPin /><strong>{status === "loading" ? "카카오 지도를 불러오는 중" : "지도를 표시할 수 없습니다"}</strong><small>병원별 거리·ETA와 회신 상태를 목록에서 확인하세요.</small>
      </div> : null}
      <footer><span><i data-status="REQUESTED" /> 요청·열람</span><span><i data-status="ACCEPTED" /> 수용 가능</span><span><i data-status="DECLINED" /> 수용 곤란</span></footer>
      {status === "unavailable" ? <div className={styles.mapFallbackList}>{markers.map((marker) => <span key={marker.id}><Hospital /> {marker.name}<b data-status={marker.status}>{label(marker.status)}</b></span>)}</div> : null}
    </section>
  );
}

function label(status: HospitalRequestStatus) {
  if (status === "ACCEPTED") return "수용 가능";
  if (status === "DECLINED") return "수용 곤란";
  if (status === "VIEWED") return "열람";
  if (status === "CLOSED") return "요청 종료";
  return "요청 중";
}
