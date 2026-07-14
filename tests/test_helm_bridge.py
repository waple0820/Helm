#!/usr/bin/env python3
import sys
import tempfile
import threading
import unittest
from stat import S_IMODE
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from helm_bridge import BridgeCatalog, BridgeHTTPServer, ContractError, is_allowed_browser_origin, validate_hdoc


def document(document_id="agent-report", title="Agent report", body="Evidence", project=None):
    project_fragment = f',"project":{project}' if project is not None else ""
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="helm:title" content="{title}"><meta name="helm:type" content="report"><meta name="helm:summary" content="A concise agent result."><meta name="helm:tags" content="agent, evidence"><title>{title}</title><style>body{{font-family:system-ui}}</style><script type="application/json" data-helm-manifest>{{"schema_version":"HDOC/1.0","id":"{document_id}","title":"{title}","type":"report","tags":["agent","evidence"],"summary":"A concise agent result.","created_at":"2026-07-13T00:00:00Z","updated_at":"2026-07-13T00:00:00Z"{project_fragment},"provenance":{{"author":"test-agent","sources":[]}}}}</script></head><body><main data-document-root><h1>{title}</h1><p>{body}</p></main></body></html>'''


class HelmBridgeTests(unittest.TestCase):
    def test_validates_and_rejects_executable_html(self):
        manifest, warnings = validate_hdoc(document())
        self.assertEqual(manifest["id"], "agent-report")
        self.assertEqual(warnings, [])
        with self.assertRaises(ContractError):
            validate_hdoc(document().replace("</body>", "<script>alert(1)</script></body>"))

    def test_portability_warnings_cover_relative_and_remote_dependencies(self):
        relative = document(body='<a href="../stage2/report.html">Stage two</a><img src="./chart.png" alt="Chart">')
        _, warnings = validate_hdoc(relative)
        self.assertTrue(any("relative files or links" in warning for warning in warnings))

        remote_media = document(body='<img src="https://cdn.example/chart.png" alt="Chart">')
        _, warnings = validate_hdoc(remote_media)
        self.assertTrue(any("remote resources" in warning for warning in warnings))

        portable_links = document(body='<a href="#finding">Finding</a><a href="mailto:owner@example.com">Owner</a><img src="data:image/gif;base64,AA==" alt="Dot">')
        _, warnings = validate_hdoc(portable_links)
        self.assertEqual(warnings, [])

    def test_cors_accepts_loopback_on_any_port_but_not_arbitrary_origins(self):
        for origin in (
            "http://127.0.0.1:4173",
            "http://127.0.0.1:4182",
            "http://localhost:9000",
            "https://[::1]:4443",
        ):
            with self.subTest(origin=origin):
                self.assertTrue(is_allowed_browser_origin(origin))
        for origin in (
            "https://evil.example",
            "http://localhost.evil.example:4173",
            "http://user@localhost:4173",
            "http://localhost:4173/path",
            "null",
        ):
            with self.subTest(origin=origin):
                self.assertFalse(is_allowed_browser_origin(origin))
        self.assertTrue(is_allowed_browser_origin("https://helm.example", {"https://helm.example"}))

    def test_http_cors_reflects_only_allowed_origin(self):
        with tempfile.TemporaryDirectory() as directory:
            catalog = BridgeCatalog(Path(directory))
            spec_path = Path(directory) / "spec.md"
            spec_path.write_text("contract", encoding="utf-8")
            server = BridgeHTTPServer(("127.0.0.1", 0), catalog, "token", spec_path, set())
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            endpoint = f"http://127.0.0.1:{server.server_port}/v1/health"
            try:
                with urlopen(Request(endpoint, headers={"Origin": "http://localhost:4182"})) as response:
                    self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:4182")
                with urlopen(Request(endpoint, headers={"Origin": "https://evil.example"})) as response:
                    self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_idempotency_revision_history_and_exact_originals(self):
        source = document(body="Exact original text.").encode("utf-8")
        with tempfile.TemporaryDirectory() as directory:
            catalog = BridgeCatalog(Path(directory))
            catalog.ensure_token()
            self.assertEqual(S_IMODE(catalog.data_dir.stat().st_mode), 0o700)
            self.assertEqual(S_IMODE(catalog.artifact_dir.stat().st_mode), 0o700)
            self.assertEqual(S_IMODE(catalog.token_path.stat().st_mode), 0o600)
            created, record = catalog.ingest(source, "test-agent")
            repeated, same_record = catalog.ingest(source, "test-agent")
            self.assertEqual(created, "created")
            self.assertEqual(repeated, "idempotent")
            self.assertEqual(record["sha256"], same_record["sha256"])
            self.assertEqual(catalog.read_document("agent-report")["html"].encode("utf-8"), source)
            revised_source = document(body="Different source.").encode("utf-8")
            revised, revised_record = catalog.ingest(revised_source, "test-agent")
            self.assertEqual(revised, "revision")
            self.assertEqual(revised_record["revision_number"], 2)
            revisions = catalog.list_documents()
            self.assertEqual(len(revisions), 2)
            self.assertEqual({entry["html"].encode("utf-8") for entry in revisions}, {source, revised_source})

    def test_project_can_be_declared_or_attached_by_the_submitter(self):
        declared = '{"id":"texas-gto-lab","name":"Texas GTO Lab"}'
        manifest, _ = validate_hdoc(document(project=declared))
        self.assertEqual(manifest["project"]["id"], "texas-gto-lab")
        with tempfile.TemporaryDirectory() as directory:
            catalog = BridgeCatalog(Path(directory))
            _, record = catalog.ingest(document().encode("utf-8"), "test-agent", {"id": "html-displayer", "name": "Helm"})
            self.assertEqual(record["project"], {"id": "html-displayer", "name": "Helm"})
        with self.assertRaises(ContractError):
            validate_hdoc(document(project='{"id":"Not stable","name":"Broken"}'))


if __name__ == "__main__":
    unittest.main()
