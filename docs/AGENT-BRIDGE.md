# Helm Bridge — agent ingress

`HDOC/1.0` describes the portable file. Helm Bridge is the optional local ingress service that lets an AI agent hand a completed file to a person's Helm library without giving the agent access to that browser library.

## Boundary

```text
Agent writes HDOC HTML -> Helm Bridge inbox -> person reviews -> explicit browser import -> IndexedDB library
```

The Bridge stores the submitted original under `~/.helm-bridge/` in owner-only directories. It does **not** open, change, or read the browser's IndexedDB. The browser app only reads the inbox over loopback and imports on a human click. The Bridge listens on `127.0.0.1:4175` by default; it is not a public API.

## Start on the person’s machine

From a fresh clone, use the bootstrap so both the Bridge and the protected Agent configuration are ready:

```bash
scripts/helm-agent-bootstrap --agent-name codex
```

`python3 helm_bridge.py` remains the lower-level service command when you deliberately want to manage its process yourself.

On its first start, the service creates a random write token at `~/.helm-bridge/token` with owner-only permissions. Do not paste that token into a prompt, commit it, or put it in generated HTML. The service prints the token *path*, never the token itself.

The read-only endpoints require no token:

- `GET /v1/health` — liveness and inbox count.
- `GET /v1/contract` — the authoritative `HDOC/1.0` document contract.
- `GET /v1/artifacts` — current inbox records and their original HTML.

`POST /v1/artifacts` requires `Authorization: Bearer $HELM_BRIDGE_TOKEN` and accepts raw UTF-8 HTML or `{ "html": "…", "source": "…", "project": { "id": "…", "name": "…" } }` JSON. A declared `manifest.project` takes precedence; otherwise the supplied client sends the current working project's stable ID and name as catalog-only metadata.

## What the Bridge guarantees

- Rejects unsafe or invalid submissions: executable scripts, inline handlers, missing HDOC metadata, invalid timestamps, duplicate roots or headings, and files larger than 5 MB.
- Preserves the accepted UTF-8 bytes exactly; it does not format, repair, or mutate submitted HTML.
- Treats the manifest ID as an immutable stable identity. Resending the exact bytes is idempotent. Sending different bytes with an existing ID returns `409 Conflict`, never an overwrite.
- Warns about remote resources, but does not rewrite them. The browser reader keeps its separate no-network sandbox.

## Agent integration

An agent must first read [`docs/CODEX-MEMORY.md`](CODEX-MEMORY.md), [`AI-GUIDE.md`](../AI-GUIDE.md), [`REPORT-DESIGN-STANDARD.md`](REPORT-DESIGN-STANDARD.md), and the full [`HTML-DOCUMENT-SPEC.md`](HTML-DOCUMENT-SPEC.md). This repository's [`AGENTS.md`](../AGENTS.md) makes the handoff rule discoverable to compatible coding agents. Once bootstrap has placed the protected runtime configuration at the default path, the final delivery step is deterministic:

```bash
/path/to/html-displayer/scripts/helm-submit output.html --source "research-agent"
```

[`templates/agent-handoff.html`](../templates/agent-handoff.html) is a valid, evidence-forward starting point for a result the agent wants a person to review.

Run the command from the artifact's project root. The client derives its fallback project identity from that directory; use `--project-id stable-id --project-name "Project name"` if that is not possible. The wrapper loads the process environment from `~/.config/helm-agent/helm-bridge.env`. A direct client invocation needs only:

```bash
HELM_BRIDGE_ENDPOINT=http://127.0.0.1:4175
HELM_BRIDGE_TOKEN=owner-provided-secret
HELM_AGENT_NAME=research-agent
```

The supplied client treats `409` as an identity conflict and `422` as a contract failure. It must not solve either condition by silently changing the old document’s ID or overwriting it. Generate a genuinely new artifact when the content needs a new stable identity.

## Remote agents

When an agent lives on a server, keep the Bridge on the person’s machine and use an SSH reverse tunnel that binds only on the server loopback interface:

```bash
ssh -N -R 127.0.0.1:4175:127.0.0.1:4175 agent-server
```

Then configure that server's agent runtime with `HELM_BRIDGE_ENDPOINT=http://127.0.0.1:4175` plus its token. This does not expose the Bridge on a public address. The server operator should place the token in a protected runtime environment file, not in an agent prompt or repository.

`scripts/helm-agent-bootstrap` is intentionally for the machine that owns the Bridge and its token. On a remote Agent host, use `scripts/helm-agent-bootstrap --check` only after the tunnel owner has supplied the protected runtime configuration.

To receive the artifact, open **Agent inbox** in Helm and choose **Import new artifacts**. The import is explicit; same browser IDs are skipped, while source-ID conflicts use the existing catalog-copy decision UI.
