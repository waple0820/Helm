#!/usr/bin/env python3
"""Serve Helm and publish immutable intranet shares and versioned Channels."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse

from helm_bridge import ContractError, MAX_DOCUMENT_BYTES, atomic_write, safe_filename, validate_hdoc


API_VERSION = "HSHARE/1.0"
CHANNEL_API_VERSION = "HCHANNEL/1.0"
MAX_REQUEST_BYTES = MAX_DOCUMENT_BYTES + 64 * 1024
ARTIFACT_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$")
REVISION_FILENAME_PATTERN = re.compile(r"^([0-9a-f]{64})\.html$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class ChannelConflictError(RuntimeError):
    def __init__(self, artifact_id: str, current_revision: str | None):
        super().__init__(f"Artifact {artifact_id!r} has advanced since the requested base revision.")
        self.artifact_id = artifact_id
        self.current_revision = current_revision


class ChannelNotFoundError(LookupError):
    pass


class ShareStore:
    """Keep legacy flat shares and the append-only Helm Channels catalog."""

    def __init__(self, root: Path):
        self.root = root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o755)
        self.revision_dir = self.root / "revisions"
        self.revision_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.revision_dir, 0o700)
        self.channel_catalog_path = self.root / "channels.json"
        self.lock = threading.RLock()
        self.channel_catalog = self._load_channel_catalog()

    @staticmethod
    def _validate_source(html_bytes: bytes) -> tuple[dict[str, Any], list[str]]:
        if len(html_bytes) > MAX_DOCUMENT_BYTES:
            raise ContractError([f"Document exceeds the {MAX_DOCUMENT_BYTES // (1024 * 1024)} MB share limit."])
        try:
            html = html_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ContractError([f"Document must be UTF-8 HTML: {error}."]) from error
        return validate_hdoc(html)

    def _load_channel_catalog(self) -> dict[str, Any]:
        if not self.channel_catalog_path.exists():
            return {"schema_version": CHANNEL_API_VERSION, "artifacts": {}, "revisions": {}}
        try:
            payload = json.loads(self.channel_catalog_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Helm Channels catalog is unreadable: {self.channel_catalog_path}") from error
        if (
            not isinstance(payload, dict)
            or payload.get("schema_version") != CHANNEL_API_VERSION
            or not isinstance(payload.get("artifacts"), dict)
            or not isinstance(payload.get("revisions"), dict)
        ):
            raise RuntimeError(f"Helm Channels catalog is invalid: {self.channel_catalog_path}")
        return payload

    def _save_channel_catalog(self) -> None:
        self.channel_catalog["updated_at"] = utc_now()
        atomic_write(
            self.channel_catalog_path,
            json.dumps(self.channel_catalog, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8"),
            mode=0o600,
        )

    def publish(self, html_bytes: bytes) -> dict[str, Any]:
        """Legacy one-shot publication. Its API and flat-file layout stay stable."""
        manifest, warnings = self._validate_source(html_bytes)
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
        """Resolve an existing legacy /share URL."""
        decoded = unquote(filename)
        if not decoded or decoded != Path(decoded).name or not decoded.endswith(".html"):
            return None
        candidate = (self.root / decoded).resolve()
        if candidate.parent != self.root or not candidate.is_file():
            return None
        return candidate

    def publish_channel(self, html_bytes: bytes, base_revision_sha256: str | None = None) -> dict[str, Any]:
        manifest, warnings = self._validate_source(html_bytes)
        artifact_id = manifest["id"]
        digest = hashlib.sha256(html_bytes).hexdigest()
        now = utc_now()
        with self.lock:
            artifact = self.channel_catalog["artifacts"].get(artifact_id)
            current = artifact.get("current_revision") if artifact else None
            if artifact and digest == current and artifact.get("status") == "published":
                return {"state": "idempotent", "artifact": dict(artifact), "sha256": digest, "warnings": warnings}
            if artifact and base_revision_sha256 != current:
                raise ChannelConflictError(artifact_id, current)
            if not artifact and base_revision_sha256 is not None:
                raise ChannelConflictError(artifact_id, None)

            revision_path = self.revision_dir / f"{digest}.html"
            revision = self.channel_catalog["revisions"].get(digest)
            if revision:
                if revision.get("artifact_id") != artifact_id or not revision_path.is_file() or revision_path.read_bytes() != html_bytes:
                    raise RuntimeError("Revision-addressed Channel storage is inconsistent.")
            else:
                atomic_write(revision_path, html_bytes, mode=0o600)
                self.channel_catalog["revisions"][digest] = {
                    "artifact_id": artifact_id,
                    "sha256": digest,
                    "path": f"revisions/{digest}.html",
                    "published_at": now,
                    "manifest": manifest,
                }

            revisions = list(artifact.get("revisions", [])) if artifact else []
            if digest not in revisions:
                revisions.append(digest)
            first_published_at = artifact.get("published_at", now) if artifact else now
            was_revoked = bool(artifact and artifact.get("status") == "revoked")
            record = {
                "id": artifact_id,
                "title": manifest["title"],
                "type": manifest["type"],
                "summary": manifest["summary"],
                "tags": manifest["tags"],
                **({"project": manifest["project"]} if isinstance(manifest.get("project"), dict) else {}),
                "status": "published",
                "current_revision": digest,
                "published_at": first_published_at,
                "updated_at": now,
                "revoked_at": None,
                "revisions": revisions,
            }
            self.channel_catalog["artifacts"][artifact_id] = record
            self._save_channel_catalog()
            state = "created" if artifact is None else "republished" if was_revoked else "updated"
            return {"state": state, "artifact": dict(record), "sha256": digest, "warnings": warnings}

    def revoke_channel(self, artifact_id: str, base_revision_sha256: str | None) -> dict[str, Any]:
        if not ARTIFACT_ID_PATTERN.fullmatch(artifact_id):
            raise ChannelNotFoundError(artifact_id)
        with self.lock:
            artifact = self.channel_catalog["artifacts"].get(artifact_id)
            if not artifact:
                raise ChannelNotFoundError(artifact_id)
            current = artifact.get("current_revision")
            if base_revision_sha256 != current:
                raise ChannelConflictError(artifact_id, current)
            if artifact.get("status") == "revoked":
                return {"state": "idempotent", "artifact": dict(artifact)}
            now = utc_now()
            artifact = {**artifact, "status": "revoked", "revoked_at": now, "updated_at": now}
            self.channel_catalog["artifacts"][artifact_id] = artifact
            self._save_channel_catalog()
            return {"state": "revoked", "artifact": dict(artifact)}

    def artifact(self, artifact_id: str) -> dict[str, Any] | None:
        decoded = unquote(artifact_id)
        if not ARTIFACT_ID_PATTERN.fullmatch(decoded):
            return None
        with self.lock:
            record = self.channel_catalog["artifacts"].get(decoded)
            return dict(record) if record else None

    def artifacts(self) -> list[dict[str, Any]]:
        with self.lock:
            return [dict(record) for record in self.channel_catalog["artifacts"].values()]

    def resolve_artifact(self, artifact_id: str) -> tuple[str, Path] | None:
        record = self.artifact(artifact_id)
        if not record:
            return None
        if record.get("status") == "revoked":
            return "revoked", self.revision_dir / f"{record['current_revision']}.html"
        path = self.revision_dir / f"{record['current_revision']}.html"
        if not path.is_file():
            raise RuntimeError("The current Channel revision is missing.")
        return "published", path

    def resolve_revision(self, filename: str) -> Path | None:
        decoded = unquote(filename)
        match = REVISION_FILENAME_PATTERN.fullmatch(decoded)
        if not match:
            return None
        digest = match.group(1)
        with self.lock:
            if digest not in self.channel_catalog["revisions"]:
                return None
        path = self.revision_dir / decoded
        return path if path.is_file() else None


class ShareRequestHandler(SimpleHTTPRequestHandler):
    server: "ShareHTTPServer"
    protocol_version = "HTTP/1.1"
    server_version = "HelmShare/1.1"
    sys_version = ""

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=str(kwargs.pop("directory")), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"Helm Share {self.address_string()} {self.command} {self.path} {args[-2] if len(args) >= 2 else ''}")

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any], head: bool = False) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        if not head:
            self.wfile.write(encoded)

    def _loopback_writer(self) -> bool:
        try:
            return ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            return False

    def _owner_request(self) -> bool:
        if not self._loopback_writer():
            self.close_connection = True
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "read_only_network", "message": "Channel management is only accepted through the owner's loopback connection."})
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in self.server.allowed_origins:
            self.close_connection = True
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "origin_forbidden"})
            return False
        return True

    def _read_json(self) -> Any | None:
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self.close_connection = True
            self._send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "content_type_required", "expected": "application/json"})
            return None
        try:
            content_length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            content_length = -1
        if content_length < 0 or content_length > MAX_REQUEST_BYTES:
            self.close_connection = True
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "payload_too_large", "max_bytes": MAX_REQUEST_BYTES})
            return None
        try:
            return json.loads(self.rfile.read(content_length))
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
            return None

    def _blocked_site_path(self, path: str) -> bool:
        decoded = path
        for _ in range(4):
            expanded = unquote(decoded)
            if expanded == decoded:
                break
            decoded = expanded
        candidate = Path(self.translate_path(decoded)).resolve()
        try:
            relative = candidate.relative_to(self.server.site_root)
        except ValueError:
            return True
        parts = relative.parts
        if any(part.startswith(".") for part in parts) or (parts and parts[0] in {"scripts", "tests"}):
            return True
        try:
            candidate.relative_to(self.server.store.root)
            return True
        except ValueError:
            pass
        return candidate.suffix.lower() in {".py", ".pyc", ".sh"}

    def _send_html(self, path: Path, immutable: bool, head: bool = False) -> None:
        payload = b"" if head else path.read_bytes()
        length = path.stat().st_size
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if immutable else "no-store")
        self.send_header("Content-Security-Policy", "sandbox allow-popups; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if not head:
            self.wfile.write(payload)

    def _serve_read(self, head: bool = False) -> bool:
        path = urlparse(self.path).path
        if path.startswith("/share/"):
            shared = self.server.store.resolve(path.removeprefix("/share/"))
            if not shared:
                self.send_error(HTTPStatus.NOT_FOUND)
            else:
                self._send_html(shared, immutable=True, head=head)
            return True
        if path.startswith("/a/"):
            resolved = self.server.store.resolve_artifact(path.removeprefix("/a/"))
            if not resolved:
                self.send_error(HTTPStatus.NOT_FOUND)
            elif resolved[0] == "revoked":
                self.send_error(HTTPStatus.GONE, "This Helm Channel has been revoked.")
            else:
                self._send_html(resolved[1], immutable=False, head=head)
            return True
        if path.startswith("/r/"):
            revision = self.server.store.resolve_revision(path.removeprefix("/r/"))
            if not revision:
                self.send_error(HTTPStatus.NOT_FOUND)
            else:
                self._send_html(revision, immutable=True, head=head)
            return True
        return False

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/share/health":
            self._send_json(HTTPStatus.OK, {"ok": True, "api_version": API_VERSION, "channel_api_version": CHANNEL_API_VERSION, "public_base_url": self.server.public_base_url})
            return
        if path == "/api/channels":
            if self._owner_request():
                self._send_json(HTTPStatus.OK, {"ok": True, "artifacts": self.server.store.artifacts()})
            return
        if path.startswith("/api/channels/artifacts/"):
            if not self._owner_request():
                return
            artifact = self.server.store.artifact(path.removeprefix("/api/channels/artifacts/"))
            self._send_json(HTTPStatus.OK, {"ok": True, "artifact": artifact}) if artifact else self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        if self._serve_read():
            return
        if self._blocked_site_path(path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if self._serve_read(head=True):
            return
        if self._blocked_site_path(path):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        super().do_HEAD()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        legacy = path == "/api/share"
        channel_publish = path == "/api/channels/publish"
        revoke_match = re.fullmatch(r"/api/channels/artifacts/([^/]+)/revoke", path)
        if not legacy and not channel_publish and not revoke_match:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        if not self._owner_request():
            return
        payload = self._read_json()
        if payload is None:
            return
        try:
            if revoke_match:
                base = payload.get("base_revision_sha256") if isinstance(payload, dict) else None
                result = self.server.store.revoke_channel(unquote(revoke_match.group(1)), base)
                self._send_json(HTTPStatus.OK, {**result, "ok": True})
                return
            html = payload.get("html") if isinstance(payload, dict) else None
            if not isinstance(html, str):
                raise ContractError(["Request JSON must contain an HTML string."])
            if legacy:
                result = self.server.store.publish(html.encode("utf-8"))
                public_path = f"/share/{quote(result['filename'])}"
                self._send_json(HTTPStatus.CREATED if result["state"] == "created" else HTTPStatus.OK, {**result, "ok": True, "path": public_path, "url": f"{self.server.public_base_url}{public_path}"})
                return
            result = self.server.store.publish_channel(html.encode("utf-8"), payload.get("base_revision_sha256"))
            artifact_id = result["artifact"]["id"]
            stable_path = f"/a/{quote(artifact_id)}"
            revision_path = f"/r/{result['sha256']}.html"
            self._send_json(
                HTTPStatus.CREATED if result["state"] == "created" else HTTPStatus.OK,
                {**result, "ok": True, "stable_path": stable_path, "stable_url": f"{self.server.public_base_url}{stable_path}", "revision_path": revision_path, "revision_url": f"{self.server.public_base_url}{revision_path}"},
            )
        except ChannelConflictError as error:
            self._send_json(HTTPStatus.CONFLICT, {"error": "revision_conflict", "artifact_id": error.artifact_id, "current_revision_sha256": error.current_revision})
        except ChannelNotFoundError:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
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
        port = address[1]
        self.allowed_origins = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
        super().__init__(address, lambda *args, **kwargs: ShareRequestHandler(*args, directory=self.site_root, **kwargs))
        actual_port = self.server_address[1]
        if port == 0:
            self.allowed_origins = {f"http://127.0.0.1:{actual_port}", f"http://localhost:{actual_port}"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Helm with immutable intranet shares and versioned Channels.")
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
