import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from stat import S_IMODE

from helm_bridge import ContractError
from helm_share_server import ChannelConflictError, ShareHTTPServer, ShareStore


def hdoc(title="Shared report", summary="A report shared on the intranet."):
    return f'''<!doctype html><html><head>
<meta name="helm:title" content="{title}"><meta name="helm:type" content="report">
<meta name="helm:summary" content="{summary}"><meta name="helm:tags" content="shared, test">
<script type="application/json" data-helm-manifest>{{"schema_version":"HDOC/1.0","id":"shared-report","title":"{title}","type":"report","tags":["shared","test"],"summary":"{summary}","created_at":"2026-07-14T00:00:00Z","updated_at":"2026-07-14T00:00:00Z","provenance":{{"author":"test","sources":[]}}}}</script>
</head><body><main data-document-root><h1>{title}</h1><p>{summary}</p></main></body></html>'''.encode()


class ShareStoreTests(unittest.TestCase):
    def test_legacy_publish_is_content_addressed_and_idempotent(self):
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

    def test_channel_publish_updates_pointer_without_mutating_revisions(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ShareStore(Path(directory))
            first = store.publish_channel(hdoc())
            retry = store.publish_channel(hdoc())
            revised_source = hdoc(summary="A revised Channel report.")
            revised = store.publish_channel(revised_source, first["sha256"])

            self.assertEqual("created", first["state"])
            self.assertEqual("idempotent", retry["state"])
            self.assertEqual("updated", revised["state"])
            self.assertNotEqual(first["sha256"], revised["sha256"])
            self.assertEqual(hdoc(), store.resolve_revision(f'{first["sha256"]}.html').read_bytes())
            state, current = store.resolve_artifact("shared-report")
            self.assertEqual("published", state)
            self.assertEqual(revised_source, current.read_bytes())
            self.assertEqual(0o600, S_IMODE(current.stat().st_mode))
            self.assertEqual(0o600, S_IMODE(store.channel_catalog_path.stat().st_mode))

    def test_channel_update_requires_the_current_base_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ShareStore(Path(directory))
            first = store.publish_channel(hdoc())
            with self.assertRaises(ChannelConflictError) as missing:
                store.publish_channel(hdoc(summary="No base revision."))
            self.assertEqual(first["sha256"], missing.exception.current_revision)
            with self.assertRaises(ChannelConflictError):
                store.publish_channel(hdoc(summary="Stale base revision."), "0" * 64)

    def test_revoke_only_removes_the_stable_pointer_and_can_republish(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ShareStore(Path(directory))
            first = store.publish_channel(hdoc())
            revoked = store.revoke_channel("shared-report", first["sha256"])
            repeated = store.revoke_channel("shared-report", first["sha256"])
            self.assertEqual("revoked", revoked["state"])
            self.assertEqual("idempotent", repeated["state"])
            self.assertEqual("revoked", store.resolve_artifact("shared-report")[0])
            self.assertEqual(hdoc(), store.resolve_revision(f'{first["sha256"]}.html').read_bytes())
            republished = store.publish_channel(hdoc(), first["sha256"])
            self.assertEqual("republished", republished["state"])
            self.assertEqual("published", store.resolve_artifact("shared-report")[0])

    def test_channel_catalog_survives_restart_and_rejects_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = ShareStore(root).publish_channel(hdoc())
            reopened = ShareStore(root)
            self.assertEqual(first["sha256"], reopened.artifact("shared-report")["current_revision"])
            reopened.channel_catalog_path.write_text("not json", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                ShareStore(root)

    def test_invalid_document_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ContractError):
                ShareStore(Path(directory)).publish_channel(b"<html><h1>not HDOC</h1></html>")


class ShareServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.root = root
        self.server = ShareHTTPServer(("127.0.0.1", 0), root, ShareStore(root / "shares"), "http://example.test")
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def request(self, method, path, payload=None, headers=None):
        body = json.dumps(payload).encode() if payload is not None else None
        request_headers = dict(headers or {})
        if payload is not None and "Content-Type" not in request_headers:
            request_headers["Content-Type"] = "application/json"
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def publish_channel(self, source=None, base=None):
        payload = {"html": (source or hdoc()).decode()}
        if base is not None:
            payload["base_revision_sha256"] = base
        status, headers, body = self.request("POST", "/api/channels/publish", payload)
        return status, headers, json.loads(body)

    def test_channel_http_lifecycle_and_cache_boundaries(self):
        status, _, created = self.publish_channel()
        self.assertEqual(201, status)
        self.assertEqual("http://example.test/a/shared-report", created["stable_url"])
        digest = created["sha256"]

        stable_status, stable_headers, stable_body = self.request("GET", "/a/shared-report")
        revision_status, revision_headers, revision_body = self.request("GET", f"/r/{digest}.html")
        self.assertEqual((200, hdoc()), (stable_status, stable_body))
        self.assertEqual((200, hdoc()), (revision_status, revision_body))
        self.assertEqual("no-store", stable_headers["Cache-Control"])
        self.assertIn("immutable", revision_headers["Cache-Control"])
        self.assertIn("sandbox", stable_headers["Content-Security-Policy"])

        revised_source = hdoc(summary="The newest stable Channel revision.")
        update_status, _, updated = self.publish_channel(revised_source, digest)
        self.assertEqual(200, update_status)
        self.assertEqual("updated", updated["state"])
        self.assertEqual(hdoc(), self.request("GET", f"/r/{digest}.html")[2])
        self.assertEqual(revised_source, self.request("GET", "/a/shared-report")[2])

        revoke_status, _, revoke_body = self.request("POST", "/api/channels/artifacts/shared-report/revoke", {"base_revision_sha256": updated["sha256"]})
        self.assertEqual((200, "revoked"), (revoke_status, revoke_body and json.loads(revoke_body)["state"]))
        self.assertEqual(410, self.request("GET", "/a/shared-report")[0])
        self.assertEqual(200, self.request("GET", f'/r/{updated["sha256"]}.html')[0])

    def test_head_matches_get_headers_without_a_body(self):
        _, _, created = self.publish_channel()
        status, headers, body = self.request("HEAD", f'/r/{created["sha256"]}.html')
        self.assertEqual(200, status)
        self.assertEqual(str(len(hdoc())), headers["Content-Length"])
        self.assertEqual(b"", body)

    def test_mutations_require_safe_origin_and_json(self):
        evil = {"Origin": "https://evil.example", "Content-Type": "application/json"}
        status, _, body = self.request("POST", "/api/channels/publish", {"html": hdoc().decode()}, evil)
        self.assertEqual((403, "origin_forbidden"), (status, json.loads(body)["error"]))

        allowed = {"Origin": f"http://127.0.0.1:{self.port}", "Content-Type": "text/plain"}
        status, _, body = self.request("POST", "/api/channels/publish", {"html": hdoc().decode()}, allowed)
        self.assertEqual((415, "content_type_required"), (status, json.loads(body)["error"]))

    def test_stale_update_returns_current_revision(self):
        _, _, created = self.publish_channel()
        status, _, body = self.publish_channel(hdoc(summary="A conflicting update."), "0" * 64)
        self.assertEqual(409, status)
        self.assertEqual(created["sha256"], body["current_revision_sha256"])

    def test_legacy_share_api_and_url_remain_compatible(self):
        status, _, published_body = self.request("POST", "/api/share", {"html": hdoc().decode()})
        published = json.loads(published_body)
        self.assertEqual(201, status)
        self.assertTrue(published["path"].startswith("/share/shared-report--"))
        get_status, headers, body = self.request("GET", published["path"])
        self.assertEqual((200, hdoc()), (get_status, body))
        self.assertIn("immutable", headers["Cache-Control"])

    def test_owner_catalog_and_path_validation(self):
        (self.root / ".git").mkdir()
        (self.root / ".git" / "config").write_text("private", encoding="utf-8")
        (self.root / "scripts").mkdir()
        (self.root / "scripts" / "x.txt").write_text("private", encoding="utf-8")
        self.publish_channel()
        status, _, body = self.request("GET", "/api/channels")
        self.assertEqual(200, status)
        self.assertEqual("shared-report", json.loads(body)["artifacts"][0]["id"])
        self.assertEqual(404, self.request("GET", "/a/%2e%2e%2fsecret")[0])
        self.assertEqual(404, self.request("GET", "/r/not-a-revision.html")[0])
        self.assertEqual(404, self.request("GET", "/%2egit/config")[0])
        self.assertEqual(404, self.request("GET", "/scripts%2fx.txt")[0])
        self.assertEqual(404, self.request("GET", "/shares/channels.json")[0])
        self.assertEqual(404, self.request("GET", "/shares/revisions/")[0])


if __name__ == "__main__":
    unittest.main()
