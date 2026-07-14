# Helm artifact handoff

Start by reading [`docs/CODEX-MEMORY.md`](docs/CODEX-MEMORY.md). If the current agent platform offers repository-scoped persistent memory, inject its **Memory payload** at that scope; otherwise reread the checked-in file at the start of each task. Do not put tokens, credentials, private artifacts, or machine addresses into project memory.

For any AI-generated HTML that is meant to be retained, read [`AI-GUIDE.md`](AI-GUIDE.md), [`docs/REPORT-DESIGN-STANDARD.md`](docs/REPORT-DESIGN-STANDARD.md), and the full [`docs/HTML-DOCUMENT-SPEC.md`](docs/HTML-DOCUMENT-SPEC.md) before writing it. Produce one complete, self-contained `HDOC/1.0` file; do not submit Markdown fragments, partial drafts, or executable HTML. The report must be answer-first: make the route from question or decision to evidence, interpretation, and next action or boundary visible rather than producing a landing-page-style document.

For a local clone, run this once before the first handoff:

```bash
scripts/helm-agent-bootstrap --agent-name "your-agent-name"
```

Then submit the final file exactly once after local validation:

```bash
scripts/helm-submit output.html --source "your-agent-name"
```

Run the submission from the target Codex/project root. Helm records that workspace as the artifact's catalog project when the source manifest does not already declare `project`; if needed, pass `--project-id` and `--project-name` explicitly. The command only hands the artifact revision to the owner's inbox. It does not grant direct access to the browser library. Keep the same manifest ID when revising the same logical artifact; Helm preserves distinct bytes as immutable revisions and asks the owner before advancing the current version. Use a new ID for a different document or explicit fork. On `422`, correct the HDOC contract violation before resubmitting.
