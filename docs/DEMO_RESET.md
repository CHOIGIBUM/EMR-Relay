# 서울 v2 시연 사건 초기화

시연 초기화는 DynamoDB 전체 삭제가 아니라 아래 세 사건 파티션만 초기 상태로 되돌립니다.

- `GW-STROKE-001`
- `GW-STROKE-002`
- `GW-STROKE-003`

각 파티션의 환자 상태, 이벤트, 병원 요청, 매칭 작업, 음성 변경안 및 배정 인덱스를 삭제한 뒤 `ASSIGNED` 상태의 사건·확정 상태·구급대원 배정·최초 이벤트를 다시 생성합니다. 다른 사건과 병원 참조 캐시는 변경하지 않습니다.

## 호출 조건

- Cognito `paramedic` 그룹으로 로그인한 사용자만 호출할 수 있습니다.
- `confirmation` 값은 `RESET_EMS_RELAY_DEMO`와 정확히 일치해야 합니다.
- 복원된 세 사건은 초기화를 실행한 구급대원 계정에 배정됩니다.
- 오래된 SQS 매칭 메시지는 `ASSIGNED` 단계에서 중단되어 초기화 이후 병원 요청을 다시 만들지 않습니다.

```graphql
mutation ResetDemoCases {
  resetDemoCases(input: { confirmation: "RESET_EMS_RELAY_DEMO" }) {
    caseIds
    deletedItems
    restoredItems
    resetAt
  }
}
```

프론트에서는 `useV2().resetDemoCases(confirmation)`을 확인 대화상자의 최종 동작에 연결합니다. 이 함수는 성공 후 사건 목록을 자동으로 다시 조회합니다.

## 구현 파일

- `backend/src/v2/demoReset.ts` — 고정 허용 목록, 확인 문구, 3건 시드, 저장소 독립 초기화 절차
- `backend/src/v2/repository.ts` — 세 파티션 조회·일괄 삭제·트랜잭션 복원 DynamoDB 어댑터
- `backend/src/v2/appsyncHandler.ts` — Cognito 구급대원 권한 및 확인 문구 검증
- `backend/src/v2/matchingHandler.ts` — 초기화 후 남은 매칭 메시지의 단계 차단
- `backend/schemas/v2.graphql` — `resetDemoCases` GraphQL 계약
- `backend/template-v2.yaml` — 기존 AppSync Lambda 파이프라인 리졸버 연결
- `lib/v2/types.ts` — 확인 문구와 응답 타입
- `lib/v2/api.ts` — 로컬 및 AppSync API 구현
- `components/v2/V2Provider.tsx` — 확인 UI에서 사용할 컨텍스트 동작
- `backend/tests/v2DemoReset.test.ts` — 허용 범위·복원 레코드·오래된 매칭 메시지 회귀 테스트
- `backend/tests/v2Appsync.test.ts` — 스키마·인증·인프라 연결 회귀 테스트
- `tests/v2-api-regression.test.mjs` — 브라우저 GraphQL 요청 계약 테스트
