"""Generate six editable EMS Relay target-architecture candidates.

The diagrams deliberately separate the low-latency hospital workflow from the
buffered clinical-record path.  Official AWS architecture icons are downloaded
from the AWS icon package and embedded into every SVG and Draw.io file.
"""

from __future__ import annotations

import base64
import html
import os
import math
import shutil
import subprocess
import tempfile
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "architecture" / "agentic-candidates"
WIDTH = 1920
HEIGHT = 1080

ICON_PACKAGE_URL = (
    "https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/"
    "architecture/approved/architecture-icons/"
    "Icon-package_04302026.4705b90f5aa45b019271a2699e9ce9b97b941ee1.zip"
)

INK = "#172B4D"
NAVY = "#0B2942"
MUTED = "#607589"
LINE = "#8BA0B4"
TEAL = "#008C95"
GREEN = "#15966B"
ORANGE = "#E87922"
BLUE = "#2F6FED"
RED = "#D64045"
PURPLE = "#6A4BBC"
BG = "#FFFFFF"
SOFT = "#F6F9FC"


ICON_MATCHES = {
    "amplify": "Arch_AWS-Amplify_64.svg",
    "cognito": "Arch_Amazon-Cognito_64.svg",
    "transcribe": "Arch_Amazon-Transcribe_64.svg",
    "api": "Arch_Amazon-API-Gateway_64.svg",
    "lambda": "Arch_AWS-Lambda_64.svg",
    "agentcore": "Arch_Amazon-Bedrock-AgentCore_64.svg",
    "bedrock": "Arch_Amazon-Bedrock_64.svg",
    "dynamodb": "Arch_Amazon-DynamoDB_64.svg",
    "firehose": "Arch_Amazon-Data-Firehose_64.svg",
    "kinesis": "Arch_Amazon-Kinesis-Data-Streams_64.svg",
    "eventbridge": "Arch_Amazon-EventBridge_64.svg",
    "appsync": "Arch_AWS-AppSync_64.svg",
    "stepfunctions": "Arch_AWS-Step-Functions_64.svg",
    "healthlake": "Arch_AWS-HealthLake_64.svg",
    "s3": "Arch_Amazon-Simple-Storage-Service_32.svg",
}


@dataclass
class Node:
    ident: str
    label: str
    x: float
    y: float
    w: float = 130
    h: float = 112
    icon: str | None = None
    kind: str = "service"
    fill: str = "#FFFFFF"
    stroke: str = LINE
    color: str = INK


@dataclass
class Group:
    ident: str
    title: str
    x: float
    y: float
    w: float
    h: float
    fill: str = "#FFFFFF"
    stroke: str = LINE
    dashed: bool = True


@dataclass
class Edge:
    source: str
    target: str
    label: str = ""
    color: str = NAVY
    dashed: bool = False
    points: list[tuple[float, float]] = field(default_factory=list)
    label_pos: tuple[float, float] | None = None


@dataclass
class Candidate:
    slug: str
    letter: str
    title: str
    subtitle: str
    badge: str
    badge_color: str
    groups: list[Group]
    nodes: list[Node]
    edges: list[Edge]
    steps: list[str]


def _find_or_download_icons() -> dict[str, str]:
    cache = Path(tempfile.gettempdir()) / "ems-relay-aws-icons-2026q2"
    zip_path = cache / "aws-icons.zip"
    extract = cache / "selected"
    extract.mkdir(parents=True, exist_ok=True)
    if not zip_path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(ICON_PACKAGE_URL, zip_path)

    resolved: dict[str, Path] = {}
    with zipfile.ZipFile(zip_path) as archive:
        members = [m for m in archive.namelist() if not m.startswith("__MACOSX/")]
        for key, filename in ICON_MATCHES.items():
            matches = [m for m in members if m.endswith("/" + filename)]
            if not matches:
                raise RuntimeError(f"Official AWS icon not found: {filename}")
            target = extract / filename
            if not target.exists():
                target.write_bytes(archive.read(matches[0]))
            resolved[key] = target

    return {
        key: "data:image/svg+xml;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
        for key, path in resolved.items()
    }


def _service(ident: str, label: str, x: float, y: float, icon: str, w: float = 136, h: float = 116) -> Node:
    return Node(ident, label, x, y, w, h, icon=icon, kind="service", fill="#FFFFFF", stroke="none")


def _chip(ident: str, label: str, x: float, y: float, w: float, h: float = 54, *, fill: str = "#FFFFFF", stroke: str = LINE, color: str = INK) -> Node:
    return Node(ident, label, x, y, w, h, kind="chip", fill=fill, stroke=stroke, color=color)


def _user(ident: str, label: str, x: float, y: float, *, hospital: bool = False) -> Node:
    return Node(ident, label, x, y, 190, 130, kind="hospital" if hospital else "mobile", fill="#FFFFFF", stroke=TEAL if not hospital else PURPLE)


def _common_frontend() -> tuple[list[Group], list[Node], list[Edge]]:
    groups = [Group("frontend", "Frontend", 690, 118, 540, 118, "#FBFCFE", "#8397AA")]
    nodes = [
        _service("amplify", "AWS Amplify\nHosting", 790, 142, "amplify", 135, 84),
        _service("cognito", "Amazon Cognito\nRole Auth", 1020, 142, "cognito", 135, 84),
    ]
    edges = [Edge("amplify", "cognito", "OIDC", NAVY)]
    return groups, nodes, edges


