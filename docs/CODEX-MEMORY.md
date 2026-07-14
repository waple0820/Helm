---
kind: codex-project-memory
schema_version: 1
scope: repository
---

# Helm project memory seed

This is the small, durable context a coding agent should load when it first enters a clone of Helm. It is deliberately repository-scoped: it describes this product and must not overwrite a person's unrelated global preferences or secrets.

## Agent installation rule

1. Read this file, [`AI-GUIDE.md`](../AI-GUIDE.md), the full [`HTML-DOCUMENT-SPEC.md`](HTML-DOCUMENT-SPEC.md), and [`REPORT-DESIGN-STANDARD.md`](REPORT-DESIGN-STANDARD.md) before creating a retained HTML artifact.
2. If the agent platform supports persistent **project** memory, store the payload below as one note scoped to this repository. If it does not, keep this file as the source of truth and reread it at the start of each task.
3. Never store a Bridge token, credentials, private artifact content, or machine-specific address in that memory note.

## Memory payload

> Helm is a local-first personal archive for durable AI-authored HTML, not a generic file explorer. Treat every retained HTML output as an evidence original with stable identity, title, provenance, readable semantic structure, and future retrieval value. The authoritative interchange contract is `HDOC/1.0` in `docs/HTML-DOCUMENT-SPEC.md`; reuse `templates/` and follow `AI-GUIDE.md` rather than inventing a parallel format. Helm's first organization level is the Codex/project workspace: write the optional `manifest.project` as `{ "id": "stable-workspace-id", "name": "Workspace name" }`, using the project identity rather than a tag or local machine path. Use `docs/REPORT-DESIGN-STANDARD.md` as the editorial bar: lead with the question and short answer, make the route from evidence to interpretation to decision or next action visible, and choose one to three visual evidence modules whenever a real comparison, sequence, hierarchy, magnitude, change, composition, or uncertainty needs to be understood. A visual must carry a named conclusion, direct labels and boundaries, evidence state, scope/source or method note, and a nearby text or table fallback; use inline SVG or semantic HTML/CSS, never decorative chart wallpaper or a remote runtime dependency. Keep sources, dates, assumptions, and confidence beside the claims they qualify. A completed artifact must be one standalone UTF-8 HTML file with embedded essential CSS, one `<main data-document-root>`, one `h1`, duplicate `helm:*` metadata, and exactly one valid `data-helm-manifest`. Do not send Markdown fragments, partial drafts, executable scripts, inline event handlers, secrets, or external application dependencies. If the artifact is intended for Helm, validate it locally, then submit the exact final file once from the target project root with `scripts/helm-submit output.html --source "agent-name"`; the Bridge uses that workspace as a catalog fallback if the source has no project declaration. Helm Bridge validates and preserves the source but only puts it in the owner's inbox; a person explicitly imports it into browser storage. Publishing is a separate, explicit owner action: a validated artifact may be copied byte-for-byte to immutable, content-addressed intranet storage, while network visitors receive read-only access and never gain access to the browser library. Never overwrite a stable manifest ID: exact retries are idempotent, while different bytes under an existing ID require a genuinely new artifact identity. The visual and writing style is calm, evidence-forward, provenance-aware, answer-first, and optimized for later reading rather than landing-page polish.

## Clone-to-handoff workflow

Run this once on the machine that owns the browser library:

```bash
scripts/helm-agent-bootstrap --agent-name codex
```

The command starts a loopback-only Bridge if needed and writes the local, owner-only runtime configuration used by `scripts/helm-submit`. It does not contact a cloud service or expose a public port.

For each artifact intended for the archive:

```bash
scripts/helm-submit output.html --source "codex"
```

Then open Helm and review **Agent inbox**. Submission is a handoff, not a hidden browser-library write.

## What this can and cannot guarantee

`AGENTS.md` makes this workflow visible to compatible coding agents when they open the clone. This document gives every session a deterministic context-refresh path. A repository cannot force every vendor's Codex installation to write into its provider-managed global long-term memory; the provider must expose that capability. The repository therefore remains correct even without it: the checked-in memory seed plus `AGENTS.md` are the durable, reviewable source of truth.
