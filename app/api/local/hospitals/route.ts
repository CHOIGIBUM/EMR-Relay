import { CARDIO_DEMO_HOSPITALS } from "@/lib/cardioDemoData";
import type { LocalHospitalsResponse } from "@/lib/localDemoTypes";

export async function GET(): Promise<Response> {
  const response: LocalHospitalsResponse = {
    hospitals: CARDIO_DEMO_HOSPITALS.map((hospital) => ({
      id: hospital.id,
      name: hospital.alias,
      type: hospital.careLevelLabel,
      distance: `${hospital.distanceKm.toFixed(1)} km`,
      eta: `${hospital.etaMinutes}분`,
      location: hospital.regionLabel,
      reference: [...hospital.referenceCapabilities],
    })),
    dataSource: "local-demo-fixture",
    referenceTimestamp: new Date().toISOString(),
  };

  return Response.json(response, { headers: { "Cache-Control": "no-store" } });
}
