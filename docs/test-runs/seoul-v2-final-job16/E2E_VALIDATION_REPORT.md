# EMS Relay Seoul v2 E2E 검증 보고서

- 검증 일자: 2026-08-05
- 배포 환경: AWS Amplify `main`, 배포 작업 **Job 16**
- 서비스 URL: <https://main.d1b1dqlcfz85e3.amplifyapp.com>
- 검증 사건: `EMS Relay-001`
- 사용자 화면: 구급대원 모바일, 강원특별자치도속초의료원 병원 수용 웹
- 증적: 실제 배포 환경에서 촬영한 화면 **28장**
- 종합 판정: **전체 통과**

> 출동 사건 선택부터 환자 평가, AI 항목 정리, 환자 카드 확정, 실제 병원 후보 조회, 병원 YES 회신, 구급대원 최종 선택, 이송, 병원 도착까지 하나의 사건으로 완료했다. 이어 Kakao Developers에 새 Amplify 운영 도메인을 등록하고 두 번째 사건의 병원 요청 화면에서 실제 지도, 현장 위치, 병원 마커와 ETA까지 재검증했다.

## 1. 검증 범위

1. 구급대원이 배정 사건을 선택하고 출동·현장 도착·환자 접촉을 기록한다.
2. 기본 상태, CPSS, 활력징후와 시간 정보를 단계별로 입력한다.
3. 현장 메모를 AI 항목 정리 경로로 처리하고 구급대원이 제안을 검토해 반영한다.
4. 확정 환자 카드를 기준으로 근거리 병원에 수용 요청을 전송한다.
5. 병원 담당자가 동일 환자 카드를 확인하고 `YES · 수용 가능`을 회신한다.
6. 구급대원 화면에 수용 가능 병원이 실시간으로 표시되고, 구급대원이 최종 병원을 선택한다.
7. 선택·이송·도착 상태가 구급대원과 병원 화면에 함께 반영된다.

## 2. 검증 환자와 입력값

| 항목 | 검증값 |
|---|---|
| 환자 | 78세 여성 |
| 주호소 | 갑작스러운 우측 팔 위약과 구음장애 |
| CPSS | 3/3: 안면 우측 이상, 팔 우측 이상, 구음장애 |
| 마지막 정상 확인 | 04:30, 근거 `보호자 통화` |
| 최초 이상 발견 | 04:45 |
| 수동 활력 측정 시각 | **06:06** |
| 혈압 | 178/96 mmHg |
| 맥박 | 92회/분 |
| 호흡수 | 18회/분 |
| SpO2 | 97% |
| 혈당 | 118 mg/dL |
| AVPU | A, 의식 명료 |
| 최종 선택 병원 | 강원특별자치도속초의료원 |

AI 항목 정리에 사용한 현장 메모는 다음과 같다.

```text
혈압 178에 96, 맥박 92회, 호흡수 18회, 산소포화도 97퍼센트, 혈당 118입니다.
```

## 3. 핵심 결과

| 검증 항목 | 결과 | 실제 확인 내용 |
|---|---|---|
| 배포 Job 16 접근 | 통과 | Amplify 운영 주소에서 구급대원·병원 화면 접근 |
| 사건 목록 | 통과 | 구급대원 모바일에 배정 사건 3건 표시 |
| 출동 상태 전이 | 통과 | 출동 준비 → 이동 → 현장 도착 → 환자 접촉 순서로 진행 |
| 단계별 필수 입력 | 통과 | 기본 상태 → CPSS → 활력징후 순서와 필수값 검증 동작 |
| AI 응답 속도 | 통과 | **1,007 ms**에 AI 정리 초안 표시 |
| AI 활력징후 추출 | 통과 | 혈압 수축기·이완기, 맥박, 호흡수, SpO2, 혈당 **6개 항목 추출** |
| 사람 검토(HITL) | 통과 | AI 결과는 자동 확정되지 않고 선택 항목 검토 후 반영 |
| 수동 측정시각 보존 | 통과 | AI 반영 뒤에도 **06:06** 유지; 환자 카드와 병원 화면에서 동일 표시 |
| 실제 병원 후보·ETA | 통과 | NMC·HIRA 후보와 Kakao 경로 조회 결과 표시 |
| 병원 후보 1 | 통과 | 강원특별자치도속초의료원 **7분 · 2.2 km** |
| 병원 후보 2 | 통과 | 의료법인온재의료재단온재병원 **5분 · 1.6 km** |
| 병원 YES 실시간 반영 | 통과 | 병원 수용 가능 회신이 구급대원 화면에 즉시 표시 |
| 수용 후 요청 확대 차단 | 통과 | YES 회신 뒤 `다음 거리 범위로 확대` 버튼이 표시되지 않음 |
| 구급대원 최종 병원 선택 | 통과 | 속초의료원을 이송 병원으로 선택하고 병원 웹에 동기화 |
| 이송·도착 완료 | 통과 | 이송 시작과 병원 도착 상태가 양쪽 화면에 반영 |
| Kakao 지도 SDK 렌더링 | 통과 | 운영 도메인 등록 후 강릉 현장 지도, 현장 마커, 병원 3곳 마커와 3·4·8분 ETA 표시 |

