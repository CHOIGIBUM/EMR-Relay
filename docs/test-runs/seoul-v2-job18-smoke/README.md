# Seoul v2 Job 18 실시간 매칭 스모크 테스트

- 배포: AWS Amplify Job 18 (`SUCCEED`)
- 리전: `ap-northeast-2`
- 사건: `GW-STROKE-001` / 화면 코드 `EMS Relay-001`
- 환자: 합성 데이터(78세 여성, CPSS 3/3)

## 확인 결과

1. 구급대원이 확정 환자 카드에서 근거리 병원 동시 요청을 시작했다.
2. 실제 카카오 지도에 현장과 후보 병원, 도로 기준 ETA가 표시됐다.
3. 속초의료원 계정의 병원 웹에 `EMS Relay-001` 요청이 새로고침 없이 도착했다.
4. 병원 담당자가 `YES · 수용 가능`을 확정했다.
5. 구급대원 모바일에 `수용 가능 회신 1곳`과 최종 병원 선택 버튼이 실시간으로 표시됐다.
6. 같은 시간대 Matching Lambda 오류는 0건이고 DLQ 메시지는 0건이었다.

## 화면 증거

- `01-paramedic-matching-map.png`: 구급대원 병원 요청·카카오 지도
- `02-hospital-request-realtime.png`: 속초의료원 실시간 요청 수신
- `03-hospital-accepted.png`: 병원 수용 가능 회신 완료
- `04-paramedic-acceptance-realtime.png`: 구급대원 실시간 수용 회신 수신

> 실제 환자정보가 아닌 공개·합성 데이터로만 검증했다.