def _common_data_plane(source: str, *, source_x: float, y: float = 770) -> tuple[list[Group], list[Node], list[Edge]]:
    groups = [Group("data-plane", "Clinical Data Plane · confirmed EMS events only", 300, y - 45, 1320, 220, "#F8FCFA", GREEN)]
    nodes = [
        _service("firehose", "Amazon Data Firehose\n(Kinesis Firehose)", 440, y, "firehose", 170, 120),
        _service("s3", "Amazon S3\nImmutable EMS Events", 690, y, "s3", 165, 120),
        _service("eventbridge-fhir", "Amazon EventBridge\nObject Created", 925, y, "eventbridge", 165, 120),
        _service("fhir-mapper", "AWS Lambda\nFHIR R4 Mapper", 1150, y, "lambda", 155, 120),
        _service("healthlake", "AWS HealthLake\nFHIR R4 Datastore", 1370, y, "healthlake", 170, 120),
    ]
    edges = [
        Edge(source, "firehose", "확정 EMS 이벤트", GREEN, points=[(source_x, y - 35), (525, y - 35)], label_pos=(620, y - 55)),
        Edge("firehose", "s3", "buffered delivery", GREEN),
        Edge("s3", "eventbridge-fhir", "Object Created", GREEN),
        Edge("eventbridge-fhir", "fhir-mapper", "invoke", GREEN),
        Edge("fhir-mapper", "healthlake", "FHIR R4 POST/PUT", PURPLE),
    ]
    return groups, nodes, edges


def _base_users() -> list[Node]:
    return [
        _user("ems", "구급대원\n모바일 EMS", 45, 360),
        _user("hospital", "병원 수용 담당자\n웹", 1685, 360, hospital=True),
    ]


def candidate_a() -> Candidate:
    fg, fn, fe = _common_frontend()
    dg, dn, de = _common_data_plane("confirmed", source_x=1215)
    groups = [
        Group("aws", "AWS Cloud · US West (Oregon)", 275, 90, 1370, 900, "#FFFFFF", NAVY, False),
    ] + fg + [
        Group("agentic", "Agentic Workflow · Amazon Bedrock AgentCore Runtime", 650, 260, 510, 355, "#F6FCFB", TEAL),
        Group("state", "Operational State", 1190, 260, 410, 355, "#F8FAFE", BLUE),
    ] + dg
    nodes = _base_users() + fn + [
        _service("api", "Amazon API Gateway\nREST + WebSocket", 315, 330, "api"),
        _service("transcribe", "Amazon Transcribe\nStreaming", 315, 535, "transcribe"),
        _service("lambda", "AWS Lambda\nInput Router", 485, 330, "lambda"),
        _service("agentcore", "Amazon Bedrock\nAgentCore Runtime", 700, 300, "agentcore", 155, 120),
        _service("bedrock", "Amazon Bedrock\nClaude", 945, 300, "bedrock", 145, 120),
        _chip("route", "Voice facts / Manual direct", 675, 465, 185, 50, fill="#E8F6F3", stroke=TEAL),
        _chip("rules", "Rules", 875, 465, 135, 50, fill="#EEF4FF", stroke=BLUE),
        _chip("facility-tools", "Reference tools", 1025, 465, 120, 50, fill="#F4F0FA", stroke=PURPLE),
        _chip("hitl", "구급대원 HITL 확인", 790, 535, 205, 50, fill="#FFF4E5", stroke=ORANGE, color=ORANGE),
        _service("ddb", "Amazon DynamoDB\nConfirmed State", 1220, 300, "dynamodb"),
        _service("appsync", "AWS AppSync\nReal-time Events", 1430, 300, "appsync"),
        _chip("confirmed", "CONFIRMED", 1210, 485, 175, 48, fill="#EAF8F2", stroke=GREEN, color=GREEN),
        _chip("reply", "수용 / 추가정보 / 곤란", 1410, 485, 175, 48, fill="#FFF4F4", stroke=RED, color=RED),
    ] + dn
    edges = fe + [
        Edge("ems", "api", "① 수동 입력", NAVY),
        Edge("ems", "transcribe", "① PTT PCM", GREEN),
        Edge("transcribe", "api", "최종 인식 문장", GREEN),
        Edge("api", "lambda", "② 검증", NAVY),
        Edge("lambda", "agentcore", "③ 음성 문장 + 현재 상태", TEAL),
        Edge("agentcore", "bedrock", "voice extract", TEAL),
        Edge("bedrock", "route", "facts", TEAL),
        Edge("route", "rules", "", TEAL),
        Edge("rules", "facility-tools", "", PURPLE),
        Edge("facility-tools", "hitl", "④ proposal + evidence", ORANGE),
        Edge("hitl", "confirmed", "⑤ 확인", GREEN),
        Edge("confirmed", "ddb", "", GREEN),
        Edge("ddb", "appsync", "⑥ request event", BLUE),
        Edge("appsync", "hospital", "⑦ 수용 문의", BLUE),
        Edge("hospital", "reply", "⑧ 병원 HITL 회신", RED),
        Edge("reply", "agentcore", "추가정보 · 수용곤란 loop", RED, True, points=[(1498, 655), (780, 655)], label_pos=(1140, 672)),
        Edge("confirmed", "firehose", "", GREEN, points=[(1295, 625), (525, 625), (525, 770)]),
    ] + de[1:]
    return Candidate("a-dual-lane-agentic-relay", "A", "Dual-Lane Agentic Relay", "실시간 수용 업무와 FHIR 임상기록을 분리한 권장안", "RECOMMENDED", GREEN, groups, nodes, edges, ["입력", "구조화", "HITL 확인", "병원 문의", "병원 회신", "수용·인계"])


