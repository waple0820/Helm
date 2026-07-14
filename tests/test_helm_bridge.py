#!/usr/bin/env python3
import sys
import tempfile
import unittest
from stat import S_IMODE
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from helm_bridge import BridgeCatalog, ContractError, validate_hdoc


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
