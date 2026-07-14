# Helm architecture

Helm is deliberately split into small, inspectable planes. A document can remain useful even when any optional plane is not running.

## System map

```text
                       final standalone HDOC/1.0 HTML
                                       │
                                       ▼
  agent/project ── POST ──> Loopback Bridge ── review ──> Browser library
                               original bytes                 IndexedDB
                                    │                            │
                                    └── immutable inbox           ├── HARC export
                                                                 ├── explicit folder sync
                                                                 └── owner-selected share
                                                                          │
                                                                          ▼
                                                               read-only intranet HTML
```

## Four planes

| Plane | Primary code | Responsibility | Trust boundary |
| --- | --- | --- | --- |
| Browser library | `index.html`, `app.js`, `validator.js`, `archive-backup.js`, `folder-sync.js`, `repair.js` | Catalog, safe reading, search, metadata overlays, recovery, and explicit import. | The browser owns the personal library. |
| Artifact contract | `docs/HTML-DOCUMENT-SPEC.md`, `AI-GUIDE.md`, `templates/` | Portable `HDOC/1.0` HTML with evidence, provenance, and visual reading structure. | Artifact authors must not rely on Helm to make a document intelligible. |
| Agent handoff | `helm_bridge.py`, `scripts/helm-agent-bootstrap`, `scripts/helm-submit` | Authenticated loopback ingress; exact-byte inbox storage; idempotency and revision semantics. | Agents can submit, never import into browser storage. |
| Intranet sharing | `helm_share_server.py`, `docs/INTRANET-SHARING.md` | Explicit, immutable, read-only publication of one validated artifact. | Visitors can read a selected shared file, never enumerate or alter the library. |

## Data invariants

1. **Original HTML is immutable.** A browser catalog overlay may improve title, project, tag, or source metadata without rewriting the stored file.
2. **Identity is stable.** The manifest ID identifies the artifact; changed bytes are a revision or a genuinely new artifact, never an overwrite.
3. **The document is portable.** A finished artifact is a standalone `HDOC/1.0` file with a semantic root, embedded essential CSS, manifest, and provenance.
4. **Import is owner-controlled.** The Bridge and an intranet share server cannot mutate IndexedDB.
5. **Publication is explicit.** Sharing produces a content-addressed read-only copy outside the browser library and outside the Git checkout.

## Repository layout

The root remains intentionally small because the product is a static browser application plus Python standard-library services. Browser modules stay adjacent to the entry page; reusable standards and operational contracts live under `docs/`; user-facing starters live under `templates/`; and behavior is covered by `tests/`.

Do not introduce a framework build pipeline, server database, or cloud dependency merely to reorganize files. A new dependency needs to preserve Helm's local-first and durable-original guarantees.

## Reading order for contributors

1. [`README.md`](../README.md) — product promise and local start.
2. [`HTML-DOCUMENT-SPEC.md`](HTML-DOCUMENT-SPEC.md) — artifact interchange contract.
3. [`AGENT-BRIDGE.md`](AGENT-BRIDGE.md) or [`INTRANET-SHARING.md`](INTRANET-SHARING.md) — the relevant server boundary.
4. `app.js` or the corresponding Python service — implementation.
5. The matching test in `tests/` — observable behavior and regression guard.