def candidate_b() -> Candidate:
    fg, fn, fe = _common_frontend()
    dg, dn, de = _common_data_plane("confirmed", source_x=1200)
    groups = [
        Group("aws", "AWS Cloud · US West (Oregon)", 275, 90, 1370, 900, "#FFFFFF", NAVY, False),
    ] + fg + [
        Group("workflow", "AWS Step Functions · Human Callback Workflow", 575, 255, 835, 390, "#FFF9F2", ORANGE),
    ] + dg
    nodes = _base_users() + fn + [
        _service("api", "Amazon API Gateway\nREST + WebSocket", 315, 330, "api"),
        _service("transcribe", "Amazon Transcribe\nStreaming", 315, 535, "transcribe"),
        _service("step", "AWS Step Functions\nStandard Workflow", 600, 300, "stepfunctions", 160, 120),
        _service("agentcore", "AgentCore Runtime\nExtract Agent", 790, 300, "agentcore", 150, 120),
        _chip("ems-wait", "구급대원 확인 대기", 970, 322, 175, 58, fill="#FFF4E5", stroke=ORANGE),
        _chip("facility", "병원 참고 조회 · 문의 생성", 1180, 322, 190, 58, fill="#E8F6F3", stroke=TEAL),
        _chip("hospital-wait", "병원 회신 대기", 800, 475, 175, 58, fill="#F4F0FA", stroke=PURPLE),
        _chip("choice", "수용?", 1015, 475, 130, 58, fill="#FFFFFF", stroke=RED, color=RED),
        _chip("accepted", "인계 패키지", 1190, 475, 165, 58, fill="#EAF8F2", stroke=GREEN, color=GREEN),
        _service("ddb", "Amazon DynamoDB\nExecution State", 1435, 430, "dynamodb", 145, 115),
        _chip("confirmed", "CONFIRMED EVENT", 1120, 600, 190, 42, fill="#EAF8F2", stroke=GREEN, color=GREEN),
    ] + dn
    edges = fe + [
        Edge("ems", "api", "① 수동 입력", NAVY),
        Edge("ems", "transcribe", "① PTT PCM", GREEN),
        Edge("transcribe", "api", "최종 인식 문장", GREEN),
        Edge("api", "step", "② start execution", NAVY),
        Edge("step", "agentcore", "③ extract", TEAL),
        Edge("agentcore", "ems-wait", "proposal", ORANGE),
        Edge("ems-wait", "facility", "④ task token", GREEN),
        Edge("facility", "hospital", "⑤ 수용 문의", BLUE),
        Edge("hospital", "hospital-wait", "⑥ task token", PURPLE),
        Edge("hospital-wait", "choice", "reply", RED),
        Edge("choice", "accepted", "수용", GREEN),
        Edge("choice", "facility", "곤란 → next candidate", RED, True, points=[(1080, 560), (1275, 560), (1275, 410)], label_pos=(1210, 580)),
        Edge("choice", "agentcore", "추가정보 → reassess", RED, True, points=[(1040, 585), (865, 585), (865, 420)], label_pos=(930, 605)),
        Edge("accepted", "ddb", "state", GREEN),
        Edge("accepted", "confirmed", "⑦ complete", GREEN),
        Edge("confirmed", "firehose", "", GREEN, points=[(1215, 700), (525, 700), (525, 770)]),
    ] + de[1:]
    return Candidate("b-hitl-state-machine", "B", "HITL State Machine", "두 사람의 확인 대기와 수용곤란 반복을 상태기계로 명시", "WORKFLOW FIRST", ORANGE, groups, nodes, edges, ["입력", "Agent 추출", "구급대원 확인", "병원 문의", "병원 회신", "Choice · Loop", "인계"])


def candidate_c() -> Candidate:
    fg, fn, fe = _common_frontend()
    dg, dn, de = _common_data_plane("confirmed", source_x=1240)
    groups = [
        Group("aws", "AWS Cloud · US West (Oregon)", 275, 90, 1370, 900, "#FFFFFF", NAVY, False),
    ] + fg + [
        Group("mesh", "Amazon Bedrock AgentCore · Tool Mesh", 570, 250, 750, 405, "#F6FCFB", TEAL),
    ] + dg
    nodes = _base_users() + fn + [
        _service("api", "Amazon API Gateway\nREST + WebSocket", 315, 330, "api"),
        _service("transcribe", "Amazon Transcribe\nStreaming", 315, 535, "transcribe"),
        _service("agentcore", "AgentCore Runtime\nLangGraph Supervisor", 610, 285, "agentcore", 170, 120),
        _service("bedrock", "Amazon Bedrock\nClaude", 830, 285, "bedrock", 145, 120),
        _service("gateway", "AgentCore Gateway\nGoverned Tools", 1035, 285, "api", 160, 120),
        _chip("tool-fhir", "FHIR Writer", 610, 475, 145, 55, fill="#F4F0FA", stroke=PURPLE),
        _chip("tool-facility", "NMC · HIRA · Kakao", 785, 475, 180, 55, fill="#EEF4FF", stroke=BLUE),
        _chip("tool-request", "Request Publisher", 995, 475, 155, 55, fill="#E8F6F3", stroke=TEAL),
        _chip("tool-report", "Handoff Report", 1175, 475, 125, 55, fill="#FFF4E5", stroke=ORANGE),
        _chip("hitl", "구급대원 HITL", 790, 565, 175, 52, fill="#FFF4E5", stroke=ORANGE, color=ORANGE),
        _service("ddb", "Amazon DynamoDB\nConfirmed State", 1360, 300, "dynamodb"),
        _service("appsync", "AWS AppSync\nRequest & Reply", 1510, 300, "appsync"),
        _chip("confirmed", "CONFIRMED", 1140, 600, 170, 42, fill="#EAF8F2", stroke=GREEN, color=GREEN),
    ] + dn
    edges = fe + [
        Edge("ems", "api", "① 수동 입력", NAVY),
        Edge("ems", "transcribe", "① PTT PCM", GREEN),
        Edge("transcribe", "api", "최종 인식 문장", GREEN),
        Edge("api", "agentcore", "② session", TEAL),
        Edge("agentcore", "bedrock", "reason · extract", TEAL),
        Edge("bedrock", "gateway", "③ tool selection", TEAL),
        Edge("gateway", "tool-fhir", "call", PURPLE),
        Edge("gateway", "tool-facility", "call", BLUE),
        Edge("gateway", "tool-request", "call", TEAL),
        Edge("gateway", "tool-report", "call", ORANGE),
        Edge("agentcore", "hitl", "④ proposal", ORANGE),
        Edge("hitl", "confirmed", "⑤ confirm", GREEN),
        Edge("confirmed", "ddb", "write", GREEN),
        Edge("ddb", "appsync", "⑥ publish", BLUE),
        Edge("appsync", "hospital", "⑦ 문의", BLUE),
        Edge("hospital", "agentcore", "⑧ reply · resume", RED, True, points=[(1690, 650), (695, 650), (695, 405)], label_pos=(1220, 670)),
        Edge("confirmed", "firehose", "", GREEN, points=[(1225, 700), (525, 700), (525, 770)]),
    ] + de[1:]
    return Candidate("c-agentcore-tool-mesh", "C", "AgentCore Tool Mesh", "AgentCore가 병원 참고·FHIR·문의·인계 도구를 선택하는 구조", "AGENTIC FIRST", TEAL, groups, nodes, edges, ["입력", "Supervisor", "도구 선택", "HITL", "문의 발행", "병원 회신", "Agent resume"])


