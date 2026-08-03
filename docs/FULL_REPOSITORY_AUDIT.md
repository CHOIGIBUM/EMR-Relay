# EMS Relay 전체 저장소 품질·보안 감사

감사 시각: 2026-08-04 01:26 KST  
기준: Git `e19ddc75fc8e72a458b8c12128028e5126ec4d62` 이후 현재 작업 트리  
AWS 계정·리전: `462993243992` · `us-west-2`

## 1. 결론

현재 작업 트리는 AWS Amplify 정적 프론트, Cognito 인증, API Gateway HTTP·WebSocket, Lambda·DynamoDB, Transcribe Streaming, Bedrock AgentCore, S3·HealthLake로 이어지는 AWS 중심 구조와 일치한다. 자동 검사와 실제 배포 경로 검증에서 차단 수준의 코드·보안 결함은 남지 않았다.

감사 중 Cognito에 등록된 콜백 주소와 프론트 빌드 주소의 trailing slash 불일치를 발견해 `.env.production`을 실제 Cognito 설정과 정확히 맞췄다. 최종 산출물은 Amplify job `9`로 재배포되었고 모든 정적 경로와 자산이 HTTP 200을 반환했다.

Kakao Developers의 JavaScript SDK 허용 도메인도 새 Amplify 주소로 교체했다. 동일 출처를 `Referer`로 사용한 SDK 호출이 HTTP 200을 반환하고 도메인 불일치 오류가 사라진 것을 확인했다.

## 2. 자동 검증 결과

| 영역 | 실행 결과 |
|---|---|
| 프론트 정적 빌드 | 성공 · `/`, `auth/callback`, `control`, `demo/workflow`, `hospital`, `login`, `paramedic`, `reports` 정적 생성 |
| 프론트 TypeScript | 통과 |
| 프론트 ESLint | 통과 |
| 프론트 테스트 | 20/20 통과 |
| 프론트 npm audit | 취약점 0건 · 총 532 dependencies |
| 백엔드 TypeScript | 통과 |
| 백엔드 테스트 | 25/25 통과 |
| 백엔드 npm audit | 취약점 0건 |
| SAM template lint | 유효한 SAM template |
| AgentCore Ruff | 통과 |
| AgentCore 테스트 | 17/17 통과 |
| AgentCore coverage | 88.35% · 기준 85% 통과 |
| `git diff --check` | 공백 오류 없음 |

프론트 테스트는 정적 HTML, 운영 화면의 합성 환자정보 미포함, 브라우저 로컬 fixture 계약, Cognito state·nonce·PKCE, 안전한 return path, PTT PCM flush, 역할·상태 전이, 병원 회신 분기 및 미확인값 비추정을 검증한다.

## 3. 감사 중 발견·수정한 결함

- 백엔드가 허용하는 `reassessment.*` 8개 경로가 AgentCore의 Pydantic 계약에서 빠져 실제 관리형 런타임 호출이 거절되던 문제를 수정했다. 백엔드 TypeScript 허용 목록을 기준 계약으로 삼아 Python `Literal`과 상수의 완전 일치를 검증하는 회귀 테스트를 추가했다.
- AgentCore가 잘못된 입력을 받을 때 Pydantic 예외에 포함된 원문이 관리형 로그로 흘러갈 수 있어, 원문을 포함하지 않는 `INVALID_AGENT_REQUEST` 오류 봉투로 제한했다.
- AgentCore 세션 ID에 사건 번호가 포함되어 로그 스트림 이름으로 노출되던 문제를 제거하고 무작위 불투명 ID로 교체했다.
- Windows 압축 도구가 만든 역슬래시 또는 `./` 접두 ZIP 경로 때문에 Amplify가 중첩 화면과 `_next/static` 자산을 배포하지 못하던 문제를 수정했다. 배포 스크립트는 이제 `index.html`을 첫 항목으로 두고 모든 경로를 `/`로 정규화하며 필수 화면·자산을 업로드 전에 검사한다.
- 로컬 실행 문서에 남아 있던 과거 `?view=` 주소와 전체 테스트 중 한 파일만 실행하던 Windows 검사 스크립트를 현재 역할별 경로 및 전체 테스트 명령으로 정정했다.

