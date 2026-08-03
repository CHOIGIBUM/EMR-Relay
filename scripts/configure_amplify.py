"""Apply versioned AWS Amplify Hosting settings without shell-escaping YAML."""

from __future__ import annotations

import argparse
from pathlib import Path

import boto3


STATIC_ROUTES = (
    "login",
    "auth/callback",
    "paramedic",
    "control",
    "hospital",
    "reports",
    "demo/workflow",
)


def static_route_rules() -> list[dict[str, str]]:
    rules: list[dict[str, str]] = []
    for route in STATIC_ROUTES:
        target = f"/{route}/index.html"
        rules.extend(
            (
                {"source": f"/{route}", "target": target, "status": "200"},
                {"source": f"/{route}/", "target": target, "status": "200"},
            )
        )
    return rules


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-id", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--region", default="us-west-2")
    parser.add_argument("--headers-file", required=True, type=Path)
    args = parser.parse_args()

    headers_file = args.headers_file.resolve(strict=True)
    custom_headers = headers_file.read_text(encoding="utf-8")
    if not custom_headers.startswith("customHeaders:"):
        raise ValueError("customHttp.yml must start with customHeaders:")

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    amplify = session.client("amplify")
    result = amplify.update_app(
        appId=args.app_id,
        customHeaders=custom_headers,
        customRules=static_route_rules(),
    )["app"]
    if result["appId"] != args.app_id:
        raise RuntimeError("Amplify returned an unexpected app identifier")

    print(f"Amplify hosting settings updated: {result['name']}")


if __name__ == "__main__":
    main()