### AI 응답시간 측정 기준

구급대원 화면에서 `항목 정리` 요청을 전송한 시점부터 `AI 정리 초안`이 표시된 시점까지 실제 배포 브라우저에서 측정했다. 이번 정형 활력징후 문장은 빠른 구조화 경로로 처리되었고 1,007 ms가 소요됐다. 이 값은 해당 입력과 당시 네트워크 상태의 단일 E2E 측정값이며, 모든 자유 발화의 최대 응답시간을 의미하지는 않는다.

## 4. 단계별 화면 증적

### 4.1 사건 선택과 환자 접촉

| 순서 | 확인 내용 | 증적 |
|---:|---|---|
| 1 | 구급대원 배정 사건 3건 목록 | [01-paramedic-case-list.png](./01-paramedic-case-list.png) |
| 2 | 병원 신규 요청 대기 화면 | [02-hospital-idle.png](./02-hospital-idle.png) |
| 3 | 사건 선택 후 출동 준비 | [03-dispatch-ready.png](./03-dispatch-ready.png) |
| 4 | 출동 시작 및 현장 이동 | [04-enroute.png](./04-enroute.png) |
| 5 | 현장 도착 기록 | [05-scene-arrived.png](./05-scene-arrived.png) |
| 6 | 환자 접촉 기록 | [06-patient-contact.png](./06-patient-contact.png) |

### 4.2 환자 평가와 AI 항목 정리

| 순서 | 확인 내용 | 증적 |
|---:|---|---|
| 7 | 기본 상태 입력 전 | [07-assessment-basic-empty.png](./07-assessment-basic-empty.png) |
| 8 | 78세 여성, ABC·AVPU·주호소 입력 | [08-assessment-basic-filled.png](./08-assessment-basic-filled.png) |
| 9 | CPSS 입력 전 | [09-assessment-cpss-empty.png](./09-assessment-cpss-empty.png) |
| 10 | CPSS 3/3 입력 | [10-assessment-cpss-filled.png](./10-assessment-cpss-filled.png) |
| 11 | 활력징후 입력 전 | [11-assessment-vitals-empty.png](./11-assessment-vitals-empty.png) |
| 12 | 활력징후와 수동 측정시각 06:06 입력 | [12-assessment-vitals-filled.png](./12-assessment-vitals-filled.png) |
| 13 | 1,007 ms AI 초안 및 6개 항목 추출 | [13-ai-proposal.png](./13-ai-proposal.png) |
| 14 | 선택한 AI 제안을 입력 초안에 반영 | [14-ai-proposal-applied.png](./14-ai-proposal-applied.png) |
| 15 | 환자 카드 확정, 측정시각 06:06 보존 | [15-patient-card.png](./15-patient-card.png) |

AI 제안이 생성된 뒤에도 구급대원이 명시한 활력 측정 시각 `06:06`은 처리 시각으로 덮어쓰이지 않았다. 같은 시각이 확정 환자 카드와 병원 수용 웹의 환자 카드에 유지됐다.

### 4.3 병원 후보 조회와 수용 회신

