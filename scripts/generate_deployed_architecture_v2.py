"""Generate the authoritative EMS Relay Seoul v2 architecture artifacts.

The diagram intentionally mirrors ``backend/template-v2.yaml`` and the two
deployed frontend routes (``/paramedic`` and ``/hospital``).  It is deliberately
small: one authenticated AppSync API, three Lambda-backed paths, one matching
queue, external reference APIs, and one DynamoDB table.

Outputs:
  - docs/architecture/ems-relay-deployed-architecture-v2.drawio
  - docs/architecture/ems-relay-deployed-architecture-v2.svg
  - docs/architecture/ems-relay-deployed-architecture-v2.png

Only the Python standard library is required.  Official AWS service artwork is
reused from the embedded SVG images in the repository's editable Draw.io files.
Once generated, the v2 Draw.io output itself contains every required icon and
is therefore the preferred source for subsequent runs.
"""

from __future__ import annotations

import base64
import html
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARCH = ROOT / "docs" / "architecture"
DRAWIO = ARCH / "ems-relay-deployed-architecture-v2.drawio"
SVG = ARCH / "ems-relay-deployed-architecture-v2.svg"
PNG = ARCH / "ems-relay-deployed-architecture-v2.png"

ICON_SOURCES = (
    DRAWIO,
    ARCH / "ems-relay-aws-serverless-architecture.drawio",
    ARCH / "agentic-candidates" / "a-dual-lane-agentic-relay.drawio",
)

WIDTH = 2560
HEIGHT = 1440

INK = "#172B4D"
NAVY = "#0B2942"
MUTED = "#5F7182"
LINE = "#8EA2B4"
TEAL = "#008C95"
GREEN = "#15966B"
ORANGE = "#E87922"
BLUE = "#2F6FED"
RED = "#D64045"
PURPLE = "#6A4BBC"


ICON_ALIASES: dict[str, tuple[str, ...]] = {
    "amplify": ("icon-amplify", "amplify-icon"),
    "cognito": ("icon-cognito", "cognito-icon"),
    "appsync": ("icon-appsync", "appsync-icon"),
    "lambda": ("icon-lambda-manual", "orchestrator-icon", "lambda-icon", "fanout-icon"),
    "transcribe": ("icon-transcribe", "transcribe-icon-fix", "transcribe-icon"),
    "bedrock": ("icon-bedrock", "bedrock-icon"),
    "sqs": ("icon-sqs", "sqs-dlq-icon"),
    "dynamodb": ("icon-dynamodb", "case-table-icon", "ddb-icon"),
    "secrets": ("icon-secrets", "secrets-icon"),
    "cloudwatch": ("icon-cloudwatch", "cloudwatch-icon"),
    "xray": ("icon-xray", "xray-icon"),
}


def _icon_styles() -> dict[str, str]:
    """Load embedded official AWS SVG styles from editable Draw.io sources."""

    found: dict[str, str] = {}
    by_id: dict[str, str] = {}
    for source in ICON_SOURCES:
        if not source.exists():
            continue
        try:
            tree = ET.parse(source)
        except ET.ParseError:
            continue
        for cell in tree.getroot().iter("mxCell"):
            style = cell.attrib.get("style", "")
            if "image=data:image/svg" in style:
                by_id.setdefault(cell.attrib.get("id", ""), style)

    for key, aliases in ICON_ALIASES.items():
        for alias in aliases:
            if alias in by_id:
                found[key] = by_id[alias]
                break
    missing = sorted(set(ICON_ALIASES) - set(found))
    if missing:
        raise RuntimeError(f"Missing embedded AWS icon styles: {missing}")
    return found


def _image_uri(style: str) -> str:
    match = re.search(r"image=(data:image/svg\+xml;base64,[^;]+)", style)
    if not match:
        raise ValueError("Embedded image data URI not found")
    return match.group(1)


