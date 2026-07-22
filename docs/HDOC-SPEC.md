# HDOC/1.1 — the artifact contract

An HDOC artifact is one self-contained HTML file that carries both a
human-readable report and a machine-readable manifest. `bin/helm check` enforces
the hard rules below.

## Required

1. **Inline manifest.** Exactly one
   `<script type="application/helm+json">…</script>` containing valid JSON with
   at least:

   ```json
   {
     "schema": "HDOC/1.1",
     "id": "stable-slug",
     "title": "Decision-relevant title",
     "type": "report"
   }
   ```

   `type` ∈ `report`, `brief`, `reference`, `dashboard`, `decision`, `research`,
   `benchmark`, `note`. Optional: `summary`, `tags` (array), `source`, `created`,
   `updated` (ISO date). The manifest must match the visible document.

2. **Semantic root.** A `<main>` element (`<main data-document-root>` by
   convention) wrapping the document body.

3. **Self-contained.** No external `<script src>`, no external stylesheet
   `<link rel="stylesheet">`, no CSS `@import`. Embed all CSS inline; embed
   images as `data:` URIs. A remote `src="http…"` is flagged as a durability
   warning.

4. **No leftover specimens.** No `placeholder` class and no unreplaced
   `{{TITLE}}`-style tokens remain.

## Identity and revisions

- The manifest `id` identifies the logical artifact. Reuse it to revise the same
  document (overwrite the file); use a new id for a different artifact.
- The library stores one file per artifact at `<slug>/index.html`. There is no
  automatic revision history — this is a personal library; use Git if you want
  history.

## The index

`helm index` scans `<library>/*/index.html`, reads each manifest, and writes
`<library>/catalog.json`:

```json
{
  "schema": "HDOC/1.1",
  "generated": "2026-07-22",
  "count": 1,
  "artifacts": [
    { "id": "…", "slug": "…", "title": "…", "type": "…", "summary": "…",
      "tags": [], "source": "…", "created": "…", "updated": "…",
      "path": "slug/index.html", "bytes": 14604 }
  ]
}
```

Files without a manifest are skipped and reported. `catalog.json` is derived and
disposable — rebuild it any time.
