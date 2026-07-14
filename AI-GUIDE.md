# HTML generation guide for agents and other projects

For Codex-style agents, begin with [`docs/CODEX-MEMORY.md`](docs/CODEX-MEMORY.md). It contains the repository-scoped context to inject when the host supports project memory, plus the deterministic handoff workflow when it does not.

Before generating any HTML intended for this repository, read [`docs/HTML-DOCUMENT-SPEC.md`](docs/HTML-DOCUMENT-SPEC.md) in full and comply with `HDOC/1.0`. Then read [`docs/REPORT-DESIGN-STANDARD.md`](docs/REPORT-DESIGN-STANDARD.md). Use [`scripts/helm-report`](scripts/helm-report) to select a report Profile and compose registered visual components instead of recreating a report from prose instructions.

The output must be a complete standalone `.html` document — not Markdown, a component, or a code fragment. Include the Helm manifest, the duplicate `helm:*` metadata, semantic `<main data-document-root>`, embedded essential styles, and factual provenance. Put the current Codex/project workspace in the optional `manifest.project` object (`id` + recognizable `name`) so Helm can group the artifact at project level before type and tags. Use the templates in [`templates/`](templates/) as working examples.

Design direction: calm, evidence-forward report. The artifact should optimize for reading and later recovery, not landing-page conversion. Lead with the reader's question and the short answer; make the path through evidence, interpretation, and the next action or boundary explicit. Before writing HTML, inventory the material claims and label each important relationship: comparison, sequence, hierarchy, magnitude, composition, uncertainty, claim strength, comparable cases, or action/checkpoint. Bind every relationship to the smallest registered component and declare that Claim–component mapping in `manifest.presentation.claims`. Use inline SVG or semantic HTML/CSS, not a runtime chart library or decorative image; each component needs a named claim, evidence state, source/method, scope boundary, and text/table fallback. Keep sources, data dates, assumptions, and confidence near the claims they qualify. Do not add dependencies on a host application, external scripts, authentication, or untrusted executable code.

## Agent authoring workflow

List the available Profiles and components:

```bash
scripts/helm-report list
```

Start from the closest Profile. Profiles supply a useful default composition; `--components` may replace it when the claim inventory requires another grammar.

```bash
scripts/helm-report new \
  --profile benchmark \
  --title "Decision-relevant title" \
  --id stable-artifact-id \
  --project-id project-workspace \
  --project-name "Project workspace" \
  --output output.html
```

Replace every outlined specimen with real content, update its `data-evidence-state`, `data-source`, and `data-scope`, and remove the `placeholder` class. Do not preserve a component whose underlying relationship is absent. Do not leave a material relationship prose-only merely because the Profile omitted it. Then run:

```bash
scripts/helm-report check output.html
```

The check must pass before `helm-submit`. The rendered component catalog is [`authoring/component-gallery.html`](authoring/component-gallery.html).

## Report preflight

Before returning the file, verify that a reader can see the following without interaction:

1. The document type, title, date/status, and decision-relevant purpose.
2. The short answer, recommendation, or current finding before long background.
3. Evidence that supports the conclusion, distinguished from interpretation.
4. The action, owner/checkpoint, caveat, or open question that follows from the evidence.
5. Provenance for factual claims: source, date, method, assumption, or confidence as appropriate.
6. Every material relationship has the smallest useful visual treatment — comparison, evidence route, flow, boundary diagram, metric, or range — or an explicit reason it does not need one.

The authoring CLI is the default starting point for substantial artifacts. The files in `templates/` remain compact examples and compatibility starters; use `research`, `benchmark`, `architecture`, `decision`, or `handoff` Profiles when the result needs deliberate visual evidence.

## Optional automatic handoff to Helm

For a fresh local clone, run [`scripts/helm-agent-bootstrap`](scripts/helm-agent-bootstrap) once. Then write the final `.html` file first and submit that exact file once with [`scripts/helm-submit`](scripts/helm-submit). Run the command from the target project root so the Bridge can attach that workspace to legacy files that do not yet declare `manifest.project`; use `--project-id` and `--project-name` when the working directory is not the target project. Do not send partial drafts. A successful Bridge response means the artifact is ready in the owner's **Agent inbox** for explicit review and import; it does not mean the browser library was changed.

Never expose the token in a generated artifact, repository, task log, or prompt. Reuse the manifest ID only for a revision of the same logical artifact; Helm appends distinct bytes as an immutable Revision and never overwrites the prior source. Use a new ID for a different document or explicit fork. On `422`, fix the reported HDOC contract issue and resubmit the same intended artifact.
