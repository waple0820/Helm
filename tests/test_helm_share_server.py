import tempfile
import unittest
from pathlib import Path

from helm_bridge import ContractError
from helm_share_server import ShareStore


def hdoc(title="Shared report", summary="A report shared on the intranet."):
    return f'''<!doctype html><html><head>
<meta name="helm:title" content="{title}"><meta name="helm:type" content="report">
<meta name="helm:summary" content="{summary}"><meta name="helm:tags" content="shared, test">
<script type="application/json" data-helm-manifest>{{"schema_version":"HDOC/1.0","id":"shared-report","title":"{title}","type":"report","tags":["shared","test"],"summary":"{summary}","created_at":"2026-07-14T00:00:00Z","updated_at":"2026-07-14T00:00:00Z","provenance":{{"author":"test","sources":[]}}}}</script>
</head><body><main data-document-root><h1>{title}</h1><p>{summary}</p></main></body></html>'''.encode()


class ShareStoreTests(unittest.TestCase):
    def test_publish_is_content_addressed_and_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ShareStore(Path(directory))
            first = store.publish(hdoc())
            retry = store.publish(hdoc())
            revised = store.publish(hdoc(summary="A revised, separately addressed report."))
            self.assertEqual(first["filename"], retry["filename"])
            self.assertEqual("created", first["state"])
            self.assertEqual("idempotent", retry["state"])
            self.assertNotEqual(first["filename"], revised["filename"])
            self.assertEqual(hdoc(), store.resolve(first["filename"]).read_bytes())

    def test_invalid_document_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ContractError):
                ShareStore(Path(directory)).publish(b"<html><h1>not HDOC</h1></html>")


if __name__ == "__main__":
    unittest.main()