## 4. 실제 AWS 설정 일치성

| 항목 | 확인 결과 |
|---|---|
| Amplify app | `d2edch3bt6kxej` · `ems-relay-frontend` · `WEB` |
| Production branch | `main` · `PRODUCTION` · `Next.js - SSG` |
| 배포 | job `9` · `SUCCEED` |
| 서비스 URL | `https://main.d2edch3bt6kxej.amplifyapp.com` |
| Cognito callback | `https://main.d2edch3bt6kxej.amplifyapp.com/auth/callback` |
| Cognito logout | `https://main.d2edch3bt6kxej.amplifyapp.com/login` |
| Cognito flow | Authorization Code + PKCE · client secret 없음 · token revocation 사용 |
| HTTP API CORS | localhost와 새 Amplify origin만 허용 |
| HTTP API preflight | 새 Amplify origin에 204 및 정확한 `Access-Control-Allow-Origin` 반환 |
| WebSocket API | `wss://4zwsk5dhvc.execute-api.us-west-2.amazonaws.com` |
| Backend health | `status=ok`, `agent.agentRuntimeConfigured=true`, `agent.directBedrockFallbackEnabled=false`, `audioStorage=disabled` |
| AgentCore runtime | version `5` · `READY` · 로그 보존 14일 |
| Kakao JavaScript SDK | Amplify origin 등록 완료 · SDK 호출 HTTP 200 |

Cognito의 access·ID token은 15분, refresh token은 1일이며 OAuth scope는 `openid email profile`이다. 프론트의 콜백·로그아웃 문자열과 Cognito 허용 목록이 문자 단위로 일치하는 것을 확인했다.

재배포 후 실제 클라우드 회귀 호출도 수행했다. AgentCore의 재평가 요청은 HTTP 200, `PENDING_REVIEW`, `HITL=true`, `authoritative=false`를 반환했고 모든 변경 경로가 `reassessment.*` 범위에 머물렀다. 백엔드 agent route는 201로 검토 대기안을 생성하면서 확정 버전은 변경하지 않았다. 새 AgentCore 로그 스트림 2개는 모두 사건 번호가 없는 불투명 UUID였으며, 배포 후 AgentCore와 Lambda의 오류 이벤트는 0건이었다. 수정 전 생성된 사건 번호 포함 스트림 2개는 14일 보존기간 만료 후 제거된다.

## 5. 실제 호스팅 검증

다음 경로가 모두 HTTP 200을 반환했다.

- `/`
- `/login`
- `/auth/callback?code=fake&state=fake`
- `/paramedic`
- `/control`
- `/hospital`
- `/reports`
- `/demo/workflow`

배포 HTML에는 이전 `chatgpt.site` 주소와 `/api/local` 호출이 없다. `_next/static` 자산도 HTTP 200이며 `Cache-Control: public, max-age=31536000, immutable`을 반환한다. HTML은 `no-cache, no-store, must-revalidate`다.

실제 Amplify 응답에서 다음 헤더를 확인했다.