class Drawio:
    def __init__(self, icon_styles: dict[str, str]) -> None:
        self.icon_styles = icon_styles
        self.mxfile = ET.Element(
            "mxfile",
            {
                "host": "app.diagrams.net",
                "modified": "2026-08-05T00:00:00.000Z",
                "agent": "EMS Relay Seoul v2 architecture generator",
                "version": "24.7.17",
                "type": "device",
            },
        )
        diagram = ET.SubElement(
            self.mxfile,
            "diagram",
            {"id": "ems-relay-seoul-v2", "name": "EMS Relay Seoul v2"},
        )
        self.model = ET.SubElement(
            diagram,
            "mxGraphModel",
            {
                "dx": str(WIDTH),
                "dy": str(HEIGHT),
                "grid": "1",
                "gridSize": "10",
                "guides": "1",
                "tooltips": "1",
                "connect": "1",
                "arrows": "1",
                "fold": "1",
                "page": "1",
                "pageScale": "1",
                "pageWidth": str(WIDTH),
                "pageHeight": str(HEIGHT),
                "math": "0",
                "shadow": "0",
            },
        )
        self.root = ET.SubElement(self.model, "root")
        ET.SubElement(self.root, "mxCell", {"id": "0"})
        ET.SubElement(self.root, "mxCell", {"id": "1", "parent": "0"})

    def vertex(
        self,
        ident: str,
        value: str,
        x: float,
        y: float,
        w: float,
        h: float,
        style: str,
        parent: str = "1",
    ) -> None:
        cell = ET.SubElement(
            self.root,
            "mxCell",
            {"id": ident, "value": value, "style": style, "vertex": "1", "parent": parent},
        )
        ET.SubElement(
            cell,
            "mxGeometry",
            {"x": str(x), "y": str(y), "width": str(w), "height": str(h), "as": "geometry"},
        )

    def text(
        self,
        ident: str,
        value: str,
        x: float,
        y: float,
        w: float,
        h: float,
        *,
        size: int = 18,
        color: str = INK,
        bold: bool = False,
        align: str = "left",
    ) -> None:
        style = (
            "text;html=1;strokeColor=none;fillColor=none;whiteSpace=wrap;overflow=hidden;"
            f"fontFamily=Arial;fontSize={size};fontColor={color};align={align};verticalAlign=middle;"
            f"fontStyle={1 if bold else 0};spacing=0;"
        )
        self.vertex(ident, value, x, y, w, h, style)

    def panel(
        self,
        ident: str,
        title: str,
        x: float,
        y: float,
        w: float,
        h: float,
        *,
        fill: str = "#FFFFFF",
        stroke: str = LINE,
        dashed: bool = False,
        title_size: int = 22,
    ) -> None:
        style = (
            "rounded=1;arcSize=14;whiteSpace=wrap;html=1;"
            f"fillColor={fill};strokeColor={stroke};strokeWidth=2;dashed={1 if dashed else 0};dashPattern=6 5;"
            "verticalAlign=top;align=left;spacingTop=15;spacingLeft=18;"
            f"fontFamily=Arial;fontSize={title_size};fontStyle=1;fontColor={INK};"
        )
        self.vertex(ident, title, x, y, w, h, style)

    def card(
        self,
        ident: str,
        value: str,
        x: float,
        y: float,
        w: float,
        h: float,
        *,
        fill: str = "#FFFFFF",
        stroke: str = LINE,
        color: str = INK,
        size: int = 16,
    ) -> None:
        style = (
            "rounded=1;arcSize=16;whiteSpace=wrap;html=1;"
            f"fillColor={fill};strokeColor={stroke};strokeWidth=1.5;"
            f"fontFamily=Arial;fontSize={size};fontColor={color};align=center;verticalAlign=middle;"
            "fontStyle=1;spacing=6;"
        )
        self.vertex(ident, value, x, y, w, h, style)

    def icon(
        self,
        ident: str,
        key: str,
        x: float,
        y: float,
        w: float = 72,
        h: float = 72,
    ) -> None:
        self.vertex(ident, "", x, y, w, h, self.icon_styles[key])

    def edge(
        self,
        ident: str,
        source: str,
        target: str,
        value: str = "",
        *,
        color: str = NAVY,
        width: float = 2.2,
        dashed: bool = False,
        bidirectional: bool = False,
        exit_x: float | None = None,
        exit_y: float | None = None,
        entry_x: float | None = None,
        entry_y: float | None = None,
    ) -> None:
        ports = ""
        if exit_x is not None:
            ports += f"exitX={exit_x};exitY={exit_y};exitDx=0;exitDy=0;"
        if entry_x is not None:
            ports += f"entryX={entry_x};entryY={entry_y};entryDx=0;entryDy=0;"
        style = (
            "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;"
            f"strokeColor={color};strokeWidth={width};dashed={1 if dashed else 0};dashPattern=6 4;"
            f"startArrow={'block' if bidirectional else 'none'};startFill=1;endArrow=block;endFill=1;"
            f"fontFamily=Arial;fontSize=15;fontColor={color};labelBackgroundColor=#FFFFFF;{ports}"
        )
        cell = ET.SubElement(
            self.root,
            "mxCell",
            {
                "id": ident,
                "value": value,
                "style": style,
                "edge": "1",
                "parent": "1",
                "source": source,
                "target": target,
            },
        )
        ET.SubElement(cell, "mxGeometry", {"relative": "1", "as": "geometry"})

    def save(self) -> None:
        ET.indent(self.mxfile, space="  ")
        DRAWIO.write_text(ET.tostring(self.mxfile, encoding="unicode"), encoding="utf-8-sig")


