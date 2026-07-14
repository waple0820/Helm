# Helm intranet sharing

Helm keeps the personal library in browser storage. Sharing does not expose that library. It publishes one explicitly selected, validated HDOC document as an immutable read-only file.

## User flow

1. Select an artifact that passes `HDOC/1.0` validation.
2. Choose **Publish intranet link** in the inspector or **Share link** in the reader.
3. Helm validates and stores the exact HTML bytes, then copies the returned URL.
4. Anyone who can reach the configured intranet host can open that URL without access to the rest of the browser library.

The filename contains a SHA-256 digest prefix. Publishing the same bytes again is idempotent and returns the same address. Changed bytes produce a new address; an existing share is never overwritten or silently redirected.

## Service boundary

Run the static app and share API together:

```bash
python3 helm_share_server.py \
  --host 0.0.0.0 \
  --port 4173 \
  --public-base-url http://INTRANET_HOST:4173
```

- `GET /share/<document-id>--<digest>.html` is available to the intranet and returns a sandboxed, read-only document.
- `POST /api/share` is accepted only when the connection reaches the server through loopback. The owner can use an SSH local forward; direct intranet visitors cannot publish.
- Shared HTML lives outside the site root by default in `~/.helm-shares` and is not part of IndexedDB, the Agent inbox, or a Git checkout.
- Restrict the listening port to the intended private network at the host firewall. Never publish secrets, credentials, private source material, or machine-specific access data.

This is deliberate publication, not synchronization: deleting a browser catalog entry does not delete an already shared immutable URL.
