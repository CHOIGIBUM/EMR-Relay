export type MatchCandidate = {
  hospital_id: string;
  display_name: string;
  distance_km: number;
  eta_minutes: number | null;
  [key: string]: unknown;
};

export function selectWaveCandidates(
  candidates: MatchCandidate[],
  radiusKm: number,
  excludedHospitalIds: ReadonlySet<string>,
  limit = 3,
) {
  return candidates
    .filter((candidate) => Number.isFinite(candidate.distance_km)
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