def candidate_d() -> Candidate:
    fg, fn, fe = _common_frontend()
    dg, dn, de = _common_data_plane("eventbus", source_x=720)
    groups = [
        Group("aws", "AWS Cloud · US West (Oregon)", 275, 90, 1370, 900, "#FFFFFF", NAVY, False),
    ] + fg + [
        Group("agents", "Event-driven Multi-Agent Choreography", 700, 250, 650, 410, "#F6FCFB", TEAL),
    ] + dg
    nodes = _base_users() + fn + [
        _service("api", "Amazon API Gateway\nREST + WebSocket", 315, 330, "api"),
        _service("transcribe", "Amazon Transcribe\nStreaming", 315, 535, "transcribe"),
        _service("eventbus", "Amazon EventBridge\nCase Event Bus", 520, 330, "eventbridge", 155, 120),
        _service("intake-agent", "AgentCore Runtime\nIntake Agent", 735, 290, "agentcore", 145, 115),
        _service("fhir-agent", "AgentCore Runtime\nFHIR Agent", 930, 290, "agentcore", 145, 115),
        _service("facility-agent", "AgentCore Runtime\nFacility Agent", 1125, 290, "agentcore", 145, 115),
        _service("handoff-agent", "AgentCore Runtime\nHandoff Agent", 835, 480, "agentcore", 145, 115),
        _chip("agent-hitl", "HITL events", 1050, 505, 170, 55, fill="#FFF4E5", stroke=ORANGE),
        _service("ddb", "Amazon DynamoDB\nEvent State", 1390, 300, "dynamodb"),
        _service("appsync", "AWS AppSync\nLive Projection", 1530, 470, "appsync"),
    ] + dn
    edges = fe + [
        Edge("ems", "api", "① 수동 입력", NAVY),
        Edge("ems", "transcribe", "① PTT PCM", GREEN),
        Edge("transcribe", "api", "최종 인식 문장", GREEN),
        Edge("api", "eventbus", "② publish", BLUE),
        Edge("eventbus", "intake-agent", "transcript.ready", TEAL),
        Edge("intake-agent", "fhir-agent", "facts.proposed", TEAL),
        Edge("fhir-agent", "facility-agent", "facts.confirmed", GREEN),
        Edge("facility-agent", "handoff-agent", "③ candidate.proposed", ORANGE, points=[(1195, 440), (907, 440), (907, 480)]),
        Edge("handoff-agent", "agent-hitl", "④ request draft", ORANGE),
        Edge("agent-hitl", "ddb", "conditional write", GREEN),
        Edge("ddb", "appsync", "⑤ project", BLUE),
        Edge("appsync", "hospital", "⑥ inquiry", BLUE),
        Edge("hospital", "eventbus", "⑦ reply event", RED, True, points=[(1690, 690), (595, 690), (595, 450)], label_pos=(1140, 710)),
        Edge("eventbus", "firehose", "confirmed events", GREEN, points=[(595, 700), (525, 700), (525, 770)]),
    ] + de[1:]
    return Candidate("d-event-driven-multi-agent", "D", "Event-Driven Multi-Agent", "역할별 Agent가 사건 이벤트를 이어받는 확장형 목표 구조", "TARGET · MULTI-AGENT", PURPLE, groups, nodes, edges, ["이벤트 입력", "Intake Agent", "FHIR Agent", "Facility Agent", "Handoff Agent", "병원 회신 이벤트"])


def candidate_e() -> Candidate:
    fg, fn, fe = _common_frontend()
    groups = [
        Group("aws", "AWS Cloud · US West (Oregon)", 275, 90, 1370, 900, "#FFFFFF", NAVY, False),
    ] + fg + [
        Group("hot", "Real-time Processing", 680, 250, 700, 350, "#F6FCFB", TEAL),
        Group("data-plane", "Event Archive & FHIR Projection", 420, 700, 1110, 245, "#F8FCFA", GREEN),
    ]
    nodes = _base_users() + fn + [
        _service("api", "Amazon API Gateway\nEvent Ingress", 315, 330, "api"),
        _service("transcribe", "Amazon Transcribe\nStreaming", 315, 535, "transcribe"),
        _service("kinesis", "Amazon Kinesis\nData Streams", 500, 330, "kinesis", 145, 120),
        _service("agentcore", "AgentCore Runtime\nStream Consumer", 730, 290, "agentcore", 155, 120),
        _service("bedrock", "Amazon Bedrock\nClaude", 940, 290, "bedrock", 140, 120),
        _chip("hitl", "구급대원 HITL", 765, 480, 170, 54, fill="#FFF4E5", stroke=ORANGE),
        _service("ddb", "Amazon DynamoDB\nMaterialized State", 1120, 290, "dynamodb", 155, 120),
        _service("appsync", "AWS AppSync\nReal-time Events", 1310, 290, "appsync", 145, 120),
        _service("firehose", "Amazon Data Firehose", 500, 760, "firehose", 155, 120),
        _service("s3", "Amazon S3\nImmutable Event Log", 720, 760, "s3", 155, 120),
        _service("fhir-mapper", "AWS Lambda\nFHIR Projector", 950, 760, "lambda", 150, 120),
        _service("healthlake", "AWS HealthLake\nFHIR R4 Datastore", 1180, 760, "healthlake", 165, 120),
    ]
    edges = fe + [
        Edge("ems", "api", "① 수동 EMS event", NAVY),
        Edge("ems", "transcribe", "① PTT PCM", GREEN),
        Edge("transcribe", "api", "최종 인식 문장", GREEN),
        Edge("api", "kinesis", "② PutRecord", BLUE),
        Edge("kinesis", "agentcore", "low-latency consumer", TEAL),
        Edge("agentcore", "bedrock", "③ extract", TEAL),
        Edge("agentcore", "hitl", "④ proposal", ORANGE),
        Edge("hitl", "ddb", "⑤ confirm", GREEN),
        Edge("ddb", "appsync", "⑥ publish", BLUE),
        Edge("appsync", "hospital", "⑦ inquiry", BLUE),
        Edge("hospital", "kinesis", "⑧ reply event", RED, True, points=[(1690, 650), (575, 650), (575, 450)], label_pos=(1150, 670)),
        Edge("kinesis", "firehose", "archive branch", GREEN, points=[(575, 620), (575, 760)]),
        Edge("firehose", "s3", "buffered delivery", GREEN),
        Edge("s3", "fhir-mapper", "Object Created", GREEN),
        Edge("fhir-mapper", "healthlake", "FHIR R4 POST/PUT", PURPLE),
    ]
    return Candidate("e-true-streaming-event-sourcing", "E", "True Streaming Event Sourcing", "Kinesis Data Streams로 실시간 처리하고 Firehose는 보관에 전용", "STREAMING FIRST", BLUE, groups, nodes, edges, ["EMS Event", "Kinesis Stream", "Agent 처리", "HITL", "병원 회신 Event", "S3 Replay", "FHIR Projection"])


