import { CARDIO_DEMO_HOSPITALS } from "@/lib/cardioDemoData";
import type { HospitalDirectoryResponse } from "@/lib/emsApiTypes";

export async function GET(): Promise<Response> {
  const response: HospitalDirectoryResponse = {
    hospitals: CARDIO_DEMO_HOSPITALS.map((hospital) => ({
      hospital_id: hospital.id,
      display_name: hospital.alias,
      care_level: hospital.careLevelLabel,
      region_label: hospital.regionLabel,
      distance_km: hospital.distanceKm,
      eta_minutes: hospital.etaMinutes,
      reference_capabilities: [...hospital.referenceCapabilities],
    })),
    reference_at: new Date().toISOString(),
    source: "local_fixture",
  };

  return Response.json(response, { headers: { "Cache-Control": "no-store" } });
}
