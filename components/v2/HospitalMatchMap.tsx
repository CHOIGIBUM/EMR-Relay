"use client";

import { useEffect, useRef, useState } from "react";
import { Hospital, MapPin } from "lucide-react";
import { loadKakaoMaps } from "./KakaoRouteMap";
import type { Coordinate, HospitalRequestStatus, MatchingExpansionReason, MatchingStateStatus } from "@/lib/v2/types";
import styles from "./V2.module.css";

export type MatchMapMarker = {
  id: string;
  name: string;
  address?: string;
  location: Coordinate;
  status: HospitalRequestStatus;
  distanceKm: number;
  etaMinutes: number;
};

const MIN_MAP_LEVEL = 5;
const MAX_MAP_LEVEL = 11;
const SELECTED_HOSPITAL_LEVEL = 8;

const collisionOffsets = [
  [0, 0],
  [18, 0],
  [-18, 0],
  [0, 18],
  [0, -18],
  [13, 13],
  [-13, 13],
  [13, -13],
  [-13, -13],
] as const;

export function initialHospitalMapLevel(radiusKm: number) {
  const level = radiusKm <= 15 ? 7 : radiusKm <= 30 ? 8 : radiusKm <= 60 ? 9 : 10;
  return Math.min(MAX_MAP_LEVEL, Math.max(MIN_MAP_LEVEL, level));
}

function collisionOffset(marker: MatchMapMarker, occupiedCells: Map<string, number>) {
  // Hospitals sharing a roughly 110 m map cell are spread by a few screen pixels.
  // Their geographic coordinates remain unchanged and the information card keeps
  // the exact route distance/ETA supplied by the backend.
  const cell = `${marker.location.latitude.toFixed(3)}:${marker.location.longitude.toFixed(3)}`;
  const index = occupiedCells.get(cell) ?? 0;
  occupiedCells.set(cell, index + 1);
  return collisionOffsets[index % collisionOffsets.length];
}

const expansionReasonLabel: Record<MatchingExpansionReason, string> = {
  INITIAL_REQUEST: "최초 요청",
  ALL_DECLINED: "모든 병원 수용 곤란",
  RESPONSE_TIMEOUT: "회신 대기 종료",
  MANUAL_REQUEST: "구급대원 범위 확대",
  NO_CANDIDATES: "현재 반경 후보 없음",
  MAX_RADIUS_REACHED: "최대 반경 도달",
  ACCEPTED: "수용 가능 회신",
};

