import type {
  LocalHospitalCandidate,
  LocalHospitalsResponse,
} from "@/lib/localDemoTypes";

const HOSPITALS: LocalHospitalCandidate[] = [
  {
    id: "hallym",
    name: "한림대학교춘천성심병원",
    type: "응급의료기관",
    distance: "36.8 km",
    eta: "35분",
    location: "춘천시 삭주로 77",
    reference: ["기관정보", "CT", "신경과"],
  },
  {
    id: "knuh",
    name: "강원대학교병원",
    type: "응급의료기관",
    distance: "39.2 km",
    eta: "38분",
    location: "춘천시 백령로 156",
    reference: ["기관정보", "CT", "신경과"],
  },
  {
    id: "hongcheon",
    name: "홍천아산병원",
    type: "응급의료기관",
    distance: "11.4 km",
    eta: "16분",
    location: "홍천군 산림공원1길 17",
    reference: ["기관정보", "가까운 순"],
  },
];

const REFERENCE_TIMESTAMP = "2026-08-02T14:32:00+09:00";

export async function GET(): Promise<Response> {
  const response: LocalHospitalsResponse = {
    hospitals: HOSPITALS,
    dataSource: "local-demo-fixture",
    referenceTimestamp: REFERENCE_TIMESTAMP,
  };

  return Response.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