def _service_drawio(
    d: Drawio,
    ident: str,
    icon_key: str,
    x: float,
    y: float,
    title: str,
    subtitle: str,
    *,
    icon_size: float = 76,
) -> None:
    d.icon(f"icon-{ident}", icon_key, x, y, icon_size, icon_size)
    d.text(
        f"label-{ident}",
        f"<b>{html.escape(title)}</b><br><font color='{MUTED}' style='font-size:13px'>{html.escape(subtitle)}</font>",
        x - 45,
        y + icon_size + 5,
        icon_size + 90,
        55,
        size=16,
        align="center",
    )


def build_drawio(icon_styles: dict[str, str]) -> None:
    d = Drawio(icon_styles)
    d.vertex("background", "", 0, 0, WIDTH, HEIGHT, "shape=rect;fillColor=#FFFFFF;strokeColor=none;")
    d.text("title", "EMS Relay — Seoul v2 Serverless Architecture", 50, 24, 1600, 52, size=36, color=NAVY, bold=True)
    d.text("subtitle", "Deployed baseline · Asia Pacific (Seoul) · ap-northeast-2", 53, 76, 1200, 28, size=17, color=MUTED)
    d.card("truth", "DEPLOYED v2", 2230, 35, 270, 44, fill="#E8F6F3", stroke=TEAL, color=TEAL, size=16)

    # Users and hosted frontend.
    d.panel("users", "Users", 30, 145, 275, 890, fill="#FFFFFF", stroke="#6D8194", dashed=True, title_size=24)
    d.card("paramedic", "📱  구급대원 모바일<br><font style='font-size:14px;font-weight:normal'>/paramedic</font>", 55, 245, 225, 120, fill="#EFFAFA", stroke=TEAL, color=NAVY, size=20)
    d.card("hospital", "🏥  병원 수용 웹<br><font style='font-size:14px;font-weight:normal'>/hospital</font>", 55, 495, 225, 120, fill="#F5F2FA", stroke=PURPLE, color=NAVY, size=20)
    d.card("user-actions", "사건·환자카드·병원 요청<br>수용 YES / NO·이송 선택", 55, 760, 225, 125, fill="#F8FAFC", stroke="#A5B5C3", color=MUTED, size=15)

    d.panel("aws", "AWS Cloud  ·  Asia Pacific (Seoul)", 335, 120, 2190, 1195, fill="#FFFFFF", stroke=NAVY, dashed=False, title_size=25)

    d.panel("access", "Web Access & Identity", 370, 180, 400, 390, fill="#FBFCFE", stroke="#7B91A5", title_size=21)
    _service_drawio(d, "amplify", "amplify", 445, 270, "AWS Amplify", "Next.js static web hosting")
    _service_drawio(d, "cognito", "cognito", 620, 270, "Amazon Cognito", "paramedic / hospital roles")
    d.card("access-routes", "/login  ·  /auth/callback<br>/paramedic  ·  /hospital", 415, 455, 310, 78, fill="#FFFFFF", stroke="#B9C9D6", color=MUTED, size=14)

    d.panel("api", "Real-time API", 810, 300, 330, 350, fill="#F6F2FA", stroke=PURPLE, title_size=21)
    _service_drawio(d, "appsync", "appsync", 937, 385, "AWS AppSync", "GraphQL queries · mutations · subscriptions", icon_size=82)
    d.card("api-contract", "Cognito JWT authorization<br>case + hospital inbox updates", 850, 535, 250, 75, fill="#FFFFFF", stroke="#B9A9CC", color=MUTED, size=14)

    # Three true processing paths.
    d.panel("processing", "Application Processing", 1180, 165, 850, 905, fill="#FCFDFE", stroke="#607A91", title_size=23)

    d.panel("manual", "1  Structured Workflow", 1210, 225, 780, 200, fill="#FFF9F2", stroke=ORANGE, title_size=19)
    _service_drawio(d, "lambda-manual", "lambda", 1270, 290, "AppSync Lambda", "validated manual commands")
    d.card("manual-work", "case lifecycle  ·  patient facts<br>hospital inbox  ·  YES / NO", 1465, 290, 465, 92, fill="#FFFFFF", stroke="#EAB88B", color=INK, size=15)

    d.panel("voice", "2  Optional Voice Proposal", 1210, 450, 780, 260, fill="#F2FAF7", stroke=GREEN, title_size=19)
    _service_drawio(d, "transcribe", "transcribe", 1370, 530, "Amazon Transcribe", "Korean PTT streaming", icon_size=70)
    _service_drawio(d, "lambda-voice", "lambda", 1580, 530, "Voice Lambda", "signed session + proposal", icon_size=70)
    _service_drawio(d, "bedrock", "bedrock", 1790, 530, "Amazon Bedrock", "Claude structures transcript", icon_size=70)
    d.card("voice-hitl", "AI proposal only · paramedic confirmation required", 1375, 650, 455, 38, fill="#FFFFFF", stroke=GREEN, color=GREEN, size=13)

    d.panel("matching", "3  Asynchronous Hospital Matching", 1210, 735, 780, 290, fill="#F4F8FF", stroke=BLUE, title_size=19)
    _service_drawio(d, "sqs", "sqs", 1250, 815, "Amazon SQS", "matching queue", icon_size=70)
    _service_drawio(d, "lambda-matching", "lambda", 1500, 815, "Matching Lambda", "radius waves + first valid replies", icon_size=70)
    d.card("matching-policy", "nearby concurrent requests · gradual radius expansion · stop after acceptance", 1645, 950, 305, 48, fill="#FFFFFF", stroke="#AABFE8", color=INK, size=13)
    d.card("matching-dlq", "SQS dead-letter queue", 1250, 960, 200, 38, fill="#FFF0F0", stroke=RED, color=RED, size=13)

    d.panel("state", "Authoritative State", 2055, 165, 430, 430, fill="#F8F4FC", stroke=PURPLE, title_size=21)
    _service_drawio(d, "dynamodb", "dynamodb", 2215, 245, "Amazon DynamoDB", "CaseTable (on-demand, encrypted)", icon_size=92)
    d.card("state-items", "case metadata + confirmed facts<br>patient card + timeline<br>hospital requests + inbox indexes<br>matching jobs + reference cache<br>voice proposals + events", 2100, 405, 340, 145, fill="#FFFFFF", stroke="#B9A9CC", color=INK, size=14)

    d.panel("references", "External Reference APIs", 2055, 630, 430, 440, fill="#FFFFFF", stroke="#6D8194", dashed=True, title_size=21)
    d.card("nmc", "NMC Emergency API<br><font style='font-size:13px;font-weight:normal'>candidate capability reference</font>", 2090, 700, 360, 75, fill="#F4F8FF", stroke=BLUE, color=NAVY, size=16)
    d.card("hira", "HIRA Hospital API<br><font style='font-size:13px;font-weight:normal'>institution information</font>", 2090, 795, 360, 75, fill="#F2FAF7", stroke=GREEN, color=NAVY, size=16)
    d.card("kakao", "Kakao Mobility / Maps<br><font style='font-size:13px;font-weight:normal'>distance · ETA · browser map</font>", 2090, 890, 360, 75, fill="#FFF9E5", stroke="#E5BD00", color=NAVY, size=16)
    _service_drawio(d, "secrets", "secrets", 2110, 955, "AWS Secrets Manager", "external API credentials", icon_size=48)

    d.panel("operations", "Security & Operations", 370, 1105, 2115, 155, fill="#FAFBFD", stroke="#7B91A5", title_size=19)
    _service_drawio(d, "cloudwatch", "cloudwatch", 650, 1152, "Amazon CloudWatch", "Lambda logs · 14 days", icon_size=54)
    _service_drawio(d, "xray", "xray", 1010, 1152, "AWS X-Ray", "AppSync + Lambda tracing", icon_size=54)
    d.card("deployment", "AWS SAM / CloudFormation<br><font style='font-size:13px;font-weight:normal'>backend deployment</font>", 1390, 1145, 300, 72, fill="#FFFFFF", stroke="#A5B5C3", color=INK, size=15)
    d.card("raw-audio", "Raw audio is not stored", 1890, 1145, 300, 72, fill="#FFF0F0", stroke=RED, color=RED, size=15)

    # Minimal, readable flow.
    d.edge("e-users-access", "users", "access", "HTTPS", color=NAVY, exit_x=1, exit_y=0.42, entry_x=0, entry_y=0.42)
    d.edge("e-access-api", "access", "api", "JWT GraphQL + subscriptions", color=PURPLE, bidirectional=True, exit_x=1, exit_y=0.55, entry_x=0, entry_y=0.55)
    d.edge("e-api-manual", "api", "lambda-manual", "commands / queries", color=ORANGE, exit_x=1, exit_y=0.35, entry_x=0, entry_y=0.5)
    d.edge("e-api-voice", "api", "lambda-voice", "session / final text", color=GREEN, exit_x=1, exit_y=0.65, entry_x=0.5, entry_y=0)
    d.edge("e-transcribe-voice", "transcribe", "lambda-voice", "signed PTT / final text", color=GREEN, bidirectional=True, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.5)
    d.edge("e-voice-bedrock", "lambda-voice", "bedrock", "structure", color=GREEN, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.5)
    d.edge("e-manual-sqs", "lambda-manual", "sqs", "matching job", color=BLUE, exit_x=0.5, exit_y=1, entry_x=0.5, entry_y=0)
    d.edge("e-sqs-worker", "sqs", "lambda-matching", "async job", color=BLUE, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.5)
    d.edge("e-worker-refs", "lambda-matching", "references", "NMC / HIRA / Kakao lookup", color=NAVY, bidirectional=True, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.5)
    d.edge("e-manual-state", "manual-work", "state", "read / conditional write", color=PURPLE, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.35)
    d.edge("e-voice-state", "bedrock", "state", "review proposal", color=PURPLE, exit_x=1, exit_y=0.5, entry_x=0, entry_y=0.75)
    d.edge("e-worker-state", "lambda-matching", "state", "requests + match state", color=PURPLE, exit_x=1, exit_y=1, entry_x=0, entry_y=1)
    d.edge("e-sqs-dlq", "sqs", "matching-dlq", "failed after retries", color=RED, dashed=True, exit_x=0.5, exit_y=1, entry_x=0.5, entry_y=0)

    d.save()