export default function HospitalMatchMap({
  scene,
  sceneAddress,
  markers,
  radiusKm,
  nextRadiusKm,
  expansionReason,
  matchingStatus,
  expanding = false,
}: {
  scene: Coordinate;
  sceneAddress: string;
  markers: MatchMapMarker[];
  radiusKm: number;
  nextRadiusKm?: number;
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
      const map = new maps.Map(containerRef.current, {
        center,
        level: initialHospitalMapLevel(radiusKm),
      });
      map.setMinLevel(MIN_MAP_LEVEL);
      map.setMaxLevel(MAX_MAP_LEVEL);

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

      const occupiedCells = new Map<string, number>();
      const bounds = new maps.LatLngBounds();
      bounds.extend(center);
      let activeMarkerNode: HTMLDivElement | null = null;

      markers.forEach((marker) => {
        const position = new maps.LatLng(marker.location.latitude, marker.location.longitude);
        bounds.extend(position);
        const [offsetX, offsetY] = collisionOffset(marker, occupiedCells);
        const overlayNode = document.createElement("div");
        overlayNode.className = styles.mapHospitalOverlay;
        overlayNode.dataset.status = marker.status;
        overlayNode.style.setProperty("--map-marker-x", `${offsetX}px`);
        overlayNode.style.setProperty("--map-marker-y", `${offsetY}px`);

        const markerButton = document.createElement("button");
        markerButton.type = "button";
        markerButton.className = styles.mapMarkerDot;
        markerButton.title = `${marker.name} · ${label(marker.status)}`;
        markerButton.setAttribute("aria-label", `${marker.name}, ${label(marker.status)}, ${marker.etaMinutes}분, ${marker.distanceKm.toFixed(1)}km`);
        markerButton.setAttribute("aria-expanded", "false");

        const information = document.createElement("article");
        information.className = styles.mapMarkerInfo;
        information.setAttribute("role", "dialog");
        information.setAttribute("aria-label", `${marker.name} 병원 요청 정보`);
        information.innerHTML = `<strong></strong><span class="${styles.mapMarkerStatus}"></span><dl><div><dt>예상 이동</dt><dd></dd></div><div><dt>도로 거리</dt><dd></dd></div></dl>`;
        const nameNode = information.querySelector("strong");
        const statusNode = information.querySelector(`.${styles.mapMarkerStatus}`);
        const values = information.querySelectorAll("dd");
        if (nameNode) nameNode.textContent = marker.name;
        if (statusNode) statusNode.textContent = label(marker.status);
        if (values[0]) values[0].textContent = `${marker.etaMinutes}분`;
        if (values[1]) values[1].textContent = `${marker.distanceKm.toFixed(1)}km`;
        if (marker.address) {
          const addressNode = document.createElement("p");
          addressNode.textContent = marker.address;
          information.appendChild(addressNode);
        }

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = styles.mapMarkerClose;
        closeButton.setAttribute("aria-label", `${marker.name} 정보 닫기`);
        closeButton.textContent = "×";
        information.appendChild(closeButton);

        const closeInformation = () => {
          overlayNode.dataset.selected = "false";
          markerButton.setAttribute("aria-expanded", "false");
          if (activeMarkerNode === overlayNode) activeMarkerNode = null;
        };
        markerButton.addEventListener("click", () => {
          if (activeMarkerNode && activeMarkerNode !== overlayNode) {
            activeMarkerNode.dataset.selected = "false";
            activeMarkerNode.querySelector("button")?.setAttribute("aria-expanded", "false");
          }
          const willOpen = overlayNode.dataset.selected !== "true";
          overlayNode.dataset.selected = String(willOpen);
          markerButton.setAttribute("aria-expanded", String(willOpen));
          activeMarkerNode = willOpen ? overlayNode : null;
          if (willOpen) {
            map.panTo(position);
            if (map.getLevel() > SELECTED_HOSPITAL_LEVEL) {
              map.setLevel(SELECTED_HOSPITAL_LEVEL, { animate: true, anchor: position });
            }
          }
        });
        closeButton.addEventListener("click", (event) => {
          event.stopPropagation();
          closeInformation();
        });

        overlayNode.append(markerButton, information);
        new maps.CustomOverlay({ map, position, content: overlayNode, yAnchor: 0.5 });
      });
      // Fit the scene and every actually requested hospital. The theoretical
      // radius circle is intentionally excluded so a 30 km request cannot be
      // mistaken for a 120 km map view.
      window.setTimeout(() => {
        map.relayout();
        if (markers.length > 0) map.setBounds(bounds);
      }, 0);
      setStatus("ready");
    }).catch(() => {
      if (!cancelled) setStatus("unavailable");
    });
    return () => { cancelled = true; };
  }, [appKey, expanding, markers, nextRadiusKm, radiusKm, scene.latitude, scene.longitude]);

  const nextRangeText = nextRadiusKm
    ? expansionReason === "INITIAL_REQUEST"
      ? `다음 ${nextRadiusKm}km 확대 가능`
      : expansionReason === "MANUAL_REQUEST"
        ? `현재 ${radiusKm}km 요청 완료 · 다음 ${nextRadiusKm}km`
        : expansionReason === "ALL_DECLINED" || expansionReason === "NO_CANDIDATES"
          ? `현재 반경 회신 종료 · 다음 ${nextRadiusKm}km 확대 가능`
          : `다음 ${nextRadiusKm}km 확대 가능`
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
      <p className={styles.matchExpansionRule}>요청 범위 확대 버튼을 누를 때마다 15 → 30 → 60 → 120km로 한 단계씩 확대</p>
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