def candidate_f() -> Candidate:
    fg, fn, fe = _common_frontend()
    groups = [
        Group("aws", "AWS Cloud · US West (Oregon)", 275, 90, 1370, 900, "#FFFFFF", NAVY, False),
    ] + fg + [
        Group("compiler", "Agentic FHIR Compiler", 560, 255, 545, 360, "#F8F6FC", PURPLE),
        Group("data-plane", "FHIR-first Clinical Repository", 490, 700, 980, 245, "#F8FCFA", GREEN),
    ]
    nodes = _base_users() + fn + [
        _service("api", "Amazon API Gateway\nEMS Ingress", 315, 330, "api"),
        _service("transcribe", "Amazon Transcribe\nStreaming", 315, 535, "transcribe"),
        _service("agentcore", "AgentCore Runtime\nClinical Structurer", 610, 300, "agentcore", 160, 120),
        _service("bedrock", "Amazon Bedrock\nClaude", 865, 300, "bedrock", 145, 120),
        _chip("fhir-bundle", "Patient · Encounter · Observation · Communication", 625, 480, 425, 58, fill="#F4F0FA", stroke=PURPLE),
        _chip("hitl", "구급대원 FHIR 인계본 확인", 690, 555, 280, 50, fill="#FFF4E5", stroke=ORANGE, color=ORANGE),
        _service("ddb", "Amazon DynamoDB\nRequest State", 1180, 300, "dynamodb"),
        _service("appsync", "AWS AppSync\nHospital Exchange", 1390, 300, "appsync"),
        _service("firehose", "Amazon Data Firehose\nFHIR NDJSON", 540, 760, "firehose", 170, 120),
        _service("s3", "Amazon S3\nFHIR Landing Zone", 780, 760, "s3", 165, 120),
        _service("fhir-mapper", "AWS Lambda\nValidation & Write", 1010, 760, "lambda", 165, 120),
        _service("healthlake", "AWS HealthLake\nFHIR R4 Datastore", 1250, 760, "healthlake", 170, 120),
    ]
    edges = fe + [
        Edge("ems", "api", "① 수동 입력", NAVY),
        Edge("ems", "transcribe", "① PTT PCM", GREEN),
        Edge("transcribe", "api", "최종 인식 문장", GREEN),
        Edge("api", "agentcore", "② clinical text", TEAL),
        Edge("agentcore", "bedrock", "extract · map", TEAL),
        Edge("bedrock", "fhir-bundle", "③ draft bundle", PURPLE),
        Edge("fhir-bundle", "hitl", "④ evidence", ORANGE),
        Edge("hitl", "ddb", "⑤ confirmed request", GREEN),
        Edge("ddb", "appsync", "⑥ standard handoff", BLUE),
        Edge("appsync", "hospital", "⑦ inquiry", BLUE),
        Edge("hospital", "agentcore", "⑧ missing info · reply", RED, True, points=[(1690, 650), (690, 650), (690, 420)], label_pos=(1200, 670)),
        Edge("hitl", "firehose", "confirmed FHIR event", GREEN, points=[(830, 680), (625, 680), (625, 760)]),
        Edge("firehose", "s3", "buffered NDJSON", GREEN),
        Edge("s3", "fhir-mapper", "Object Created", GREEN),
        Edge("fhir-mapper", "healthlake", "FHIR R4 POST/PUT", PURPLE),
    ]
    return Candidate("f-fhir-first-clinical-relay", "F", "FHIR-First Clinical Relay", "확정 환자정보를 표준 인계 패키지와 HealthLake 원장으로 동시 전환", "FHIR FIRST", PURPLE, groups, nodes, edges, ["EMS 입력", "FHIR Compiler", "HITL", "표준 문의", "병원 회신", "FHIR 저장", "인계 완료"])


def _node_map(candidate: Candidate) -> dict[str, Node]:
    return {node.ident: node for node in candidate.nodes}


def _anchor(node: Node, toward: Node | None = None) -> tuple[float, float]:
    if toward is None:
        return node.x + node.w / 2, node.y + node.h / 2
    sx, sy = node.x + node.w / 2, node.y + node.h / 2
    tx, ty = toward.x + toward.w / 2, toward.y + toward.h / 2
    if abs(tx - sx) >= abs(ty - sy):
        return (node.x + node.w, sy) if tx >= sx else (node.x, sy)
    return (sx, node.y + node.h) if ty >= sy else (sx, node.y)


