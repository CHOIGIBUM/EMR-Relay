export type MatchCandidate = {
  hospital_id: string;
  display_name: string;
  distance_km: number;
  eta_minutes: number | null;
  [key: string]: unknown;
};

export const INITIAL_MATCHING_RADIUS_KM = 15;
export const MAX_MATCHING_RADIUS_KM = 120;

export function selectWaveCandidates(
  candidates: MatchCandidate[],
  radiusKm: number,
  excludedHospitalIds: ReadonlySet<string>,
  limit = 3,
  previousRadiusKm = 0,
) {
  return candidates
    .filter((candidate) => Number.isFinite(candidate.distance_km)
      && candidate.distance_km > previousRadiusKm
      && candidate.distance_km <= radiusKm
      && !excludedHospitalIds.has(candidate.hospital_id))
    .sort((left, right) => {
      const leftEta = left.eta_minutes ?? Number.POSITIVE_INFINITY;
      const rightEta = right.eta_minutes ?? Number.POSITIVE_INFINITY;
      return leftEta - rightEta || left.distance_km - right.distance_km;
    })
    .slice(0, Math.max(1, limit));
}

export function nextWaveRadius(currentRadiusKm: number, maxRadiusKm: number) {
  if (currentRadiusKm >= maxRadiusKm) return null;
  return Math.min(maxRadiusKm, Math.max(currentRadiusKm + 10, currentRadiusKm * 2));
}

export function shouldStopExpansion(input: { destinationHospitalId?: string; acceptedRequestCount: number }) {
  return Boolean(input.destinationHospitalId) || input.acceptedRequestCount > 0;
}

export type ExpansionRequestStatus =
  | "REQUESTED"
  | "VIEWED"
  | "INFO_REQUESTED"
  | "INFO_SENT"
  | "ACCEPTED"
  | "DECLINED"
  | "CANCELLED";

export type ExpansionDecision =
  | { action: "STOP"; reason: "ACCEPTED" }
  | { action: "EXPAND"; reason: "ALL_DECLINED" | "RESPONSE_TIMEOUT" }
  | { action: "WAIT"; reason: "PENDING_RESPONSES"; nextExpansionAt: string };

/**
 * Decides only whether the current radius may expand. A hospital response is
 * never interpreted as a destination selection; the paramedic still chooses
 * one of the hospitals that explicitly accepted.
 */
export function decideExpansion(input: {
  statuses: readonly ExpansionRequestStatus[];
  nextExpansionAt: string;
  now?: Date;
}): ExpansionDecision {
  if (input.statuses.includes("ACCEPTED")) return { action: "STOP", reason: "ACCEPTED" };
  if (input.statuses.length > 0 && input.statuses.every((status) => status === "DECLINED")) {
    return { action: "EXPAND", reason: "ALL_DECLINED" };
  }
  const now = input.now ?? new Date();
  if (Date.parse(input.nextExpansionAt) <= now.getTime()) {
    return { action: "EXPAND", reason: "RESPONSE_TIMEOUT" };
  }
  return { action: "WAIT", reason: "PENDING_RESPONSES", nextExpansionAt: input.nextExpansionAt };
}
