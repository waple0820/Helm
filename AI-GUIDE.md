# HTML generation guide for agents and other projects

For Codex-style agents, begin with [`docs/CODEX-MEMORY.md`](docs/CODEX-MEMORY.md). It contains the repository-scoped context to inject when the host supports project memory, plus the deterministic handoff workflow when it does not.

Before generating any HTML intended for this repository, read [`docs/HTML-DOCUMENT-SPEC.md`](docs/HTML-DOCUMENT-SPEC.md) in full and comply with `HDOC/1.0`. Then read [`docs/REPORT-DESIGN-STANDARD.md`](docs/REPORT-DESIGN-STANDARD.md) and choose the report shape that fits the document type.

The output must be a complete standalone `.html` document — not Markdown, a component, or a code fragment. Include the Helm manifest, the duplicate `helm:*` metadata, semantic `<main data-document-root>`, embedded essential styles, and factual provenance. Put the current Codex/project workspace in the optional `manifest.project` object (`id` + recognizable `name`) so Helm can group the artifact at project level before type and tags. Use the templates in [`templates/`](templates/) as working examples.

Design direction: calm, evidence-forward report. The artifact should optimize for reading and later recovery, not landing-page conversion. Lead with the reader's question and the short answer; make the path through evidence, interpretation, and the next action or boundary explicit. When the reader needs to compare, trace a sequence, understand scope, see change, or judge uncertainty, choose one to three conclusion-led visual evidence modules from `docs/REPORT-DESIGN-STANDARD.md`. Use inline SVG or semantic HTML/CSS, not a runtime chart library or decorative image; each figure needs labels, evidence state, source/method or scope note, and a text/table fallback. Keep sources, data dates, assumptions, and confidence near the claims they qualify. Do not add dependencies on a host application, external scripts, authentication, or untrusted executable code.

## Report preflight

Before returning the file, verify that a reader can see the following without interaction:

1. The document type, title, date/status, and decision-relevant purpose.
2. The short answer, recommendation, or current finding before long background.
3. Evidence that supports the conclusion, distinguished from interpretation.
4. The action, owner/checkpoint, caveat, or open question that follows from the evidence.
5. Provenance for factual claims: source, date, method, assumption, or confidence as appropriate.
6. Every material relationship has the smallest useful visual treatment — comparison, evidence route, flow, boundary diagram, metric, or range — or an explicit reason it does not need one.

The shipped templates are the default starting point. Use `research-dossier.html` for an evidence-led answer, `decision-brief.html` for a choice and trade-off, `reference-note.html` for reusable knowledge, and `agent-handoff.html` for a reviewable result.

## Optional automatic handoff to Helm

For a fresh local clone, run [`scripts/helm-agent-bootstrap`](scripts/helm-agent-bootstrap) once. Then write the final `.html` file first and submit that exact file once with [`scripts/helm-submit`](scripts/helm-submit). Run the command from the target project root so the Bridge can attach that workspace to legacy files that do not yet declare `manifest.project`; use `--project-id` and `--project-name` when the working directory is not the target project. Do not send partial drafts. A successful Bridge response means the artifact is ready in the owner's **Agent inbox** for explicit review and import; it does not mean the browser library was changed.

Never expose the token in a generated artifact, repository, task log, or prompt. On `409 Conflict`, do not overwrite or silently alter the existing document ID. On `422`, fix the reported HDOC contract issue and resubmit the same intended artifact.
