#!/usr/bin/env python3
"""Helm Bridge: a loopback-only ingress API for AI-authored HDOC HTML.

The browser app deliberately owns no server-side state. This companion process
gives other agents one safe way to hand documents to that local library:
validate the document, preserve its exact UTF-8 source, and retain every
revision submitted for the same stable HDOC artifact ID.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import tempfile
import threading
from datetime import datetime, timezone
from html.parser import HTMLParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


API_VERSION = "HBRIDGE/1.0"
HDOC_VERSION = "HDOC/1.0"
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
DOCUMENT_TYPES = {"report", "brief", "reference", "dashboard", "note"}
DEFAULT_CORS_ORIGINS = {"http://127.0.0.1:4173", "http://localhost:4173"}
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$")


class ContractError(ValueError):
    """The submitted document is not a safe, valid HDOC artifact."""

    def __init__(self, errors: list[str], warnings: list[str] | None = None):
        super().__init__("; ".join(errors))
        self.errors = errors
        self.warnings = warnings or []


class HDOCParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.manifest_scripts: list[str] = []
        self._manifest_parts: list[str] | None = None
        self.document_roots = 0
        self.h1_count = 0
        self.unsafe_scripts = 0
        self.event_handlers: list[str] = []
        self.external_dependencies: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {name.lower(): value or "" for name, value in attrs}
        tag = tag.lower()
        if tag == "meta" and attributes.get("name", "").lower().startswith("helm:"):
            self.meta[attributes["name"].lower()] = attributes.get("content", "").strip()
        if tag == "main" and "data-document-root" in attributes:
            self.document_roots += 1
        if tag == "h1":
            self.h1_count += 1
        if tag == "script":
            if "data-helm-manifest" in attributes:
                self._manifest_parts = []
            else:
                self.unsafe_scripts += 1
        for name, value in attributes.items():
            if name.startswith("on"):
                self.event_handlers.append(name)
            if name in {"src", "href"} and re.match(r"^https?://", value, re.IGNORECASE):
                self.external_dependencies.append(value)

    def handle_data(self, data: str) -> None:
        if self._manifest_parts is not None:
            self._manifest_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._manifest_parts is not None:
            self.manifest_scripts.append("".join(self._manifest_parts))
            self._manifest_parts = None


def parse_timestamp(value: Any, field: str, errors: list[str]) -> None:
    if not isinstance(value, str):
        errors.append(f"{field} must be an ISO 8601 timestamp.")
        return
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        errors.append(f"{field} must be an ISO 8601 timestamp.")
        return
    if parsed.tzinfo is None:
        errors.append(f"{field} must include a timezone.")


def validate_hdoc(html: str) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if not re.match(r"^\s*<!doctype\s+html", html, re.IGNORECASE):
        errors.append("The document must start with <!doctype html>.")
    parser = HDOCParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception as error:  # HTMLParser normally recovers, but keep ingress deterministic.
        errors.append(f"HTML could not be parsed: {error}.")

    if parser.document_roots != 1:
        errors.append("The document must contain exactly one <main data-document-root>.")
    if parser.h1_count != 1:
        errors.append("The document must contain exactly one h1.")
    if parser.unsafe_scripts:
        errors.append("Executable script tags are not accepted by Helm Bridge.")
    if parser.event_handlers:
        errors.append("Inline event handlers are not accepted by Helm Bridge.")
    if len(parser.manifest_scripts) != 1:
        errors.append("The document must contain exactly one data-helm-manifest script.")
        manifest: dict[str, Any] = {}
    else:
        try:
            parsed_manifest = json.loads(parser.manifest_scripts[0])
            manifest = parsed_manifest if isinstance(parsed_manifest, dict) else {}
            if not manifest:
                errors.append("The Helm manifest must be a JSON object.")
        except json.JSONDecodeError:
            manifest = {}
            errors.append("The Helm manifest is not valid JSON.")

    if manifest.get("schema_version") != HDOC_VERSION:
        errors.append(f"manifest.schema_version must equal {HDOC_VERSION}.")
    document_id = manifest.get("id")
    if not isinstance(document_id, str) or not ID_PATTERN.fullmatch(document_id) or len(document_id) > 100:
        errors.append("manifest.id must be a stable lowercase ID (letters, digits, hyphens; max 100).")
    title = manifest.get("title")
    if not isinstance(title, str) or not title.strip() or len(title) > 100:
        errors.append("manifest.title must be a non-empty string of at most 100 characters.")
    document_type = manifest.get("type")
    if document_type not in DOCUMENT_TYPES:
        errors.append("manifest.type must be report, brief, reference, dashboard, or note.")
    tags = manifest.get("tags")
    if not isinstance(tags, list) or len(tags) > 8 or any(not isinstance(tag, str) or not tag.strip() for tag in tags):
        errors.append("manifest.tags must contain at most eight non-empty strings.")
    summary = manifest.get("summary")
    if not isinstance(summary, str) or len(summary) > 240:
        errors.append("manifest.summary must be a string of at most 240 characters.")
    project = manifest.get("project")
    if project is not None:
        if not isinstance(project, dict):
            errors.append("manifest.project must be an object when present.")
        else:
            project_id = project.get("id")
            project_name = project.get("name")
            if not isinstance(project_id, str) or not ID_PATTERN.fullmatch(project_id) or len(project_id) > 100:
                errors.append("manifest.project.id must be a stable lowercase ID (letters, digits, hyphens; max 100).")
            if not isinstance(project_name, str) or not project_name.strip() or len(project_name) > 100:
                errors.append("manifest.project.name must be a non-empty string of at most 100 characters.")
    parse_timestamp(manifest.get("created_at"), "manifest.created_at", errors)
    parse_timestamp(manifest.get("updated_at"), "manifest.updated_at", errors)
    provenance = manifest.get("provenance")
    if not isinstance(provenance, dict) or not isinstance(provenance.get("author"), str) or not isinstance(provenance.get("sources"), list):
        errors.append("manifest.provenance must include author and sources.")

    expected_meta = {
        "helm:title": title,
        "helm:type": document_type,
        "helm:summary": summary,
        "helm:tags": ", ".join(tags) if isinstance(tags, list) else None,
    }
    for name, expected in expected_meta.items():
        actual = parser.meta.get(name)
        if not isinstance(expected, str) or actual != expected:
            errors.append(f"{name} must exactly match the manifest.")
    if parser.external_dependencies:
        warnings.append("The artifact references remote resources; it should remain meaningful without them.")
    if errors:
        raise ContractError(errors, warnings)
    return manifest, warnings


def safe_filename(document_id: str, digest: str) -> str:
    readable = re.sub(r"[^A-Za-z0-9._-]+", "-", document_id).strip(".-") or "artifact"
    return f"{readable[:72]}--{digest[:12]}.html"


def atomic_write(path: Path, payload: bytes, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if mode is not None:
            os.chmod(temporary_name, mode)
        os.replace(temporary_name, path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


class BridgeCatalog:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir.expanduser().resolve()
        self.artifact_dir = self.data_dir / "artifacts"
        self.catalog_path = self.data_dir / "catalog.json"
        self.token_path = self.data_dir / "token"
        self.lock = threading.RLock()
        self.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.artifact_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Bridge records can include private source documents. Restrict the
        # default local store even if an earlier run created it under a broad umask.
        os.chmod(self.data_dir, 0o700)
        os.chmod(self.artifact_dir, 0o700)
        self.documents = self._load_catalog()

    def _load_catalog(self) -> dict[str, dict[str, Any]]:
        if not self.catalog_path.exists():
            return {}
        try:
            payload = json.loads(self.catalog_path.read_text(encoding="utf-8"))
            documents = payload.get("documents", {})
            if isinstance(documents, dict):
                migrated: dict[str, dict[str, Any]] = {}
                for key, value in documents.items():
                    if not isinstance(value, dict):
                        continue
                    digest = value.get("sha256")
                    document_id = value.get("id") or key
                    revision_key = f"{document_id}:{digest}" if isinstance(digest, str) else key
                    migrated[revision_key] = value
                return migrated
        except (OSError, json.JSONDecodeError):
            pass
        raise RuntimeError(f"Helm Bridge catalog is unreadable: {self.catalog_path}")

    def _save_catalog(self) -> None:
        payload = {
            "format": "helm-bridge-catalog",
            "schema_version": API_VERSION,
            "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "document_count": len(self.documents),
            "documents": self.documents,
        }
        atomic_write(self.catalog_path, json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))

    def ensure_token(self) -> str:
        from_environment = os.environ.get("HELM_BRIDGE_TOKEN", "").strip()
        if from_environment:
            return from_environment
        if self.token_path.exists():
            token = self.token_path.read_text(encoding="utf-8").strip()
            if token:
                return token
        token = secrets.token_urlsafe(32)
        atomic_write(self.token_path, f"{token}\n".encode("utf-8"), mode=0o600)
        return token

    def ingest(self, html_bytes: bytes, source: str, submitted_project: dict[str, Any] | None = None) -> tuple[str, dict[str, Any]]:
        if len(html_bytes) > MAX_DOCUMENT_BYTES:
            raise ContractError([f"Document exceeds the {MAX_DOCUMENT_BYTES // (1024 * 1024)} MB ingress limit."])
        try:
            html = html_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ContractError([f"Document must be UTF-8 HTML: {error}."]) from error
        manifest, warnings = validate_hdoc(html)
        document_id = manifest["id"]
        declared_project = manifest.get("project") if isinstance(manifest.get("project"), dict) else None
        project = declared_project or self._catalog_project(submitted_project)
        digest = hashlib.sha256(html_bytes).hexdigest()
        with self.lock:
            revision_key = f"{document_id}:{digest}"
            existing = self.documents.get(revision_key)
            if existing:
                if (self.data_dir / existing["artifact_path"]).read_bytes() != html_bytes:
                    raise RuntimeError("Digest-addressed Bridge storage is inconsistent.")
                return "idempotent", {**existing, "warnings": warnings}
            prior_revisions = [record for record in self.documents.values() if record.get("id") == document_id]
            relative_path = Path("artifacts") / f"{document_id}--{digest}.html"
            received_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            record = {
                "id": document_id,
                "source_document_id": document_id,
                "title": manifest["title"],
                "type": manifest["type"],
                "tags": manifest["tags"],
                "summary": manifest["summary"],
                "created_at": manifest["created_at"],
                "updated_at": manifest["updated_at"],
                "provenance": manifest["provenance"],
                **({"project": project} if project else {}),
                "source": source[:120] or "unnamed-agent",
                "received_at": received_at,
                "sha256": digest,
                "revision_id": f"sha256:{digest}",
                "revision_number": len(prior_revisions) + 1,
                "artifact_path": relative_path.as_posix(),
                "warnings": warnings,
            }
            atomic_write(self.data_dir / relative_path, html_bytes)
            self.documents[revision_key] = record
            self._save_catalog()
            return ("revision" if prior_revisions else "created"), record

    @staticmethod
    def _catalog_project(value: dict[str, Any] | None) -> dict[str, str] | None:
        if not isinstance(value, dict):
            return None
        project_id = value.get("id")
        project_name = value.get("name")
        if not isinstance(project_id, str) or not ID_PATTERN.fullmatch(project_id) or len(project_id) > 100:
            return None
        if not isinstance(project_name, str) or not project_name.strip() or len(project_name) > 100:
            return None
        return {"id": project_id, "name": project_name.strip()}

    def list_documents(self) -> list[dict[str, Any]]:
        with self.lock:
            records = []
            for revision_key in sorted(self.documents, key=lambda key: self.documents[key].get("received_at", "")):
                records.append(self.read_document(revision_key))
            return records

    def read_document(self, document_id: str) -> dict[str, Any]:
        with self.lock:
            record = self.documents.get(document_id)
            if not record:
                matches = [value for value in self.documents.values() if value.get("id") == document_id]
                record = max(matches, key=lambda value: value.get("received_at", ""), default=None)
            if not record:
                raise KeyError(document_id)
            try:
                html = (self.data_dir / record["artifact_path"]).read_text(encoding="utf-8")
            except OSError as error:
                raise RuntimeError(f"Stored HTML for {document_id!r} is unavailable.") from error
            return {**record, "html": html}


class BridgeRequestHandler(BaseHTTPRequestHandler):
    server: "BridgeHTTPServer"
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        # Avoid putting document titles or credentials in terminal logs.
        print(f"Helm Bridge {self.address_string()} {self.command} {self.path} {args[-2] if len(args) >= 2 else ''}")

    def _origin_allowed(self) -> str | None:
        origin = self.headers.get("Origin")
        return origin if origin and origin in self.server.cors_origins else None

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        origin = self._origin_allowed()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(encoded)

    def _send_text(self, status: HTTPStatus, payload: str, content_type: str = "text/plain; charset=utf-8") -> None:
        encoded = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        origin = self._origin_allowed()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(encoded)

    def _authorized(self) -> bool:
        authorization = self.headers.get("Authorization", "")
        return authorization.startswith("Bearer ") and secrets.compare_digest(authorization[7:].strip(), self.server.token)

    def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self.send_response(HTTPStatus.NO_CONTENT)
        origin = self._origin_allowed()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Helm-Source, X-Helm-Project-Id, X-Helm-Project-Name")
            self.send_header("Vary", "Origin")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = urlparse(self.path).path
        try:
            if path == "/v1/health":
                self._send_json(HTTPStatus.OK, {"ok": True, "api_version": API_VERSION, "document_count": len(self.server.catalog.documents)})
                return
            if path == "/v1/contract":
                self._send_text(HTTPStatus.OK, self.server.spec_path.read_text(encoding="utf-8"), "text/markdown; charset=utf-8")
                return
            if path == "/v1/artifacts":
                documents = self.server.catalog.list_documents()
                self._send_json(HTTPStatus.OK, {"api_version": API_VERSION, "document_count": len(documents), "documents": documents})
                return
            if path.startswith("/v1/artifacts/"):
                document = self.server.catalog.read_document(unquote(path.removeprefix("/v1/artifacts/")))
                self._send_json(HTTPStatus.OK, document)
                return
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
        except KeyError:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
        except (OSError, RuntimeError) as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "storage_error", "message": str(error)})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if urlparse(self.path).path != "/v1/artifacts":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        if not self._authorized():
            self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            content_length = -1
        if content_length < 0 or content_length > MAX_DOCUMENT_BYTES:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "payload_too_large", "max_bytes": MAX_DOCUMENT_BYTES})
            return
        payload = self.rfile.read(content_length)
        source = self.headers.get("X-Helm-Source", "")
        submitted_project: dict[str, Any] | None = None
        project_id = self.headers.get("X-Helm-Project-Id", "").strip()
        project_name = self.headers.get("X-Helm-Project-Name", "").strip()
        if project_id or project_name:
            submitted_project = {"id": project_id, "name": project_name}
        if self.headers.get("Content-Type", "").split(";", 1)[0].lower() == "application/json":
            try:
                envelope = json.loads(payload.decode("utf-8"))
                payload = envelope["html"].encode("utf-8")
                source = source or str(envelope.get("source", ""))
                submitted_project = submitted_project or envelope.get("project")
            except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError):
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json_envelope", "message": "JSON requests require an html string."})
                return
        try:
            status, record = self.server.catalog.ingest(payload, source, submitted_project)
            response_status = HTTPStatus.CREATED if status in {"created", "revision"} else HTTPStatus.OK
            self._send_json(response_status, {"status": status, "artifact": record})
        except ContractError as error:
            self._send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": "invalid_hdoc", "errors": error.errors, "warnings": error.warnings})
        except (OSError, RuntimeError) as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "storage_error", "message": str(error)})


class BridgeHTTPServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], catalog: BridgeCatalog, token: str, spec_path: Path, cors_origins: set[str]):
        super().__init__(address, BridgeRequestHandler)
        self.daemon_threads = True
        self.catalog = catalog
        self.token = token
        self.spec_path = spec_path
        self.cors_origins = cors_origins


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Helm Bridge ingestion API.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: loopback only).")
    parser.add_argument("--port", type=int, default=4175, help="Bind port (default: 4175).")
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("HELM_BRIDGE_DATA_DIR", Path.home() / ".helm-bridge")))
    parser.add_argument("--spec", type=Path, default=Path(__file__).resolve().parent / "docs" / "HTML-DOCUMENT-SPEC.md")
    parser.add_argument("--cors-origin", action="append", dest="cors_origins", help="Allowed browser origin; may be repeated.")
    args = parser.parse_args()
    catalog = BridgeCatalog(args.data_dir)
    token = catalog.ensure_token()
    cors_origins = set(args.cors_origins or DEFAULT_CORS_ORIGINS)
    server = BridgeHTTPServer((args.host, args.port), catalog, token, args.spec.resolve(), cors_origins)
    print(f"Helm Bridge {API_VERSION} listening on http://{args.host}:{args.port}")
    print(f"Catalog: {catalog.data_dir}; token file: {catalog.token_path}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
