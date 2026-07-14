# Helm Channels and intranet sharing

Helm keeps the personal browser library private. Publishing copies only an explicitly selected, validated HDOC document into the share service. Network visitors can read published pages but cannot browse the library or change a Channel.

The browser publishes only when the logical Artifact ID equals the embedded HDOC manifest ID. Catalog copies and newly created Forks therefore cannot accidentally advance the source Artifact's Channel; a Fork first needs an explicitly authored HDOC Revision with its own matching identity.

## Two kinds of links

Helm Channels separates a logical Artifact from its immutable Revisions:

- `GET /a/<artifact-id>` is the stable Artifact address. It serves the current published Revision with `Cache-Control: no-store`, so an update appears at the same address.
- `GET /r/<full-sha256>.html` is one exact, immutable Revision. It is content-addressed and receives a one-year immutable cache policy.

Every update appends a new byte-for-byte Revision and atomically advances the stable Artifact pointer. Existing Revision files are never overwritten. The service records the pointer and publication state in `channels.json`, while exact sources live under `revisions/` in the configured share directory.

Revoking a Channel makes its stable `/a/` address return `410 Gone`. It does not delete immutable Revision addresses that have already been distributed. This is a publication boundary, not a promise that previously shared bytes can be recalled.

## Owner workflow and API

Run the static app and share API together:

```bash
python3 helm_share_server.py \
  --host 0.0.0.0 \
  --port 4173 \
  --public-base-url http://INTRANET_HOST:4173
```

Channel mutations are accepted only through an owner loopback connection. Browser requests must use `Content-Type: application/json` and an allowed local Origin; command-line clients may omit Origin. When the service runs remotely, use an SSH local forward for management.

Create a Channel:

```http
POST /api/channels/publish
Content-Type: application/json

{"html":"<!doctype html>..."}
```

The response contains both `stable_url` and `revision_url`. To publish changed bytes, send the Revision currently observed by the editor:

```http
POST /api/channels/publish
Content-Type: application/json

{"html":"<!doctype html>...", "base_revision_sha256":"<current full sha256>"}
```

If another writer has advanced the Artifact, the service returns `409 revision_conflict` and the current digest instead of silently replacing it. Exact retries of the current published bytes are idempotent.

Revoke the stable address with the same compare-and-swap boundary:

```http
POST /api/channels/artifacts/<artifact-id>/revoke
Content-Type: application/json

{"base_revision_sha256":"<current full sha256>"}
```

Owner-only `GET /api/channels` and `GET /api/channels/artifacts/<artifact-id>` expose publication records for management UI. They are not an intranet directory.

## Legacy one-shot shares

Existing one-shot sharing remains fully compatible:

- `POST /api/share` publishes one validated document through loopback.
- `GET /share/<document-id>--<digest-prefix>.html` remains an immutable public address.
- Existing flat share files are not renamed or redirected during the Channels migration. Helm keeps their original URL visible as a **Legacy immutable share** instead of misreporting it as a Channel.
- The owner may explicitly retire one exact legacy URL with `POST /api/share/revoke`. The request must include both its `/share/...` path and full SHA-256 digest; Helm verifies the path, filename digest prefix, and stored bytes before deleting that one file.

```http
POST /api/share/revoke
Content-Type: application/json

{"path":"/share/<document-id>--<digest-prefix>.html", "sha256":"<full sha256>"}
```

After this explicit action the legacy URL returns `404 Not Found`. Unlike a Channel revoke, there is no retained content-addressed Revision behind a legacy one-shot share.

The legacy endpoint never advances a Channel because it has no base Revision for conflict detection. Publish through `/api/channels/publish` when one stable address should evolve.

## Security boundary

- Public HTML receives a sandboxed CSP, `no-referrer`, and `nosniff` headers.
- The default share directory is `~/.helm-shares`; Channel source files and catalog metadata are owner-only. Legacy flat files retain their original compatibility permissions.
- Restrict the listening port to the intended private network at the host firewall.
- Never publish secrets, credentials, private source material, or machine-specific access data.
- Deleting a browser catalog entry does not delete an already published URL.

## Repeatable remote deployment

Deploy only a reviewed, committed tree. Runtime shares live outside the application directory and survive an atomic upgrade:

```bash
scripts/deploy-remote \
  --host USER@INTRANET_HOST \
  --public-base-url http://INTRANET_HOST:4173
```

The command archives `HEAD`, runs the full test suite in a staging directory on the target, swaps the application directory, restarts the configured tmux service, and rolls back if the Channel health check fails. It never copies browser data, Bridge tokens, or `~/.helm-shares`.
