export type HospitalResponsePolicyInput = {
  destinationHospitalId?: string;
  selectionStatus?: "SELECTED" | "NOT_SELECTED";
  responseExpiresAt?: string;
};

/**
 * The response window controls when the matching workflow expands to the next
 * radius. It is not a hard deadline for a hospital that is still reviewing an
 * active request. A reply is closed only after the paramedic has selected a
 * destination (or the request was explicitly marked as not selected).
 */
export function hospitalResponseUnavailableReason(input: HospitalResponsePolicyInput): string | null {
  if (input.destinationHospitalId || input.selectionStatus === "NOT_SELECTED") {
    return "이미 이송 병원이 확정되어 이 요청에는 회신할 수 없습니다.";
  }
  return null;
}
