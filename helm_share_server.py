#!/usr/bin/env python3
"""Serve Helm and publish immutable, content-addressed intranet shares.

The browser library remains local IndexedDB. Publishing is an explicit action:
the server validates one HDOC file, stores its exact bytes under a digest-based
name, and exposes only that immutable copy through a read-only URL.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse

from helm_bridge import ContractError, MAX_DOCUMENT_BYTES, atomic_write, safe_filename, validate_hdoc


API_VERSION = "HSHARE/1.0"
MAX_REQUEST_BYTES = MAX_DOCUMENT_BYTES + 64 * 1024


class ShareStore:
    def __init__(self, root: Path):
        self.root = root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o755)

    def publish(self, html_bytes: bytes) -> dict[str, Any]:
        if len(html_bytes) > MAX_DOCUMENT_BYTES:
            raise ContractError([f"Document exceeds the {MAX_DOCUMENT_BYTES // (1024 * 1024)} MB share limit."])
        try:
            html = html_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ContractError([f"Document must be UTF-8 HTML: {error}."]) from error
        manifest, warnings = validate_hdoc(html)
        digest = hashlib.sha256(html_bytes).hexdigest()
        filename = safe_filename(manifest["id"], digest)
        path = self.root / filename
        if path.exists():
            if path.read_bytes() != html_bytes:
                raise RuntimeError("Digest-addressed share storage is inconsistent.")
            state = "idempotent"
        else:
            atomic_write(path, html_bytes, mode=0o644)
            state = "created"
        return {
            "state": state,
            "id": manifest["id"],
            "title": manifest["title"],
            "sha256": digest,
            "filename": filename,
            "warnings": warnings,
        }

    def resolve(self, filename: str) -> Path | None:
        decoded = unquote(filename)
        if not decoded or decoded != Path(decoded).name or not decoded.endswith(".html"):
            return None
        candidate = (self.root / decoded).resolve()
        if candidate.parent != self.root or not candidate.is_file():
            return None
        return candidate


class ShareRequestHandler(SimpleHTTPRequestHandler):
    server: "ShareHTTPServer"
    protocol_version = "HTTP/1.1"
    server_version = "HelmShare/1.0"
    sys_version = ""

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=str(kwargs.pop("directory")), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"Helm Share {self.address_string()} {self.command} {self.path} {args[-2] if len(args) >= 2 else ''}")

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def _loopback_writer(self) -> bool:
        try:
            return ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            return False

    @staticmethod
    def _blocked_site_path(path: str) -> bool:
        suffix = Path(path).suffix.lower()
        return path.startswith(("/.", "/scripts/", "/tests/")) or suffix in {".py", ".pyc", ".sh"}

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/share/health":
            self._send_json(HTTPStatus.OK, {"ok": True, "api_version": API_VERSION, "public_base_url": self.server.public_base_url})
            return
        if path.startswith("/share/"):
            shared = self.server.store.resolve(path.removeprefix("/share/"))
            if not shared:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            payload = shared.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.send_header("Content-Security-Policy", "sandbox allow-popups; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(payload)
            return
        if self._blocked_site_path(path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/share/"):
            shared = self.server.store.resolve(path.removeprefix("/share/"))
            if not shared:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(shared.stat().st_size))
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.send_header("Content-Security-Policy", "sandbox allow-popups; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            return
        if self._blocked_site_path(path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        super().do_HEAD()

    def do_POST(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/api/share":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        if not self._loopback_writer():
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "read_only_network", "message": "Publishing is only accepted through the owner's loopback connection."})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            content_length = -1
        if content_length < 0 or content_length > MAX_REQUEST_BYTES:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "payload_too_large", "max_bytes": MAX_REQUEST_BYTES})
            return
        try:
            payload = json.loads(self.rfile.read(content_length))
            html = payload.get("html") if isinstance(payload, dict) else None
            if not isinstance(html, str):
                raise ContractError(["Request JSON must contain an HTML string."])
            result = self.server.store.publish(html.encode("utf-8"))
            public_path = f"/share/{quote(result['filename'])}"
            self._send_json(
                HTTPStatus.CREATED if result["state"] == "created" else HTTPStatus.OK,
                {**result, "ok": True, "path": public_path, "url": f"{self.server.public_base_url}{public_path}"},
            )
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
        except ContractError as error:
            self._send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": "contract_invalid", "errors": error.errors, "warnings": error.warnings})
        except (OSError, RuntimeError) as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "storage_error", "message": str(error)})


class ShareHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], site_root: Path, store: ShareStore, public_base_url: str):
        self.site_root = site_root.resolve()
        self.store = store
        self.public_base_url = public_base_url.rstrip("/")
        super().__init__(address, lambda *args, **kwargs: ShareRequestHandler(*args, directory=self.site_root, **kwargs))


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Helm with immutable intranet share URLs.")
    parser.add_argument("--host", default=os.environ.get("HELM_SHARE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("HELM_SHARE_PORT", "4173")))
    parser.add_argument("--site-root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--share-dir", type=Path, default=Path(os.environ.get("HELM_SHARE_DIR", "~/.helm-shares")))
    parser.add_argument("--public-base-url", default=os.environ.get("HELM_PUBLIC_BASE_URL", "http://127.0.0.1:4173"))
    args = parser.parse_args()
    server = ShareHTTPServer((args.host, args.port), args.site_root, ShareStore(args.share_dir), args.public_base_url)
    print(f"Helm Share serving {args.site_root.resolve()} at {args.host}:{args.port}; public links use {server.public_base_url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