- HSTS `max-age=31536000; includeSubDomains; preload`
- Content-Security-Policy
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy`에서 camera 차단, microphone·geolocation 동일 출처 허용
- CSP에서 API Gateway, WebSocket, Transcribe Streaming, Cognito, Kakao SDK 목적지만 명시 허용

## 6. 비밀정보·브라우저 노출 감사

소스와 정적 `out/`에서 다음 패턴을 검사했으며 발견되지 않았다.

- AWS access key·secret key
- 공공데이터포털 인증키
- Kakao REST API key·Admin key
- private key PEM
- `DATA_GO_KR_SERVICE_KEY`, `KAKAO_MOBILITY_REST_API_KEY` 값

브라우저 번들에는 공개를 전제로 한 Cognito SPA client ID와 Kakao JavaScript key만 포함된다. AWS credential, 공공데이터 인증키, Kakao REST/Admin key는 `NEXT_PUBLIC_*`에 두지 않으며 AWS Secrets Manager에서만 관리한다.

Cognito token은 영구 `localStorage`가 아닌 탭 단위 `sessionStorage`에 저장된다. SPA 특성상 XSS가 발생하면 token 접근 위험이 있으므로 CSP를 계속 유지해야 한다. 현재 Next.js 정적 hydration과 Kakao SDK 때문에 CSP의 `script-src`에 `'unsafe-inline'`이 남아 있으며, 장기 운영 전에는 nonce 또는 hash 기반 정책으로 축소하는 것이 권장된다.

## 7. 이전 호스팅 구성 제거 확인

다음 항목은 현재 소스·패키지·정적 출력에서 제거되었다.

- `.openai/hosting.json`
- Vinext·Vite·Wrangler·Cloudflare Worker 의존성
- `vite.config.ts`, `worker/index.ts`, Sites 전용 build plugin
- 서버 의존 `/api/local/*` route
- 이전 Sites 도메인과 로컬 API URL

`eslint.config.mjs`의 `.vinext/**`, `.wrangler/**` 두 항목은 개발 PC에 남을 수 있는 과거 비추적 산출물을 lint 대상에서 제외하기 위한 정리용 ignore이며 런타임·배포 의존성이 아니다.

명시적 데모 화면은 서버 API 대신 브라우저 내부 `localDemoApi.ts` fixture를 사용하고, 운영 화면은 API Gateway만 사용한다. 운영 장애를 데모 값으로 숨기는 fallback은 production에서 비활성화되어 있다.

## 8. 문서 정확성 수정

- 프론트 로컬 검증 명령을 TypeScript loader가 포함된 `npm.cmd test`로 정정했다.
- 구현 보고서의 백엔드 테스트 수를 25/25로 갱신했다.
- AgentCore 테스트를 17/17, coverage를 88.35%로 갱신했다.
- `/health`의 AgentCore 상태 경로를 실제 응답 구조인 `agent.*`로 정정했다.
- Cognito callback·logout 주소와 `.env.production`을 실제 AWS 허용 목록에 맞췄다.

## 9. 남은 현장 확인

### 완료: Kakao JavaScript SDK 도메인

Kakao Developers의 JavaScript SDK 허용 도메인을 `https://main.d2edch3bt6kxej.amplifyapp.com`으로 교체했다. 해당 출처로 SDK를 호출했을 때 HTTP 200을 반환했으며 `domain mismatched` 응답은 더 이상 발생하지 않는다. 프론트에는 공개용 JavaScript key만 사용하고 REST/Admin key는 추가하지 않았다.

### 필수: 물리 장치 인수 테스트

Chrome 또는 Edge의 실제 모바일 장치에서 마이크·위치 권한을 허용하고 PTT 시작, 중앙 실시간 문장, 버튼 해제 후 최종 문장, HITL 검토, 병원 지도 표시까지 한 번 확인해야 한다. 자동 테스트와 원격 브라우저는 실제 단말의 마이크·위치 권한 환경을 대체하지 않는다.

### 필수: 음성·추출 품질 평가

재평가 회귀 호출은 런타임 계약과 HITL 경계를 통과했지만, 단일 발화에서 모델이 반환한 임상 필드가 의미적으로 완벽하지는 않았다. 일부 발화 값이 누락되거나 다른 재평가 경로로 제안될 수 있으므로 이 결과를 임상 추출 정확도 근거로 사용하지 않는다. 준비한 합성 50건과 소음 조건별 음성으로 ASR WER/CER, 필드 단위 precision·recall·F1, 숫자·단위 정확도, 미확인값 비추정률을 별도로 평가해야 한다.

### 운영 범위

현재 배포는 공개·합성 사건 기반 실증용이다. 병원 회신은 실제 병원 HIS·공식 수용망이 아니라 EMS Relay 내부 병원 역할 화면의 회신이며 NMC·HIRA·Kakao는 참고 API다. 실제 환자정보를 투입하기 전에는 개인정보 영향평가, 의료·소방 업무 책임 경계, 실제 119 CAD·병원 시스템 연계 승인, Cognito MFA 의무화, API Gateway access log, 사건 보존·파기 정책을 별도로 마련해야 한다.
