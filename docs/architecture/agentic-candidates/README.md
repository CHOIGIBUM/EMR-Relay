# EMS Relay Agentic Architecture Candidates

관제센터를 제외하고 구급대원 모바일과 병원 수용 담당자 웹만 남긴 목표 아키텍처 후보입니다.

| 후보 | 초점 | 권장 용도 |
|---|---|---|
| [A안 · Dual-Lane Agentic Relay](a-dual-lane-agentic-relay.png) | 실시간 수용 업무와 FHIR 임상기록을 분리한 권장안 | 실시간 업무와 FHIR 기록의 균형 · MVP 최종안 |
| [B안 · HITL State Machine](b-hitl-state-machine.png) | 두 사람의 확인 대기와 수용곤란 반복을 상태기계로 명시 | HITL 대기와 수용곤란 반복을 명확히 설명 |
| [C안 · AgentCore Tool Mesh](c-agentcore-tool-mesh.png) | AgentCore가 병원 참고·FHIR·문의·인계 도구를 선택하는 구조 | AgentCore 도구 사용과 Agentic USP 발표 |
| [D안 · Event-Driven Multi-Agent](d-event-driven-multi-agent.png) | 역할별 Agent가 사건 이벤트를 이어받는 확장형 목표 구조 | 역할별 멀티에이전트 목표 구조 |
| [E안 · True Streaming Event Sourcing](e-true-streaming-event-sourcing.png) | Kinesis Data Streams로 실시간 처리하고 Firehose는 보관에 전용 | 진짜 스트리밍·재처리·이벤트 소싱 |
| [F안 · FHIR-First Clinical Relay](f-fhir-first-clinical-relay.png) | 확정 환자정보를 표준 인계 패키지와 HealthLake 원장으로 동시 전환 | FHIR 표준 인계와 HealthLake 중심 USP |

## I/O 읽는 법

- 왼쪽 `IN →`: 구급대원의 수동 입력 또는 PTT 음성 입력
- 오른쪽 `OUT →`: 병원 수용 담당자에게 전달되는 수용 문의
- 오른쪽 `← IN`: 병원의 수용·추가정보·수용곤란 회신
- 아래 초록 경로: 확정된 임상 이벤트의 Firehose → S3 → HealthLake 기록
- 모든 연결선은 수평·수직 전용 포트로 고정되며, 생성 시 선 겹침·교차·노드 관통을 자동 검증합니다.

## 공통 설계 원칙

- 병원 수용 요청·회신은 API Gateway/AppSync/DynamoDB의 저지연 운영 경로로 처리합니다.
- Amazon Data Firehose는 버퍼링되는 S3 임상 이벤트 적재 경로이며 수용 회신 경로가 아닙니다.
- S3와 HealthLake 사이에는 EventBridge와 FHIR Mapper Lambda가 있으며 FHIR R4 REST API로 기록합니다.
- 수동 구조화 입력은 Agent를 우회하고, 음성·구어체만 Agent가 구조화한 뒤 구급대원이 확인합니다.
- 병원 담당자가 수용 가능·추가정보 요청·수용 곤란을 직접 확정합니다.
- 원본 WAV는 보관하지 않고 확정 문장과 구조화 이벤트만 기록합니다.

## AWS 기술 근거

- [Amazon Data Firehose의 S3 버퍼 전송](https://docs.aws.amazon.com/firehose/latest/dev/basic-deliver.html)
- [HealthLake FHIR R4 REST 리소스 관리](https://docs.aws.amazon.com/healthlake/latest/devguide/managing-fhir-resources.html)
- [HealthLake의 S3 비동기 일괄 가져오기](https://docs.aws.amazon.com/healthlake/latest/devguide/importing-fhir-data.html)
- [API Gateway WebSocket 양방향 통신](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api.html)
- [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html)
- [AWS 공식 아키텍처 아이콘](https://aws.amazon.com/architecture/icons/)

각 후보는 `.drawio`, `.svg`, `.png` 형식으로 제공됩니다.
