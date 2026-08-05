"use client";

import { useEffect, useRef, useState } from "react";
import { Hospital, MapPin } from "lucide-react";
import { loadKakaoMaps } from "./KakaoRouteMap";
import type { Coordinate, HospitalRequestStatus, MatchingExpansionReason, MatchingStateStatus } from "@/lib/v2/types";
import styles from "./V2.module.css";

export type MatchMapMarker = {
  id: string;
  name: string;
  location: Coordinate;
  status: HospitalRequestStatus;
};

const expansionReasonLabel: Record<MatchingExpansionReason, string> = {
  INITIAL_REQUEST: "최초 요청",
  ALL_DECLINED: "모든 병원 수용 곤란",
  RESPONSE_TIMEOUT: "회신 대기 종료",
  MANUAL_REQUEST: "구급대원 범위 확대",
  NO_CANDIDATES: "현재 반경 후보 없음",
  MAX_RADIUS_REACHED: "최대 반경 도달",
  ACCEPTED: "수용 가능 회신",
};

function expansionTime(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export default function HospitalMatchMap({
  scene,
  sceneAddress,
  markers,
  radiusKm,
  nextRadiusKm,
  nextExpansionAt,
  expansionReason,
  matchingStatus,
  expanding = false,
}: {
  scene: Coordinate;
  sceneAddress: string;
  markers: MatchMapMarker[];
  radiusKm: number;
  nextRadiusKm?: number;
  nextExpansionAt?: string;
  expansionReason?: MatchingExpansionReason;
  matchingStatus?: MatchingStateStatus;
  expanding?: boolean;
}) {
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

      if (nextRadiusKm) {
        new maps.Circle({
          map,
          center,
          radius: nextRadiusKm * 1_000,
          strokeWeight: 1,
          strokeColor: "#5f9fbd",
          strokeOpacity: 0.52,
          strokeStyle: "shortdash",
          fillColor: "#80bce0",
          fillOpacity: 0.025,
        });
      }
      if (radiusKm > 0) {
        new maps.Circle({
          map,
          center,
          radius: radiusKm * 1_000,
          strokeWeight: 2,
          strokeColor: "#197cc9",
          strokeOpacity: 0.78,
          strokeStyle: "solid",
          fillColor: "#4da5df",
          fillOpacity: 0.065,
        });
      }

      const sceneNode = document.createElement("div");
      sceneNode.className = `${styles.mapPin} ${styles.mapPinScene}`;
      sceneNode.textContent = "현장";
      new maps.CustomOverlay({ map, position: center, content: sceneNode, yAnchor: 1 });
      if (expanding) {
        const pulseNode = document.createElement("div");
        pulseNode.className = styles.mapRangePulse;
        pulseNode.setAttribute("aria-hidden", "true");
        new maps.CustomOverlay({ map, position: center, content: pulseNode, yAnchor: .5 });
      }

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
      // Keep nearby hospital labels readable. The geographic circles may extend
      // beyond the viewport; the radar pulse and range status communicate scope.
      map.setBounds(bounds);
      window.setTimeout(() => map.relayout(), 0);
      setStatus("ready");
    }).catch(() => {
      if (!cancelled) setStatus("unavailable");
    });
    return () => { cancelled = true; };
  }, [appKey, expanding, markers, nextRadiusKm, radiusKm, scene.latitude, scene.longitude]);

  const scheduledAt = expansionTime(nextExpansionAt);
  const scheduledPrefix = scheduledAt ? `${scheduledAt} · ` : "";
  const nextRangeText = nextRadiusKm
    ? expansionReason === "INITIAL_REQUEST"
      ? `${scheduledPrefix}최초 요청 ${nextRadiusKm}km 실행 대기`
      : expansionReason === "MANUAL_REQUEST"
        ? `${scheduledPrefix}수동 확대 · 다음 ${nextRadiusKm}km`
        : expansionReason === "ALL_DECLINED" || expansionReason === "NO_CANDIDATES"
          ? `${scheduledPrefix}즉시 확대 · 다음 ${nextRadiusKm}km`
          : expansionReason === "RESPONSE_TIMEOUT"
            ? `${scheduledPrefix}자동 확대 · 다음 ${nextRadiusKm}km`
            : `다음 ${nextRadiusKm}km 확대 대기`
    : matchingStatus === "ACCEPTED"
      ? "수용 가능 회신 확인"
      : matchingStatus === "EXHAUSTED"
        ? "최대 요청 범위 확인 완료"
        : "최대 요청 범위";

  return (
    <section className={styles.liveMatchMap} data-status={status}>
      <div ref={containerRef} className={styles.liveMatchCanvas} role="img" aria-label={`${sceneAddress} 주변 병원 요청 현황`} />
      <div className={styles.matchRangeStatus}>
        <strong>현재 요청 반경 {radiusKm}km{radiusKm === 0 ? " · 실행 전" : ""}</strong>
        <span>{nextRangeText}</span>
        {expansionReason ? <span>현재 요청: {expansionReasonLabel[expansionReason]}</span> : null}
      </div>
      {status !== "ready" ? <div className={styles.mapFallback}>
        <MapPin /><strong>{status === "loading" ? "카카오 지도를 불러오는 중" : "지도를 표시할 수 없습니다"}</strong><small>병원별 거리·ETA와 회신 상태를 목록에서 확인하세요.</small>
      </div> : null}
      <p className={styles.matchExpansionRule}>모두 수용 곤란이면 즉시 확대 · 미회신이 남으면 30초 후 자동 확대</p>
      <footer><span><i data-status="REQUESTED" /> 요청 중</span><span><i data-status="VIEWED" /> 열람</span><span><i data-status="ACCEPTED" /> 수용 가능</span><span><i data-status="DECLINED" /> 수용 곤란</span></footer>
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
