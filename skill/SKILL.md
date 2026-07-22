---
name: helm-report
description: >
  Author a professional, self-contained HDOC/1.1 HTML artifact (report, brief,
  reference, dashboard, decision, research, benchmark) in Helm's cool-grey
  engineering design system, then drop it into the local Helm library. Use
  whenever a coding agent (Claude Code, Codex, or any other) is asked to produce
  a durable HTML report/brief/dashboard for a person to read and keep — NOT for
  throwaway answers or Markdown fragments.
---

# Helm report authoring

Helm turns an agent's finished analysis into one **standalone HTML file** that a
person reads and keeps. The library is a plain folder; publishing this artifact
means writing one file and rebuilding an index. There is no server to call, no
token, no review inbox.

## What "done" looks like

- One complete `.html` file — no external script, stylesheet, font, or image.
- An inline `HDOC/1.1` manifest that matches the visible document.
- Answer-first: the reader sees the bounded conclusion before the background.
- Every material relationship rendered with the smallest useful component, in
  the cool-grey identity defined in `design-system.md`.
- `bin/helm check` passes; the file lives at `$HELM_LIBRARY/<slug>/index.html`.

Read [`design-system.md`](design-system.md) before writing HTML, and open
[`components.html`](components.html) to see the rendered component vocabulary.
Never imitate the visual style from prose alone.

## Workflow

### 1 — Inventory the claims first, not the layout

Before any HTML, list the material claims the report must carry. For each, label
the relationship it expresses and its evidence state:

| Relationship | Component | Evidence state |
| --- | --- | --- |
| the bounded conclusion | Thesis hero | — |
| headline metrics | Metastrip | verified / interpretation |
| claims are not equal | Evidence ledger | verified / interpretation / proposal |
| magnitude / comparison | Bar figure | measured with unit + baseline |
| the interface *is* the evidence | Spec block | verified |
| changes vs open questions | Boundary columns | mixed |

Facts, measurements, your interpretation, and unlanded proposals must stay
visually and tonally distinct. Do not write an inferred claim as a source fact.

### 2 — Scaffold

```bash
bin/helm new "Decision-relevant title" \
  --type decision \
  --id stable-slug \
  --summary "one-line answer" \
  --tags "topic,area" \
  --source your-agent-name
```

This copies `template.html` into `$HELM_LIBRARY/<slug>/index.html` with the
manifest filled. (No `bin/helm`? Copy `skill/template.html` yourself and edit the
`application/helm+json` block by hand.)

### 3 — Fill, bind, prune

- Replace **every** specimen. Remove each `placeholder` class as you go.
- Bind each inventoried relationship to the smallest component. Set each row's
  evidence state honestly.
- **Delete any component whose relationship is absent** — an empty chart or an
  unused ledger is worse than none.
- **Do not leave a real relationship prose-only** just because the template
  omitted it. Add the component from `components.html`.
- Keep sources, dates, units, sample bounds, and confidence next to the claim
  they qualify. A number without its denominator and conditions is a liability.

### 4 — Check, place, index

```bash
bin/helm check $HELM_LIBRARY/<slug>/index.html   # must pass
bin/helm index                                   # rebuild catalog.json
```

`check` fails on: missing/invalid manifest, no `<main>`, leftover placeholders,
or any external dependency. Fix the contract, do not weaken it.

## Report preflight

A reader must see, without interacting:

1. Document type, title, date, and decision-relevant purpose.
2. The short answer or current finding, before long background.
3. Evidence that supports the conclusion, distinguished from interpretation.
4. The action, checkpoint, caveat, or open question that follows.
5. Provenance for factual claims: source, date, method, or confidence.
6. Every material relationship given the smallest useful visual treatment — or
   an explicit reason it needs none.

## Boundaries

- No dependency on a host app, external script, auth, or remote asset. Embed
  images as `data:` URIs.
- Reuse the manifest `id` only to revise the same logical artifact; use a new id
  for a different document.
- Do not reintroduce sharing, publishing, or a server. The library is local and
  personal by design.
