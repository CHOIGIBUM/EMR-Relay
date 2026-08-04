import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";

function readArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply" || token === "--replace") {
      values[token.slice(2)] = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    values[token.slice(2)] = value;
    index += 1;
  }
  return values;
}

const args = readArgs(process.argv.slice(2));
if (!args.apply) {
  throw new Error("This script writes demo records. Re-run with --apply.");
}

const tableName = args.table || process.env.TABLE_NAME;
const paramedicSub = args["paramedic-sub"];
const hospitalIds = String(args["hospital-ids"] || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const region = args.region || process.env.AWS_REGION || "ap-northeast-2";

if (!tableName) throw new Error("Provide --table or TABLE_NAME.");
if (!paramedicSub) throw new Error("Provide --paramedic-sub with the deployed Cognito user's sub.");
if (hospitalIds.length !== 3) throw new Error("Provide exactly three comma-separated --hospital-ids.");

const cases = [
  {
    caseId: "GW-STROKE-001",
    agency: "속초소방서",
    unitId: "영랑119안전센터 구급대",
    vehicleNumber: "강원12가1190",
    scenario: "고령 환자 상태 이상 신고",
    placeName: "속초관광수산시장 인근",
    address: "강원특별자치도 속초시 중앙로147번길 16",
    location: { latitude: 38.204543, longitude: 128.590246 },
    estimatedAgeBand: "70대 추정",
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
    location: { latitude: 37.754143, longitude: 128.898142 },
    estimatedAgeBand: "60대 추정",
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
    location: { latitude: 37.524724, longitude: 129.114292 },
    estimatedAgeBand: "70대 추정",
    estimatedSex: "미확인",
    reporter: "이웃",
  },
];

const baseTime = Date.now();
const transactItems = [];
for (const [index, seed] of cases.entries()) {
  const occurredAt = new Date(baseTime - index * 60_000).toISOString();
  const meta = {
    caseId: seed.caseId,
    version: 1,
    stage: "ASSIGNED",
    scenario: seed.scenario,
    reportTime: occurredAt,
    reportSummary: seed.scenario,
    reportDetail: "119 신고 내용으로 생성된 출동 정보이며 환자 상태는 현장 접촉 후 확인합니다.",
    estimatedAge: seed.estimatedAgeBand,
    estimatedSex: seed.estimatedSex,
    reporter: seed.reporter,
    station: seed.unitId,
    sceneAddress: seed.address,
    sceneLatitude: seed.location.latitude,
    sceneLongitude: seed.location.longitude,
    agency: seed.agency,
    unitId: seed.unitId,
    vehicleNumber: seed.vehicleNumber,
    assignedParamedicIds: [paramedicSub],
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  const eventId = `seed-case-assigned-${seed.caseId.toLowerCase()}`;
  const items = [
    {
      PK: `CASE#${seed.caseId}`,
      SK: "META",
      entityType: "CASE_META",
      ...meta,
    },
    {
      PK: `CASE#${seed.caseId}`,
      SK: "STATE#CONFIRMED",
      entityType: "CONFIRMED_STATE",
      caseId: seed.caseId,
      version: 0,
      facts: {},
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    {
      PK: `CASE#${seed.caseId}`,
      SK: `ASSIGNMENT#${paramedicSub}`,
      entityType: "CASE_ASSIGNMENT",
      GSI2PK: `PARAMEDIC#${paramedicSub}`,
      GSI2SK: `${occurredAt}#${seed.caseId}`,
      ...meta,
    },
    {
      PK: `CASE#${seed.caseId}`,
      SK: `EVENT#${occurredAt}#${eventId}`,
      entityType: "CASE_EVENT",
      eventId,
      caseId: seed.caseId,
      type: "CASE_ASSIGNED",
      actorSub: "DISPATCH_SEED",
      actorRole: "system",
      occurredAt,
      version: 1,
      summary: "출동 사건이 배정되었습니다.",
      payload: {
        assignedParamedicIds: [paramedicSub],
        agency: seed.agency,
        unitId: seed.unitId,
        vehicleNumber: seed.vehicleNumber,
        reportedAt: occurredAt,
        dispatchSummary: seed.scenario,
        estimatedAgeBand: seed.estimatedAgeBand,
        estimatedSex: seed.estimatedSex,
        reportedPlaceName: seed.placeName,
        reportedAddress: seed.address,
        reportedLocation: seed.location,
        source: "synthetic_dispatch_seed",
        demoHospitalIds: hospitalIds,
      },
    },
  ];
  transactItems.push(...items.map((Item) => ({
    Put: {
      TableName: tableName,
      Item,
      ConditionExpression: "attribute_not_exists(PK)",
    },
  })));
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

async function deleteExactDemoCases() {
  const keys = [];
  for (const { caseId } of cases) {
    let exclusiveStartKey;
    do {
      const page = await client.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `CASE#${caseId}` },
        ProjectionExpression: "PK, SK",
        ExclusiveStartKey: exclusiveStartKey,
      }));
      keys.push(...(page.Items ?? []).map(({ PK, SK }) => ({ PK, SK })));
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
  }

  for (let offset = 0; offset < keys.length; offset += 25) {
    let pending = keys.slice(offset, offset + 25).map((Key) => ({ DeleteRequest: { Key } }));
    do {
      const response = await client.send(new BatchWriteCommand({
        RequestItems: { [tableName]: pending },
      }));
      pending = response.UnprocessedItems?.[tableName] ?? [];
      if (pending.length) await new Promise((resolve) => setTimeout(resolve, 150));
    } while (pending.length);
  }
  return keys.length;
}

const deletedItems = args.replace ? await deleteExactDemoCases() : 0;

await client.send(new TransactWriteCommand({ TransactItems: transactItems }));

console.log(JSON.stringify({
  tableName,
  region,
  paramedicSub,
  hospitalIds,
  caseIds: cases.map(({ caseId }) => caseId),
  deletedItems,
  writtenItems: transactItems.length,
}, null, 2));