class Svg:
    def __init__(self, icon_styles: dict[str, str]) -> None:
        self.icon_styles = icon_styles
        self.items: list[str] = []

    def add(self, value: str) -> None:
        self.items.append(value)

    def rect(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        *,
        fill: str = "#FFFFFF",
        stroke: str = LINE,
        sw: float = 2,
        radius: float = 16,
        dashed: bool = False,
    ) -> None:
        dash = ' stroke-dasharray="8 7"' if dashed else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>')

    def text(
        self,
        x: float,
        y: float,
        value: str,
        *,
        size: int = 18,
        color: str = INK,
        weight: int = 400,
        anchor: str = "start",
    ) -> None:
        self.add(f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}">{html.escape(value)}</text>')

    def lines(
        self,
        x: float,
        y: float,
        values: list[str],
        *,
        sizes: list[int] | None = None,
        colors: list[str] | None = None,
        weights: list[int] | None = None,
        anchor: str = "start",
        gap: int = 22,
    ) -> None:
        sizes = sizes or [18] * len(values)
        colors = colors or [INK] * len(values)
        weights = weights or [400] * len(values)
        chunks = [f'<text x="{x}" y="{y}" text-anchor="{anchor}">']
        for index, (value, size, color, weight) in enumerate(zip(values, sizes, colors, weights)):
            dy = 0 if index == 0 else gap
            chunks.append(f'<tspan x="{x}" dy="{dy}" fill="{color}" font-size="{size}" font-weight="{weight}">{html.escape(value)}</tspan>')
        chunks.append("</text>")
        self.add("".join(chunks))

    def panel(
        self,
        title: str,
        x: float,
        y: float,
        w: float,
        h: float,
        *,
        fill: str,
        stroke: str,
        dashed: bool = False,
        size: int = 22,
    ) -> None:
        self.rect(x, y, w, h, fill=fill, stroke=stroke, sw=2, radius=16, dashed=dashed)
        self.text(x + 20, y + 35, title, size=size, color=INK, weight=700)

    def card(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        title: str,
        subtitle: str = "",
        *,
        fill: str = "#FFFFFF",
        stroke: str = LINE,
        title_color: str = INK,
        size: int = 16,
    ) -> None:
        self.rect(x, y, w, h, fill=fill, stroke=stroke, sw=1.5, radius=12)
        if subtitle:
            self.lines(x + w / 2, y + h / 2 - 7, [title, subtitle], sizes=[size, 13], colors=[title_color, MUTED], weights=[700, 400], anchor="middle", gap=21)
        else:
            self.text(x + w / 2, y + h / 2 + 6, title, size=size, color=title_color, weight=700, anchor="middle")

    def icon(self, key: str, x: float, y: float, w: float = 72, h: float = 72) -> None:
        self.add(f'<image href="{_image_uri(self.icon_styles[key])}" x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="xMidYMid meet"/>')

    def service(
        self,
        key: str,
        x: float,
        y: float,
        title: str,
        subtitle: str,
        *,
        icon_size: float = 76,
    ) -> None:
        self.icon(key, x, y, icon_size, icon_size)
        self.lines(x + icon_size / 2, y + icon_size + 23, [title, subtitle], sizes=[16, 13], colors=[INK, MUTED], weights=[700, 400], anchor="middle", gap=20)

    def edge(
        self,
        points: list[tuple[float, float]],
        label: str = "",
        *,
        color: str = NAVY,
        sw: float = 2.3,
        dashed: bool = False,
        bidirectional: bool = False,
        label_at: tuple[float, float] | None = None,
    ) -> None:
        pts = " ".join(f"{x},{y}" for x, y in points)
        dash = ' stroke-dasharray="7 6"' if dashed else ""
        start = f' marker-start="url(#arrow-{color[1:]})"' if bidirectional else ""
        self.add(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{sw}" marker-end="url(#arrow-{color[1:]})"{start}{dash}/>')
        if label and label_at:
            x, y = label_at
            text_w = max(60, len(label) * 8.7)
            self.add(f'<rect x="{x - text_w / 2}" y="{y - 17}" width="{text_w}" height="25" rx="5" fill="#FFFFFF" opacity="0.96"/>')
            self.text(x, y + 2, label, size=14, color=color, weight=600, anchor="middle")

    def save(self) -> None:
        markers = []
        for color in (INK, NAVY, GREEN, ORANGE, BLUE, RED, TEAL, PURPLE, MUTED):
            markers.append(f'<marker id="arrow-{color[1:]}" markerWidth="10" markerHeight="10" refX="8" refY="3.5" orient="auto-start-reverse"><polygon points="0 0, 9 3.5, 0 7" fill="{color}"/></marker>')
        document = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">'
            '<defs>' + "".join(markers) + '</defs>'
            f'<rect width="{WIDTH}" height="{HEIGHT}" fill="#FFFFFF"/>'
            '<style>text{font-family:Pretendard,"Noto Sans KR","Segoe UI",Arial,sans-serif}</style>'
            + "".join(self.items)
            + '</svg>'
        )
        SVG.write_text(document, encoding="utf-8-sig")


def build_svg(icon_styles: dict[str, str]) -> None:
    s = Svg(icon_styles)
    s.text(50, 60, "EMS Relay — Seoul v2 Serverless Architecture", size=36, color=NAVY, weight=700)
    s.text(53, 94, "Deployed baseline · Asia Pacific (Seoul) · ap-northeast-2", size=17, color=MUTED)
    s.card(2230, 35, 270, 44, "DEPLOYED v2", fill="#E8F6F3", stroke=TEAL, title_color=TEAL, size=16)

    s.panel("Users", 30, 145, 275, 890, fill="#FFFFFF", stroke="#6D8194", dashed=True, size=24)
    s.card(55, 245, 225, 120, "구급대원 모바일", "/paramedic", fill="#EFFAFA", stroke=TEAL, size=20)
    s.card(55, 495, 225, 120, "병원 수용 웹", "/hospital", fill="#F5F2FA", stroke=PURPLE, size=20)
    s.rect(55, 760, 225, 125, fill="#F8FAFC", stroke="#A5B5C3", sw=1.5, radius=12)
    s.lines(167.5, 801, ["사건 · 환자카드 · 병원 요청", "수용 YES / NO · 이송 선택"], sizes=[15, 15], colors=[MUTED, MUTED], weights=[700, 700], anchor="middle", gap=27)

    s.panel("AWS Cloud  ·  Asia Pacific (Seoul)", 335, 120, 2190, 1195, fill="#FFFFFF", stroke=NAVY, size=25)

    s.panel("Web Access & Identity", 370, 180, 400, 390, fill="#FBFCFE", stroke="#7B91A5", size=21)
    s.service("amplify", 445, 270, "AWS Amplify", "Next.js static web hosting")
    s.service("cognito", 620, 270, "Amazon Cognito", "paramedic / hospital roles")
    s.card(415, 455, 310, 78, "/login · /auth/callback", "/paramedic · /hospital", fill="#FFFFFF", stroke="#B9C9D6", title_color=MUTED, size=14)

    s.panel("Real-time API", 810, 300, 330, 350, fill="#F6F2FA", stroke=PURPLE, size=21)
    s.service("appsync", 937, 385, "AWS AppSync", "GraphQL queries · mutations · subscriptions", icon_size=82)
    s.card(850, 535, 250, 75, "Cognito JWT authorization", "case + hospital inbox updates", fill="#FFFFFF", stroke="#B9A9CC", title_color=MUTED, size=14)

    s.panel("Application Processing", 1180, 165, 850, 905, fill="#FCFDFE", stroke="#607A91", size=23)
    s.panel("1  Structured Workflow", 1210, 225, 780, 200, fill="#FFF9F2", stroke=ORANGE, size=19)
    s.service("lambda", 1270, 290, "AppSync Lambda", "validated manual commands")
    s.card(1465, 290, 465, 92, "case lifecycle · patient facts", "hospital inbox · YES / NO", fill="#FFFFFF", stroke="#EAB88B", size=15)

    s.panel("2  Optional Voice Proposal", 1210, 450, 780, 260, fill="#F2FAF7", stroke=GREEN, size=19)
    s.service("transcribe", 1370, 530, "Amazon Transcribe", "Korean PTT streaming", icon_size=70)
    s.service("lambda", 1580, 530, "Voice Lambda", "signed session + proposal", icon_size=70)
    s.service("bedrock", 1790, 530, "Amazon Bedrock", "Claude structures transcript", icon_size=70)
    s.card(1375, 650, 455, 38, "AI proposal only · paramedic confirmation required", fill="#FFFFFF", stroke=GREEN, title_color=GREEN, size=13)

    s.panel("3  Asynchronous Hospital Matching", 1210, 735, 780, 290, fill="#F4F8FF", stroke=BLUE, size=19)
    s.service("sqs", 1250, 815, "Amazon SQS", "matching queue", icon_size=70)
    s.service("lambda", 1500, 815, "Matching Lambda", "radius waves + first valid replies", icon_size=70)
    s.card(1645, 950, 305, 48, "nearby requests · radius expansion", fill="#FFFFFF", stroke="#AABFE8", size=13)
    s.card(1250, 960, 200, 38, "SQS dead-letter queue", fill="#FFF0F0", stroke=RED, title_color=RED, size=13)
    s.text(1797, 1013, "stop after acceptance or destination selection", size=13, color=MUTED, weight=600, anchor="middle")

    s.panel("Authoritative State", 2055, 165, 430, 430, fill="#F8F4FC", stroke=PURPLE, size=21)
    s.service("dynamodb", 2215, 245, "Amazon DynamoDB", "CaseTable (on-demand, encrypted)", icon_size=92)
    s.rect(2100, 405, 340, 145, fill="#FFFFFF", stroke="#B9A9CC", sw=1.5, radius=12)
    s.lines(2270, 433, ["case metadata + confirmed facts", "patient card + timeline", "hospital requests + inbox indexes", "matching jobs + reference cache", "voice proposals + events"], sizes=[14] * 5, colors=[INK] * 5, weights=[600] * 5, anchor="middle", gap=25)

    s.panel("External Reference APIs", 2055, 630, 430, 440, fill="#FFFFFF", stroke="#6D8194", dashed=True, size=21)
    s.card(2090, 700, 360, 75, "NMC Emergency API", "candidate capability reference", fill="#F4F8FF", stroke=BLUE, size=16)
    s.card(2090, 795, 360, 75, "HIRA Hospital API", "institution information", fill="#F2FAF7", stroke=GREEN, size=16)
    s.card(2090, 890, 360, 75, "Kakao Mobility / Maps", "distance · ETA · browser map", fill="#FFF9E5", stroke="#E5BD00", size=16)
    s.service("secrets", 2110, 955, "AWS Secrets Manager", "external API credentials", icon_size=48)

    s.panel("Security & Operations", 370, 1105, 2115, 155, fill="#FAFBFD", stroke="#7B91A5", size=19)
    s.service("cloudwatch", 650, 1152, "Amazon CloudWatch", "Lambda logs · 14 days", icon_size=54)
    s.service("xray", 1010, 1152, "AWS X-Ray", "AppSync + Lambda tracing", icon_size=54)
    s.card(1390, 1145, 300, 72, "AWS SAM / CloudFormation", "backend deployment", fill="#FFFFFF", stroke="#A5B5C3", size=15)
    s.card(1890, 1145, 300, 72, "Raw audio is not stored", fill="#FFF0F0", stroke=RED, title_color=RED, size=15)

    # Connections are routed to avoid the service labels and each other.
    s.edge([(305, 518), (370, 518)], "HTTPS", color=NAVY, label_at=(337, 502))
    s.edge([(770, 450), (810, 450)], "JWT GraphQL + subscriptions", color=PURPLE, bidirectional=True, label_at=(790, 428))
    s.edge([(1140, 402), (1180, 402), (1180, 328), (1270, 328)], "commands / queries", color=ORANGE, label_at=(1200, 389))
    s.edge([(1140, 540), (1185, 540), (1185, 510), (1615, 510), (1615, 530)], "session / final text", color=GREEN, label_at=(1420, 499))
    s.edge([(1440, 565), (1580, 565)], "signed PTT / final text", color=GREEN, bidirectional=True, label_at=(1510, 552))
    s.edge([(1650, 565), (1790, 565)], "structure", color=GREEN, label_at=(1720, 552))
    s.edge([(1308, 366), (1308, 815)], "matching job", color=BLUE, label_at=(1350, 720))
    s.edge([(1320, 850), (1500, 850)], "async job", color=BLUE, label_at=(1410, 837))
    s.edge([(1570, 850), (2055, 850)], "NMC / HIRA / Kakao lookup", color=NAVY, bidirectional=True, label_at=(1812, 837))
    s.edge([(1930, 336), (2055, 336)], "read / conditional write", color=PURPLE, label_at=(1990, 319))
    s.edge([(1860, 565), (2000, 565), (2000, 520), (2055, 520)], "review proposal", color=PURPLE, label_at=(1930, 552))
    s.edge([(1570, 885), (1640, 885), (1640, 1045), (2010, 1045), (2010, 595), (2055, 595)], "requests + match state", color=PURPLE, label_at=(1810, 1032))
    s.edge([(1285, 885), (1285, 960)], "failed after retries", color=RED, dashed=True, label_at=(1360, 942))
    s.save()


def render_png() -> None:
    browsers = (
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    )
    browser = next((path for path in browsers if path.exists()), None)
    if browser is None:
        raise RuntimeError("A Chromium browser is required to render the PNG preview")
    command = [
        str(browser),
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        f"--window-size={WIDTH},{HEIGHT}",
        f"--screenshot={PNG}",
        SVG.resolve().as_uri(),
    ]
    subprocess.run(command, check=True, capture_output=True, timeout=60)
    if not PNG.exists() or PNG.stat().st_size < 10_000:
        raise RuntimeError("PNG preview was not rendered correctly")


def validate_outputs() -> None:
    drawio_root = ET.parse(DRAWIO).getroot()
    svg_root = ET.parse(SVG).getroot()
    if drawio_root.tag != "mxfile":
        raise RuntimeError("Invalid Draw.io document")
    if not svg_root.tag.endswith("svg"):
        raise RuntimeError("Invalid SVG document")

    forbidden = ("AgentCore", "LangGraph", "HealthLake", "Kinesis", "Control Center", "Report automation")
    required = (
        "AWS Amplify",
        "Amazon Cognito",
        "AWS AppSync",
        "AppSync Lambda",
        "Voice Lambda",
        "Amazon Transcribe",
        "Amazon Bedrock",
        "Amazon SQS",
        "Matching Lambda",
        "NMC Emergency API",
        "HIRA Hospital API",
        "Kakao Mobility / Maps",
        "Amazon DynamoDB",
    )
    for path in (DRAWIO, SVG):
        text = path.read_text(encoding="utf-8-sig")
        missing = [item for item in required if item not in text]
        present_forbidden = [item for item in forbidden if item in text]
        if missing:
            raise RuntimeError(f"{path.name} is missing components: {missing}")
        if present_forbidden:
            raise RuntimeError(f"{path.name} contains non-v2 components: {present_forbidden}")

    # Confirm the official AWS icon payloads are valid base64 SVGs.
    for style in _icon_styles().values():
        payload = _image_uri(style).split(",", 1)[1]
        decoded = base64.b64decode(payload)
        if b"<svg" not in decoded[:500]:
            raise RuntimeError("Invalid embedded AWS icon payload")


def main() -> None:
    ARCH.mkdir(parents=True, exist_ok=True)
    styles = _icon_styles()
    build_drawio(styles)
    build_svg(styles)
    render_png()
    validate_outputs()
    print(DRAWIO)
    print(SVG)
    print(PNG)


if __name__ == "__main__":
    main()
