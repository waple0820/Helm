# Helm HTML Document Contract

**Specification:** `HDOC/1.0`
**Status:** stable local-first format
**Purpose:** make AI-authored HTML a portable personal knowledge artifact, not an anonymous page.

Any project, agent, or person that generates an HTML artifact for the Helm library must follow this document. The result must work as a standalone `.html` file and remain intelligible when copied outside Helm. Helm organizes its local catalog first by **project workspace**, then by document type and tags; declare the workspace when it is known.

## The contract

1. Deliver one complete HTML document — beginning with `<!doctype html>` — with all essential styling inline or embedded in the file.
2. Put the document's meaningful content inside one `<main data-document-root>` element.
3. Include a valid JSON manifest in `<script type="application/json" data-helm-manifest>`.
4. Use semantic HTML: one `h1`, ordered headings, real lists and tables, descriptive links, and no text encoded only in images.
5. State sources, data dates, assumptions, and confidence wherever factual claims would otherwise become untraceable.
6. Follow [`REPORT-DESIGN-STANDARD.md`](REPORT-DESIGN-STANDARD.md): use a calm, evidence-forward, answer-first report system with generous whitespace, useful hierarchy, quiet neutral surfaces, restrained accent color, and data clarity over dashboard decoration. When a comparison, sequence, hierarchy, magnitude, change, composition, or uncertainty is material, include one or more meaningful visual evidence modules selected from the visual grammar. A reader must be able to find the purpose or short answer, the supporting evidence, and the resulting action or boundary without relying on interaction.
7. Do not depend on a host app for fonts, scripts, navigation, APIs, authentication, or core content. Remote images and fonts may be used only as progressive enhancement; a document must still be meaningful without them. Relative file references such as `../stage2/report.html` or `./chart.png` are non-portable because sibling files do not travel with one standalone artifact. Embed essential resources and use absolute URLs for external destinations.
8. Treat user-supplied or third-party HTML as untrusted. Helm previews it in a sandbox, and authors should avoid scripts unless there is a clear, documented reason.

## Report presentation standard

`HDOC/1.0` keeps a file portable; the Report Design Standard keeps it useful when someone reads it later. This is a semantic requirement rather than a rigid page layout.

- Make the reader's path visible: **question or decision → short answer → evidence → interpretation → action, boundary, or open question → sources/method**. A concise note may compress this sequence; a report may deepen it.
- Use the declared `type` to choose the shape: a report answers a question, a brief compares a decision, a reference explains reuse, a dashboard explains the current state and its measures, and a note preserves a finding or handoff.
- Use a comparison table for alternatives, an evidence route or ledger for claim strength, a timeline or flow for sequence, a diagram for hierarchy, and a labeled chart for magnitude or change. Give every figure a conclusion-led caption, labels/units or boundaries, an evidence state, source or method note, and an adjacent text/table fallback. Do not use visual components as page decoration.
- Put source, data date, method, assumption, or confidence close to a consequential claim. Images and charts must not be the only carrier of essential information.
- Do not hide a conclusion, evidence, or caveat behind an interaction. Interactions may clarify or filter; the standalone file must remain readable when printed, exported, or viewed narrowly.

See [`REPORT-DESIGN-STANDARD.md`](REPORT-DESIGN-STANDARD.md) for type-specific outlines, component guidance, and the delivery self-review.

## Required manifest

```html
<script type="application/json" data-helm-manifest>
{
  "schema_version": "HDOC/1.0",
  "id": "short-stable-document-id",
  "title": "A clear document title",
  "type": "report",
  "tags": ["research", "active"],
  "summary": "One sentence explaining the artifact's decision-relevant value.",
  "created_at": "2026-07-13T00:00:00Z",
  "updated_at": "2026-07-13T00:00:00Z",
  "project": {
    "id": "short-project-workspace-id",
    "name": "Recognizable project workspace name"
  },
  "provenance": {
    "author": "person, project, or agent name",
    "sources": [
      { "label": "Source title", "url": "https://example.com", "accessed_at": "2026-07-13" }
    ]
  }
}
</script>
```