def _edge_points(edge: Edge, nodes: dict[str, Node]) -> list[tuple[float, float]]:
    source = nodes[edge.source]
    target = nodes[edge.target]
    start = _anchor(source, target)
    end = _anchor(target, source)
    if edge.points:
        return [start, *edge.points, end]
    if abs(start[1] - end[1]) < 35 or abs(start[0] - end[0]) < 35:
        return [start, end]
    mid_x = (start[0] + end[0]) / 2
    return [start, (mid_x, start[1]), (mid_x, end[1]), end]


def _polyline_midpoint(points: list[tuple[float, float]]) -> tuple[float, float]:
    segments = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:])]
    remaining = sum(segments) / 2
    for (a, b), length in zip(zip(points, points[1:]), segments):
        if remaining <= length:
            ratio = 0 if length == 0 else remaining / length
            return a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio
        remaining -= length
    return points[-1]


def _multiline_svg(label: str, x: float, y: float, *, size: int = 17, weight: int = 600, color: str = INK, anchor: str = "middle") -> str:
    lines = label.split("\n")
    first_y = y - (len(lines) - 1) * (size + 3) / 2
    spans = []
    for index, line in enumerate(lines):
        spans.append(f'<tspan x="{x:.1f}" y="{first_y + index * (size + 3):.1f}">{html.escape(line)}</tspan>')
    return f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" font-family="Malgun Gothic, Arial, sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}">{"".join(spans)}</text>'


def render_svg(candidate: Candidate, icons: dict[str, str], path: Path) -> None:
    nodes = _node_map(candidate)
    marker_colors = {edge.color for edge in candidate.edges}
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">',
        "<defs>",
        '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#17324D" flood-opacity="0.10"/></filter>',
    ]
    for color in marker_colors:
        key = color.lstrip("#")
        parts.append(f'<marker id="arrow-{key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="{color}"/></marker>')
    parts.extend(["</defs>", f'<rect width="{WIDTH}" height="{HEIGHT}" fill="{BG}"/>'])
    parts.append(_multiline_svg(f"{candidate.letter}안  {candidate.title}", 55, 47, size=30, weight=700, color=NAVY, anchor="start"))
    parts.append(_multiline_svg(candidate.subtitle, 57, 82, size=16, weight=400, color=MUTED, anchor="start"))
    badge_w = max(180, len(candidate.badge) * 12 + 40)
    parts.append(f'<rect x="{WIDTH - badge_w - 55}" y="28" width="{badge_w}" height="42" rx="20" fill="{candidate.badge_color}" fill-opacity="0.10" stroke="{candidate.badge_color}" stroke-width="1.5"/>')
    parts.append(_multiline_svg(candidate.badge, WIDTH - badge_w / 2 - 55, 54, size=15, weight=700, color=candidate.badge_color))

    for group in candidate.groups:
        dash = ' stroke-dasharray="8 7"' if group.dashed else ""
        parts.append(f'<rect x="{group.x}" y="{group.y}" width="{group.w}" height="{group.h}" rx="16" fill="{group.fill}" stroke="{group.stroke}" stroke-width="2"{dash}/>')
        parts.append(_multiline_svg(group.title, group.x + 18, group.y + 28, size=17, weight=700, color=INK, anchor="start"))

    for edge in candidate.edges:
        pts = _edge_points(edge, nodes)
        points = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        dash = ' stroke-dasharray="8 6"' if edge.dashed else ""
        parts.append(f'<polyline points="{points}" fill="none" stroke="{edge.color}" stroke-width="2.4" stroke-linejoin="round" marker-end="url(#arrow-{edge.color.lstrip("#")})"{dash}/>')
        if edge.label:
            if edge.label_pos:
                lx, ly = edge.label_pos
            else:
                middle = _polyline_midpoint(pts)
                lx, ly = middle[0], middle[1] - 12
            label_w = max(74, min(250, len(edge.label) * 8.2 + 22))
            parts.append(f'<rect x="{lx - label_w / 2:.1f}" y="{ly - 17:.1f}" width="{label_w:.1f}" height="24" rx="5" fill="#FFFFFF" fill-opacity="0.95"/>')
            parts.append(_multiline_svg(edge.label, lx, ly, size=13, weight=600, color=edge.color))

    for node in candidate.nodes:
        if node.kind == "service":
            if node.icon:
                icon_size = min(68, node.h - 40)
                ix = node.x + (node.w - icon_size) / 2
                iy = node.y + 2
                parts.append(f'<image x="{ix:.1f}" y="{iy:.1f}" width="{icon_size}" height="{icon_size}" href="{icons[node.icon]}"/>')
            parts.append(_multiline_svg(node.label, node.x + node.w / 2, node.y + node.h - 25, size=14, weight=600, color=node.color))
        elif node.kind == "chip":
            parts.append(f'<rect x="{node.x}" y="{node.y}" width="{node.w}" height="{node.h}" rx="12" fill="{node.fill}" stroke="{node.stroke}" stroke-width="1.6" filter="url(#shadow)"/>')
            parts.append(_multiline_svg(node.label, node.x + node.w / 2, node.y + node.h / 2 + 5, size=14, weight=650, color=node.color))
        else:
            parts.append(f'<rect x="{node.x}" y="{node.y}" width="{node.w}" height="{node.h}" rx="18" fill="{node.fill}" stroke="{node.stroke}" stroke-width="2.2" filter="url(#shadow)"/>')
            if node.kind == "mobile":
                parts.append(f'<rect x="{node.x + 20}" y="{node.y + 25}" width="42" height="70" rx="8" fill="none" stroke="{TEAL}" stroke-width="3"/><circle cx="{node.x + 41}" cy="{node.y + 84}" r="3" fill="{TEAL}"/>')
            else:
                parts.append(f'<path d="M {node.x + 22} {node.y + 91} V {node.y + 51} H {node.x + 65} V {node.y + 91} M {node.x + 31} {node.y + 60} H {node.x + 56} M {node.x + 43.5} {node.y + 48} V {node.y + 72}" fill="none" stroke="{PURPLE}" stroke-width="3" stroke-linecap="round"/>')
            parts.append(_multiline_svg(node.label, node.x + 125, node.y + 64, size=17, weight=700, color=INK))

    step_y = 1012
    parts.append(f'<line x1="300" y1="{step_y}" x2="1620" y2="{step_y}" stroke="#D8E1E9" stroke-width="2"/>')
    gap = 1320 / max(1, len(candidate.steps) - 1)
    for index, step in enumerate(candidate.steps):
        x = 300 + index * gap
        parts.append(f'<circle cx="{x:.1f}" cy="{step_y}" r="15" fill="{candidate.badge_color}"/>')
        parts.append(_multiline_svg(str(index + 1), x, step_y + 5, size=12, weight=700, color="#FFFFFF"))
        parts.append(_multiline_svg(step, x, step_y + 39, size=13, weight=600, color=INK))
    parts.append(_multiline_svg("실선: 처리 · 파랑: 실시간 · 초록: 확정 임상데이터 · 빨강 점선: 추가정보/수용곤란 반복", 960, 1067, size=12, weight=400, color=MUTED))
    parts.append("</svg>")
    path.write_text("\n".join(parts), encoding="utf-8")


