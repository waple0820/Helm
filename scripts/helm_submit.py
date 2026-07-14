#!/usr/bin/env python3
"""Submit a completed HDOC HTML artifact to a reachable Helm Bridge.

Agents should call this once they have written and locally validated their final
HTML file. The Bridge is intentionally responsible for final contract and
identity checks; this client never tries to repair or rewrite the source.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def project_id(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized[:100] or "workspace"


def main() -> int:
    parser = argparse.ArgumentParser(description="Submit a completed HDOC HTML file to Helm Bridge.")
    parser.add_argument("html_file", type=Path, help="Completed UTF-8 .html artifact")
    parser.add_argument("--source", default=os.environ.get("HELM_AGENT_NAME", "unnamed-agent"), help="Short provenance label for this agent")
    parser.add_argument("--project-id", default=os.environ.get("HELM_PROJECT_ID"), help="Stable workspace identifier (defaults to the current folder)")
    parser.add_argument("--project-name", default=os.environ.get("HELM_PROJECT_NAME"), help="Human-readable workspace name (defaults to the current folder)")
    parser.add_argument("--endpoint", default=os.environ.get("HELM_BRIDGE_ENDPOINT", "http://127.0.0.1:4175"), help="Helm Bridge base URL")
    args = parser.parse_args()

    workspace_name = (args.project_name or Path.cwd().name).strip()[:100]
    workspace_id = project_id((args.project_id or workspace_name).strip())

    token = os.environ.get("HELM_BRIDGE_TOKEN", "").strip()
    if not token:
        print("HELM_BRIDGE_TOKEN is not configured; artifact was not sent.", file=sys.stderr)
        return 2
    try:
        payload = args.html_file.read_bytes()
    except OSError as error:
        print(f"Could not read {args.html_file}: {error}", file=sys.stderr)
        return 2

    request = Request(
        f"{args.endpoint.rstrip('/')}/v1/artifacts",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "text/html; charset=utf-8",
            "X-Helm-Source": args.source[:120],
            "X-Helm-Project-Id": workspace_id,
            "X-Helm-Project-Name": workspace_name,
        },
    )
    try:
        with urlopen(request, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
            artifact = body.get("artifact", {})
            project = artifact.get("project") or {}
            project_label = project.get("name") if isinstance(project, dict) else None
            print(f"Helm Bridge: {body.get('status', 'accepted')} · {artifact.get('id', 'unknown-id')}{f' · {project_label}' if project_label else ''}")
            return 0
    except HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            body = {"error": "unexpected_response"}
        if error.code == 409:
            print(f"Helm Bridge: identity conflict for {body.get('id', 'artifact')}; source was not replaced.", file=sys.stderr)
        elif error.code == 422:
            print("Helm Bridge rejected the HDOC artifact:", file=sys.stderr)
            for message in body.get("errors", []):
                print(f"- {message}", file=sys.stderr)
        else:
            print(f"Helm Bridge request failed ({error.code}): {body.get('error', 'unknown error')}", file=sys.stderr)
        return 1
    except URLError as error:
        print(f"Helm Bridge is unreachable: {error.reason}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
