# EMS Relay 프론트엔드 MVP

고령 심혈관 응급환자 한 건을 대상으로 출동 배정부터 현장 평가, 병원 수용 문의, 이송, 인계, 구급활동 기록 검토까지 이어서 시연하는 React 프론트엔드입니다. 로컬 fixture 모드와 AWS API 연결 모드를 모두 지원합니다.

## 바로 실행

Windows에서는 `RUN_LOCAL_MVP.bat`을 더블클릭합니다. 터미널에 표시된 주소를 브라우저에서 열면 됩니다. 기본 주소는 `http://localhost:3000`입니다.

직접 실행하려면 다음 명령을 사용합니다.

```powershell
npm install
npm run dev
```

## 역할별 화면

- 로그인: `http://localhost:3000/login`
- 구급대원 모바일: `http://localhost:3000/paramedic`
- 이송조정 상황실: `http://localhost:3000/control`
- 병원 수용 웹: `http://localhost:3000/hospital`
- 구급활동 기록: `http://localhost:3000/reports`
- 로컬 전체 시연 흐름: `http://localhost:3000/demo/workflow`

운영 경로는 Cognito 역할 권한을 확인하고 REST 스냅샷을 단일 기준으로 사용합니다. WebSocket 변경 알림을 받으면 사건을 다시 조회합니다. `/demo/workflow`에서만 같은 브라우저의 로컬 상태를 공유합니다.

## 시연 사건

- 사건번호: `EMS-GW-050`
- 환자: 73세 여성, 강원권 고령 심혈관 응급환자
- 신고 내용: 흉통과 식은땀
- 현장 평가: 급성 관상동맥증후군 의심 소견
- 입력 방식: 활력징후 직접 입력 + 단계별 PTT 변경안 확인
- 병원 문의: 첫 병원 추가정보 요청 후 수용 곤란, 두 번째 병원 수용 가능 회신
- 최종 단계: 구급대원 이송지 확인, 이송·재평가, 병원 인수, 보고서 검토

병원명은 실제 기관명이 아닌 시연용 별칭입니다. 환자와 사건 정보도 모두 합성 데이터입니다.

## 구현된 핵심 기능

- 출동 목록에서 사건을 선택하는 초기 화면
- 출동 시작·현장 도착·환자 접촉 등 업무 버튼 시각 자동 기록
- BP, PR, RR, SpO₂, 체온, 혈당, AVPU의 직접 입력과 측정시각 보존
- 누르고 말한 내용을 항목별 변경안으로 정리하고 구급대원이 선택한 값만 반영
- 실제 마이크 PCM을 Amazon Transcribe Streaming으로 전송하고 중앙 화면에 인식 문장을 표시
- 기관 참고정보·거리·ETA 기반 병원 목록과 병원별 순차 수용 문의
- 추가정보 요청, 수용 곤란 사유, 수용 가능 회신, 전화 연결 기록
- 병원 회신과 구급대원의 최종 이송지 확인을 분리
- 상황실의 읽기 전용 진행 감시와 예외 연락 지원
- 이송 중 재평가, 병원 도착, 구두·전자 인계, 병원 인수 확인
- 구급활동일지·심혈관 세부상황표 초안과 필드별 최종 검토
- 새로고침 복원 및 탭 간 실시간 상태 동기화

## 안전 경계

- AI는 진단, 치료, 병원 수용 여부 또는 최종 이송지를 결정하지 않습니다.
- 기관 API 정보는 탐색 범위를 좁히는 참고정보로만 표시합니다.
- 확인하지 못한 값은 임의로 채우지 않고 `미상` 또는 `확인 필요`로 유지합니다.
- 실제 환자정보, 119 지령시스템, 병원 EMR, 실시간 수용정보는 연결하지 않습니다.

## 검증

```powershell
npm run lint
npx tsc --noEmit
node --test tests/workflow-state.test.mjs
```

AWS API가 준비되면 `.env.local`에서 `NEXT_PUBLIC_EMS_API_MODE=remote`와
`NEXT_PUBLIC_EMS_BACKEND_URL=https://…execute-api.us-west-2.amazonaws.com`을 설정합니다.
원격 장애를 로컬 데이터로 숨기지 않도록 `NEXT_PUBLIC_EMS_ALLOW_LOCAL_FALLBACK`의 기본값은 `false`입니다.

- 음성 변경안: `POST /cases/{caseId}/voice-updates/proposals`
- 검토 결과 확정: `POST /cases/{caseId}/confirm`
- 병원 참고정보: `GET /hospitals?case_id=&lat=&lng=`
- Agent 응답은 항상 `pending_review: true`이며, 원격 모드에서는 모든 항목의 승인·제외 결정을 확정 API가 성공적으로 저장한 뒤에만 화면의 확정 상태가 변경됩니다.
- `NEXT_PUBLIC_EMS_REVIEWER_ID`는 해커톤용 검토자 식별자이며 운영에서는 Cognito 로그인 정보로 대체합니다.
- 운용 모드에는 `NEXT_PUBLIC_EMS_OPERATIONAL_MODE=remote`, 로컬 개발 역할 로그인에는 `NEXT_PUBLIC_EMS_DEV_AUTH=true`를 사용합니다.

현재 배포된 AWS 백엔드는 API Gateway, Lambda, DynamoDB까지 실제 연결되어 있습니다. Bedrock Claude 호출은 AWS 계정의 결제수단과 Anthropic 모델 사용 등록이 활성화된 후 사용할 수 있으며, 준비 전에는 명시적인 503 응답을 반환해 기존 확정 상태를 변경하지 않습니다.