def _drawio_image_style(data_uri: str) -> str:
    return f"shape=image;html=1;imageAspect=0;aspect=fixed;image={data_uri};"


def render_drawio(candidate: Candidate, icons: dict[str, str], path: Path) -> None:
    mxfile = ET.Element("mxfile", {"host": "app.diagrams.net", "modified": "2026-08-04T00:00:00.000Z", "agent": "EMS Relay candidate generator", "version": "24.7.17", "type": "device"})
    diagram = ET.SubElement(mxfile, "diagram", {"id": candidate.slug, "name": f"{candidate.letter} {candidate.title}"})
    model = ET.SubElement(diagram, "mxGraphModel", {"dx": str(WIDTH), "dy": str(HEIGHT), "grid": "1", "gridSize": "10", "guides": "1", "tooltips": "1", "connect": "1", "arrows": "1", "fold": "1", "page": "1", "pageScale": "1", "pageWidth": str(WIDTH), "pageHeight": str(HEIGHT), "math": "0", "shadow": "0"})
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", {"id": "0"})
    ET.SubElement(root, "mxCell", {"id": "1", "parent": "0"})

    def vertex(ident: str, value: str, x: float, y: float, w: float, h: float, style: str) -> None:
        cell = ET.SubElement(root, "mxCell", {"id": ident, "value": value, "style": style, "vertex": "1", "parent": "1"})
        ET.SubElement(cell, "mxGeometry", {"x": str(x), "y": str(y), "width": str(w), "height": str(h), "as": "geometry"})

    vertex("background", "", 0, 0, WIDTH, HEIGHT, "shape=rect;fillColor=#FFFFFF;strokeColor=none;")
    vertex("title", f"{candidate.letter}안  {candidate.title}", 55, 20, 1100, 45, f"text;html=1;strokeColor=none;fillColor=none;fontFamily=Malgun Gothic;fontSize=30;fontStyle=1;fontColor={NAVY};align=left;verticalAlign=middle;")
    vertex("subtitle", candidate.subtitle, 57, 65, 1100, 30, f"text;html=1;strokeColor=none;fillColor=none;fontFamily=Malgun Gothic;fontSize=16;fontColor={MUTED};align=left;verticalAlign=middle;")
    vertex("badge", candidate.badge, 1645, 28, 220, 42, f"rounded=1;arcSize=40;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor={candidate.badge_color};fontFamily=Arial;fontSize=14;fontStyle=1;fontColor={candidate.badge_color};align=center;verticalAlign=middle;")

    for group in candidate.groups:
        vertex(group.ident, group.title, group.x, group.y, group.w, group.h, f"rounded=1;arcSize=16;whiteSpace=wrap;html=1;fillColor={group.fill};strokeColor={group.stroke};strokeWidth=2;dashed={1 if group.dashed else 0};dashPattern=6 5;verticalAlign=top;align=left;spacingTop=12;spacingLeft=14;fontFamily=Malgun Gothic;fontSize=17;fontStyle=1;fontColor={INK};")

    for node in candidate.nodes:
        if node.kind == "service":
            icon_size = min(68, node.h - 40)
            vertex(node.ident, "", node.x + (node.w - icon_size) / 2, node.y + 2, icon_size, icon_size, _drawio_image_style(icons[node.icon]))
            vertex(node.ident + "-label", node.label.replace("\n", "<br>"), node.x, node.y + node.h - 49, node.w, 48, f"text;html=1;strokeColor=none;fillColor=none;whiteSpace=wrap;fontFamily=Malgun Gothic;fontSize=14;fontStyle=1;fontColor={node.color};align=center;verticalAlign=middle;")
        else:
            value = node.label.replace("\n", "<br>")
            style = f"rounded=1;arcSize=18;whiteSpace=wrap;html=1;fillColor={node.fill};strokeColor={node.stroke};strokeWidth=2;fontFamily=Malgun Gothic;fontSize={17 if node.kind in ('mobile','hospital') else 14};fontStyle=1;fontColor={node.color};align=center;verticalAlign=middle;"
            vertex(node.ident, value, node.x, node.y, node.w, node.h, style)

    nodes = _node_map(candidate)
    for index, edge in enumerate(candidate.edges):
        style = f"edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor={edge.color};strokeWidth=2.4;dashed={1 if edge.dashed else 0};dashPattern=8 6;endArrow=block;endFill=1;fontFamily=Malgun Gothic;fontSize=13;fontColor={edge.color};labelBackgroundColor=#FFFFFF;"
        cell = ET.SubElement(root, "mxCell", {"id": f"edge-{index}", "value": edge.label, "style": style, "edge": "1", "parent": "1", "source": edge.source, "target": edge.target})
        geometry = ET.SubElement(cell, "mxGeometry", {"relative": "1", "as": "geometry"})
        if edge.points:
            array = ET.SubElement(geometry, "Array", {"as": "points"})
            for x, y in edge.points:
                ET.SubElement(array, "mxPoint", {"x": str(x), "y": str(y)})

    step_gap = 1320 / max(1, len(candidate.steps) - 1)
    for index, step in enumerate(candidate.steps):
        x = 270 + index * step_gap
        vertex(f"step-{index}", f"{index + 1}<br>{step}", x, 995, 100, 60, f"ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor={candidate.badge_color};strokeColor={candidate.badge_color};fontFamily=Malgun Gothic;fontSize=12;fontStyle=1;fontColor=#FFFFFF;align=center;verticalAlign=middle;")

    ET.indent(mxfile, space="  ")
    path.write_text(ET.tostring(mxfile, encoding="unicode"), encoding="utf-8-sig")


