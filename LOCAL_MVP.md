# EMS Relay 로컬 MVP

로컬 모드는 AWS나 외부 API 없이 구급대원 모바일과 병원 수용 웹의 전체 상호작용을 확인하기 위한 개발 환경입니다. 환자·사건·병원 회신은 모두 합성 fixture이며 실제 수용 상태를 나타내지 않습니다.

## 준비

- Node.js 22
- Chrome 또는 Edge 최신 버전
- 저장소 루트에서 실행

## 실행

Windows에서는 다음 파일을 실행합니다.

```powershell
./RUN_LOCAL_MVP.bat
```

직접 실행할 때는 로컬 데이터와 개발 역할 로그인을 명시합니다.

```powershell
npm.cmd install
$env:NEXT_PUBLIC_EMS_DATA_MODE = "local"
$env:NEXT_PUBLIC_EMS_DEV_AUTH = "true"
npm.cmd run dev
```

종료는 실행한 터미널에서 `Ctrl+C`를 누릅니다.

## 화면

- `http://localhost:3000/` — 로그인 진입
- `http://localhost:3000/login` — 구급대원/병원 개발 역할 선택
- `http://localhost:3000/auth/callback` — Cognito 콜백 전용
- `http://localhost:3000/paramedic` — 구급대원 모바일
- `http://localhost:3000/hospital` — 병원 수용 웹

두 역할을 동시에 확인하려면 `/paramedic`과 `/hospital`을 각각 다른 탭에 엽니다. 로컬 API는 `localStorage`에 상태를 보존하고 `BroadcastChannel`로 탭 간 변경을 전달합니다.

## 권장 시연 순서

1. 구급대원으로 로그인하고 `EMS Relay-001`을 선택합니다.
2. `출동 시작`, `현장 도착`, `환자 접촉`을 순서대로 누릅니다.
3. 기본 평가, CPSS, 활력징후와 각 시각을 입력합니다.
4. 환자 카드를 확정하고 근거리 병원 동시 요청을 시작합니다.
5. 병원 탭에서 신규 요청을 열고 `수용 가능` 또는 `수용 곤란`을 회신합니다.
6. 구급대원 탭에서 수용 가능 병원을 선택합니다.
7. 경로를 확인하고 `이송 시작`, `병원 도착`까지 진행합니다.

## 음성 입력

로컬 모드의 음성 변경안은 UI와 HITL 동작 확인용입니다. 운영 환경의 실제 PTT는 Transcribe Streaming과 Bedrock을 사용합니다. 수동으로 입력한 구조화 값은 AI를 거치지 않습니다.

음성 변경안은 자동 확정되지 않습니다. 변경 항목을 확인하고 선택한 뒤 반영해야 합니다.

## 초기화

로컬 상태를 처음부터 다시 시작하려면 브라우저 사이트 데이터에서 `localhost:3000`의 로컬 저장소를 지운 뒤 새로고침합니다. 운영 AWS 데이터에는 영향을 주지 않습니다.

## 검증

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
```