### Field rules

| Field | Rule |
| --- | --- |
| `schema_version` | Exactly `HDOC/1.0`. |
| `id` | Stable, lowercase identifier. Do not use a random ID when revising an existing artifact. |
| `title` | Human-readable; 100 characters or fewer. |
| `type` | One of `report`, `brief`, `reference`, `dashboard`, or `note`. |
| `tags` | 0–8 concise lowercase tags. |
| `summary` | A decisive 240-character-or-fewer description, not a generic subtitle. |
| timestamps | ISO 8601 in UTC. Update `updated_at` on meaningful revisions. |
| `project` | Optional but strongly recommended for agent output. `{ "id": "stable-workspace-id", "name": "Workspace name" }`; use the Codex/project workspace, not a topic tag or a personal machine path. The Bridge can attach the current submitter workspace as catalog metadata when the original file has no declaration. |
| `provenance.sources` | Include sources used for claims. Use `[]` if the artifact is original writing without external sources. |

## Required HTML metadata

These duplicate the core manifest fields so a simple file indexer can inspect the document without parsing JSON:

```html
<meta name="helm:title" content="A clear document title">
<meta name="helm:type" content="report">
<meta name="helm:summary" content="One decisive sentence.">
<meta name="helm:tags" content="research, active">
```

## Links and embedded resources

- Fragment links such as `#evidence`, absolute web/source URLs, and purpose-specific schemes such as `mailto:` and `tel:` are valid navigation targets.
- A relative `href` points into the author's original folder layout, which Helm does not import. Replace it with an absolute URL, or preserve the referenced evidence inside the artifact.
- Essential images, audio, video, fonts, and CSS must be embedded, normally with inline markup/CSS or a `data:` URL. A relative `src` or CSS `url(...)` violates the standalone portability expectation and is reported by validation.
- A remote media or CSS resource is a progressive enhancement, not part of the retained evidence original. Helm reports it as a portability warning, so a document that relies on it does not receive a 100-point validation score.

## Reference skeleton

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="helm:title" content="Title">
    <meta name="helm:type" content="brief">
    <meta name="helm:summary" content="One decisive sentence.">
    <meta name="helm:tags" content="decision, active">
    <title>Title</title>
    <style>/* essential styles live in this file */</style>
    <!-- data-helm-manifest goes here -->
  </head>
  <body>
    <main data-document-root>
      <header>
        <p>BRIEF · 2026-07-13</p>
        <h1>Title</h1>
        <p>Summary.</p>
      </header>
      <section><h2>Context</h2><p>…</p></section>
      <section><h2>Evidence</h2><p>…</p></section>
      <section><h2>Recommendation</h2><p>…</p></section>
    </main>
  </body>
</html>
```

## Generator instruction

Give this exact instruction to another project or AI before it produces an artifact:

> Generate a complete, standalone HTML document compliant with `docs/HTML-DOCUMENT-SPEC.md` (HDOC/1.0) and `docs/REPORT-DESIGN-STANDARD.md`. Return only the `.html` source. Preserve the Helm manifest, semantic `<main data-document-root>`, evidence/provenance, and embedded essential CSS. Declare `manifest.project` with the stable Codex/project workspace ID and its human-readable name. Use an answer-first, calm, evidence-forward report presentation: establish the question and short answer early, make the route from evidence to interpretation to next action visible, and keep factual context beside the claims it qualifies. Where a relationship must be understood, use a conclusion-led visual evidence module with labels, scope/evidence notes, and text fallback rather than decorative imagery.

## Non-goals in v1

- This is not an execution environment for arbitrary HTML or JavaScript.
- It does not replace a multi-user document system or cloud sync.
- It does not prescribe a single visual style; it prescribes legibility, portability, metadata, and evidence.
