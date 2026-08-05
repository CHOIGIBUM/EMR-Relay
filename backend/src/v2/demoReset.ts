export const DEMO_RESET_CONFIRMATION = "RESET_EMS_RELAY_DEMO";

export const DEMO_CASE_IDS = [
  "GW-STROKE-001",
  "GW-STROKE-002",
  "GW-STROKE-003",
] as const;

type DemoCaseTemplate = {
  caseId: (typeof DEMO_CASE_IDS)[number];
  agency: string;
  unitId: string;
  vehicleNumber: string;
  scenario: string;
  placeName: string;
  address: string;
  latitude: number;
  longitude: number;
  estimatedAge: string;
  estimatedSex: string;
  reporter: string;
};

const DEMO_CASES: readonly DemoCaseTemplate[] = [
  {
    caseId: "GW-STROKE-001",
    agency: "속초소방서",
    unitId: "영랑119안전센터 구급대",
    vehicleNumber: "강원12가1190",
    scenario: "고령 환자 상태 이상 신고",
    placeName: "속초관광수산시장 인근",
    address: "강원특별자치도 속초시 중앙로147번길 16",
    latitude: 38.204543,
    longitude: 128.590246,
    estimatedAge: "70대 추정",
    estimatedSex: "미확인",
    reporter: "상인",
  },
  {
    caseId: "GW-STROKE-002",
    agency: "강릉소방서",
    unitId: "옥천119안전센터 구급대",
    vehicleNumber: "강원12가1191",
    scenario: "고령 환자 의식 상태 이상 신고",
    placeName: "강릉중앙시장 인근",
    address: "강원특별자치도 강릉시 금성로 21",
    latitude: 37.754143,
    longitude: 128.898142,
    estimatedAge: "60대 추정",
    estimatedSex: "미확인",
    reporter: "가족",
  },
  {
    caseId: "GW-STROKE-003",
    agency: "동해소방서",
    unitId: "천곡119안전센터 구급대",
    vehicleNumber: "강원12가1192",
    scenario: "고령 환자 거동 이상 신고",
    placeName: "동해시 천곡동",
    address: "강원특별자치도 동해시 천곡로 77",
    latitude: 37.524724,
    longitude: 129.114292,
    estimatedAge: "70대 추정",
    estimatedSex: "미확인",
    reporter: "이웃",
  },
];

export type DemoResetKey = { PK: string; SK: string };
export type DemoResetItem = DemoResetKey & Record<string, unknown>;

export type DemoResetStorage = {
  listPartitionKeys(partitionKey: string): Promise<DemoResetKey[]>;
  deleteKeys(keys: DemoResetKey[]): Promise<void>;
  putItems(items: DemoResetItem[]): Promise<void>;
};

export type DemoResetResult = {
  caseIds: string[];
  deletedItems: number;
  restoredItems: number;
  resetAt: string;
};

export function demoCasePartitionKey(caseId: string) {
  if (!(DEMO_CASE_IDS as readonly string[]).includes(caseId)) {
    throw new Error("시연 사건 식별자가 허용 목록에 없습니다.");
  }
  return `CASE#${caseId}`;
}

export function assertDemoResetConfirmation(value: unknown) {
  if (value !== DEMO_RESET_CONFIRMATION) {
    throw new Error(`시연 초기화를 실행하려면 확인 문구 ${DEMO_RESET_CONFIRMATION}를 정확히 입력하세요.`);
  }
}

export function buildDemoCaseItems(paramedicSub: string, baseTime = Date.now()): DemoResetItem[] {
  if (!paramedicSub.trim()) throw new Error("구급대원 사용자 식별자가 필요합니다.");
  return DEMO_CASES.flatMap((seed, index) => {
    const occurredAt = new Date(baseTime - index * 60_000).toISOString();
    const meta = {
      caseId: seed.caseId,
      version: 1,
      stage: "ASSIGNED",
      scenario: seed.scenario,
      reportTime: occurredAt,
      reportSummary: seed.scenario,
      reportDetail: `${seed.caseId.replace("GW-STROKE", "EMS Relay")} · ${seed.estimatedAge} · 성별 ${seed.estimatedSex} · ${seed.reporter} 신고`,
      estimatedAge: seed.estimatedAge,
      estimatedSex: seed.estimatedSex,
      reporter: seed.reporter,
      station: seed.unitId,
      sceneAddress: seed.address,
      sceneLatitude: seed.latitude,
      sceneLongitude: seed.longitude,
      agency: seed.agency,
      unitId: seed.unitId,
      vehicleNumber: seed.vehicleNumber,
      assignedParamedicIds: [paramedicSub],
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    const eventId = `demo-reset-case-assigned-${seed.caseId.toLowerCase()}`;
    const PK = demoCasePartitionKey(seed.caseId);
    return [
      { PK, SK: "META", entityType: "CASE_META", ...meta },
      {
        PK,
        SK: "STATE#CONFIRMED",
        entityType: "CONFIRMED_STATE",
        caseId: seed.caseId,
        version: 0,
        facts: {},
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
      {
        PK,
        SK: `ASSIGNMENT#${paramedicSub}`,
        entityType: "CASE_ASSIGNMENT",
        GSI2PK: `PARAMEDIC#${paramedicSub}`,
        GSI2SK: `${occurredAt}#${seed.caseId}`,
        ...meta,
      },
      {
        PK,
        SK: `EVENT#${occurredAt}#${eventId}`,
        entityType: "CASE_EVENT",
        eventId,
        caseId: seed.caseId,
        type: "CASE_ASSIGNED",
        actorSub: "DEMO_RESET",
        actorRole: "system",
        occurredAt,
        version: 1,
        summary: "출동 사건이 구급대에 배정되었습니다.",
        payload: {
          assignedParamedicIds: [paramedicSub],
          agency: seed.agency,
          unitId: seed.unitId,
          vehicleNumber: seed.vehicleNumber,
          reportedAt: occurredAt,
          dispatchSummary: seed.scenario,
          estimatedAgeBand: seed.estimatedAge,
          estimatedSex: seed.estimatedSex,
          reportedPlaceName: seed.placeName,
          reportedAddress: seed.address,
          reportedLocation: { latitude: seed.latitude, longitude: seed.longitude },
          source: "synthetic_demo_reset",
        },
      },
    ];
  });
}

export async function resetDemoCases(
  storage: DemoResetStorage,
  paramedicSub: string,
  baseTime = Date.now(),
): Promise<DemoResetResult> {
  const allowedPartitions = new Set(DEMO_CASE_IDS.map(demoCasePartitionKey));
  const keys = (await Promise.all(
    [...allowedPartitions].map((partitionKey) => storage.listPartitionKeys(partitionKey)),
  )).flat();

  if (keys.some(({ PK, SK }) => !allowedPartitions.has(PK) || typeof SK !== "string" || !SK)) {
    throw new Error("시연 사건 이외의 레코드가 초기화 범위에 포함되어 작업을 중단했습니다.");
  }

  if (keys.length) await storage.deleteKeys(keys);
  const items = buildDemoCaseItems(paramedicSub, baseTime);
  await storage.putItems(items);
  return {
    caseIds: [...DEMO_CASE_IDS],
    deletedItems: keys.length,
    restoredItems: items.length,
    resetAt: new Date(baseTime).toISOString(),
  };
}
