# HTML generation guide for agents

Everything an agent needs is in [`skill/`](skill/). This file is the short
pointer; the skill is the standard.

- [`skill/SKILL.md`](skill/SKILL.md) — the authoring workflow, step by step.
- [`skill/design-system.md`](skill/design-system.md) — the cool-grey engineering
  identity: tokens, typography, three content widths, and the component grammar.
- [`skill/template.html`](skill/template.html) — the standalone scaffold with the
  full embedded CSS and an inline `HDOC/1.1` manifest.
- [`skill/components.html`](skill/components.html) — rendered specimens of every
  component.

## The contract in one screen

The output is a complete standalone `.html` document — not Markdown, a component,
or a fragment. It must contain:

- an inline manifest `<script type="application/helm+json">…</script>` with at
  least `id`, `title`, `type`;
- a semantic `<main data-document-root>`;
- embedded essential CSS — no external script, stylesheet, font, or remote image
  (embed images as `data:` URIs);
- provenance for factual claims kept next to the claim.

Design direction: a calm, evidence-forward report, optimized for reading and
later recovery — not landing-page conversion. Lead with the reader's question and
the short answer; make the path through evidence, interpretation, and the next
action or boundary explicit. Inventory the material claims, label each important
relationship, and bind it to the smallest registered component. Every component
needs a named claim, an evidence state, a source/method, a scope boundary, and a
text/table fallback.

Validate before you finish:

```bash
bin/helm check output.html   # or $HELM_LIBRARY/<slug>/index.html
```

Then place the file in the library and run `bin/helm index`. See
[`AGENTS.md`](AGENTS.md) for the handoff steps.