| 순서 | 확인 내용 | 증적 |
|---:|---|---|
| 16 | 실제 병원 후보, 거리·ETA 조회; 지도 도메인 보류 상태 | [16-matching-wave-pending-map-domain.png](./16-matching-wave-pending-map-domain.png) |
| 17 | 병원 웹에 신규 요청 실시간 표시 | [17-hospital-request-list.png](./17-hospital-request-list.png) |
| 18 | 병원 담당자의 동일 환자 카드 열람 | [18-hospital-patient-card.png](./18-hospital-patient-card.png) |
| 19 | 병원 `YES · 수용 가능` 확인 대화상자 | [19-hospital-accept-confirm.png](./19-hospital-accept-confirm.png) |
| 20 | 병원 수용 가능 회신 완료 | [20-hospital-accepted.png](./20-hospital-accepted.png) |
| 21 | 구급대원 화면에 수용 가능 병원 실시간 표시 | [21-paramedic-accepted-list.png](./21-paramedic-accepted-list.png) |
| 28 | 운영 도메인 등록 후 Kakao 지도·현장·병원 마커 실제 렌더링 | [28-kakao-map-rendered.png](./28-kakao-map-rendered.png) |

수용 가능 회신 이후 구급대원 화면에는 최종 이송병원 선택 UI만 남고 `다음 거리 범위로 확대` 버튼은 사라졌다. 첫 유효 회신 이후 불필요한 추가 요청이 발생하지 않도록 한 동작을 확인했다.

### 4.4 최종 선택, 이송과 도착

| 순서 | 확인 내용 | 증적 |
|---:|---|---|
| 22 | 구급대원 최종 이송병원 선택 완료 | [22-destination-selected.png](./22-destination-selected.png) |
| 23 | 병원 웹에 이송 병원 선택 상태 실시간 반영 | [23-hospital-selected-live.png](./23-hospital-selected-live.png) |
| 24 | 구급대원 이송 시작 | [24-transporting.png](./24-transporting.png) |
| 25 | 병원 웹에 이송 중 상태 반영 | [25-hospital-transporting-live.png](./25-hospital-transporting-live.png) |
| 26 | 구급대원 병원 도착 완료 | [26-paramedic-arrived.png](./26-paramedic-arrived.png) |
| 27 | 병원 웹에 환자 도착 완료 표시 | [27-hospital-arrived.png](./27-hospital-arrived.png) |

## 5. 외부 데이터 연계 확인

- NMC·HIRA 연계 결과로 병원 후보의 기관명·주소·응급의료기관 정보를 조회했다.
- Kakao Mobility 경로 조회 결과를 이용해 실제 도로 기준 거리와 ETA를 표시했다.
- 이번 사건에서 화면에 확인된 후보는 다음과 같다.

| 병원 | ETA | 거리 | 상태 |
|---|---:|---:|---|
| 강원특별자치도속초의료원 | 7분 | 2.2 km | 요청 후 수용 가능 회신, 최종 선택 |
| 의료법인온재의료재단온재병원 | 5분 | 1.6 km | 동시 요청 후보 |

## 6. Kakao 지도 SDK 운영 검증

- Kakao Developers 앱 `1531484`의 JavaScript SDK 허용 목록에 새 Amplify 운영 도메인 `https://main.d1b1dqlcfz85e3.amplifyapp.com`을 등록했다.
- `EMS Relay-002`의 강릉 현장 주소를 기준으로 Kakao 지도 SDK가 실제 렌더링되는 것을 확인했다.
- 지도에는 현장 위치와 의료법인강릉동인병원, 강원특별자치도강릉의료원, 의산의료재단강릉고려병원 마커가 표시됐다.
- 동일 화면에서 Kakao 경로 조회 결과인 `8분 · 2.9km`, `4분 · 1.1km`, `3분 · 0.8km`가 표시됐다.
- 증적은 [28-kakao-map-rendered.png](./28-kakao-map-rendered.png)이다.

## 7. 최종 판정

EMS Relay Seoul v2의 핵심 거래 흐름은 **E2E 통과**했다.

- 구급대원 사건 선택과 출동 상태 기록
- 단계별 환자 평가와 필수값 입력
- AI 항목 정리 1,007 ms, 활력징후 6개 추출, HITL 검토
- 수동 활력 측정 시각 `06:06` 보존
- NMC·HIRA·Kakao 기반 실제 병원 후보와 거리·ETA 조회
- 병원 YES 회신의 실시간 전달
- YES 이후 추가 범위 확대 차단
- 구급대원 최종 병원 선택
- 선택·이송·도착 상태의 양방향 동기화

Kakao 운영 도메인 등록과 지도 SDK 재검증까지 완료했다. 현재 판정은 **전체 통과**다.