def _edge_binary() -> str | None:
    candidates = [
        shutil.which("msedge"),
        shutil.which("chrome"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    return next((str(path) for path in candidates if path and Path(path).exists()), None)


def render_png(svg: Path, png: Path) -> None:
    browser = _edge_binary()
    if not browser:
        raise RuntimeError("Microsoft Edge or Chrome is required to render PNG files")
    profile = Path(tempfile.gettempdir()) / f"ems-relay-arch-{uuid.uuid4().hex}"
    subprocess.run(
        [
            browser,
            "--headless",
            "--disable-gpu",
            "--hide-scrollbars",
            "--no-first-run",
            f"--user-data-dir={profile}",
            f"--window-size={WIDTH},{HEIGHT}",
            f"--screenshot={png}",
            svg.resolve().as_uri(),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    shutil.rmtree(profile, ignore_errors=True)


def render_overview(candidates: list[Candidate]) -> None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return
    tile_w, tile_h = 1280, 720
    canvas = Image.new("RGB", (tile_w * 3, tile_h * 2), "white")
    for index, candidate in enumerate(candidates):
        image = Image.open(OUT / f"{candidate.slug}.png").convert("RGB")
        image.thumbnail((tile_w, tile_h), Image.Resampling.LANCZOS)
        x = (index % 3) * tile_w
        y = (index // 3) * tile_h
        canvas.paste(image, (x, y))
    canvas.save(OUT / "ems-relay-agentic-candidates-overview.png", quality=95)


def write_readme(candidates: list[Candidate]) -> None:
    rows = [
        "# EMS Relay Agentic Architecture Candidates",
        "",
        "관제센터를 제외하고 구급대원 모바일과 병원 수용 담당자 웹만 남긴 목표 아키텍처 후보입니다.",
        "",
        "| 후보 | 초점 | 권장 용도 |",
        "|---|---|---|",
    ]
    uses = {
        "A": "실시간 업무와 FHIR 기록의 균형 · MVP 최종안",
        "B": "HITL 대기와 수용곤란 반복을 명확히 설명",
        "C": "AgentCore 도구 사용과 Agentic USP 발표",
        "D": "역할별 멀티에이전트 목표 구조",
        "E": "진짜 스트리밍·재처리·이벤트 소싱",
        "F": "FHIR 표준 인계와 HealthLake 중심 USP",
    }
    for candidate in candidates:
        rows.append(f"| [{candidate.letter}안 · {candidate.title}]({candidate.slug}.png) | {candidate.subtitle} | {uses[candidate.letter]} |")
    rows.extend(
        [
            "",
            "## 공통 설계 원칙",
            "",
            "- 병원 수용 요청·회신은 API Gateway/AppSync/DynamoDB의 저지연 운영 경로로 처리합니다.",
            "- Amazon Data Firehose는 버퍼링되는 S3 임상 이벤트 적재 경로이며 수용 회신 경로가 아닙니다.",
            "- S3와 HealthLake 사이에는 EventBridge와 FHIR Mapper Lambda가 있으며 FHIR R4 REST API로 기록합니다.",
            "- 수동 구조화 입력은 Agent를 우회하고, 음성·구어체만 Agent가 구조화한 뒤 구급대원이 확인합니다.",
            "- 병원 담당자가 수용 가능·추가정보 요청·수용 곤란을 직접 확정합니다.",
            "- 원본 WAV는 보관하지 않고 확정 문장과 구조화 이벤트만 기록합니다.",
            "",
            "## AWS 기술 근거",
            "",
            "- [Amazon Data Firehose의 S3 버퍼 전송](https://docs.aws.amazon.com/firehose/latest/dev/basic-deliver.html)",
            "- [HealthLake FHIR R4 REST 리소스 관리](https://docs.aws.amazon.com/healthlake/latest/devguide/managing-fhir-resources.html)",
            "- [HealthLake의 S3 비동기 일괄 가져오기](https://docs.aws.amazon.com/healthlake/latest/devguide/importing-fhir-data.html)",
            "- [API Gateway WebSocket 양방향 통신](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api.html)",
            "- [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html)",
            "- [AWS 공식 아키텍처 아이콘](https://aws.amazon.com/architecture/icons/)",
            "",
            "각 후보는 `.drawio`, `.svg`, `.png` 형식으로 제공됩니다.",
        ]
    )
    (OUT / "README.md").write_text("\n".join(rows) + "\n", encoding="utf-8")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icons = _find_or_download_icons()
    candidates = [candidate_a(), candidate_b(), candidate_c(), candidate_d(), candidate_e(), candidate_f()]
    for candidate in candidates:
        svg = OUT / f"{candidate.slug}.svg"
        drawio = OUT / f"{candidate.slug}.drawio"
        png = OUT / f"{candidate.slug}.png"
        render_svg(candidate, icons, svg)
        render_drawio(candidate, icons, drawio)
        render_png(svg, png)
    render_overview(candidates)
    write_readme(candidates)
    print(f"Generated {len(candidates)} architecture candidates in {OUT}")


if __name__ == "__main__":
    main()
