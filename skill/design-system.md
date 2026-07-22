# Helm design system — cool-grey engineering

A living standard for Helm artifacts. It is not a skin you drop over prose; it is
an editorial method that turns analysis into something **credible, readable, and
recoverable**. The visual identity is deliberately distinct: a cool neutral
ground, a single cyan signal, sans body with monospace metadata, strict column
rules — an instrument panel, not a landing page.

> Core rule: visual form must earn its place by making one important relationship
> legible faster than plain text would. If a chart, table, or card only repeats a
> paragraph, delete it.

## Four principles

1. **Conclusion first.** The hero states a bounded claim; the body then unfolds
   evidence, mechanism, and counter-cases. Avoid using "deep dive" as a
   substitute for an actual answer.
2. **Layered evidence.** Fact, measurement, interpretation, and proposal must be
   distinguishable in tone and in colour. Never render an inferred claim as a
   source fact.
3. **Visualize relationships only.** Reach for a graphic only when hierarchy,
   flow, comparison, magnitude, composition, or uncertainty needs to be *seen*.
4. **Progressive enhancement.** The full narrative survives with no JavaScript,
   in dark mode, with reduced motion, and at phone width.

Selection formula: **reader's question → relationship type → evidence form →
smallest sufficient component.**

## Tokens

Semantic tokens are the fixed skeleton; a theme may vary surface and accent, never
the meaning. Light and dark are both first-class — every artifact ships both.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--paper` | `#f7f8f9` | `#0f1115` | page ground |
| `--raised` | `#ffffff` | `#16191e` | cards, tables, figures |
| `--ink` | `#14171a` | `#e7e9ec` | primary text |
| `--muted` | `#61666d` | `#9198a0` | secondary text |
| `--faint` | `#8b9098` | `#6b727a` | mono labels, metadata |
| `--line` / `--line-strong` | `#e3e5e8` / `#cfd2d6` | `#24272d` / `#31353c` | hairlines, borders |
| `--accent` / `--accent-ink` | `#0e8ba8` / `#0b6f86` | `#28b6d4` / `#5cc9e2` | the single cyan signal |
| `--ok` / `--warn` | `#1f8a5b` / `#b5751a` | `#3fbf85` / `#d6a04a` | verified / caution states |

One accent only. If a section wants a new colour, it wants a new relationship
instead — express that with a component, not a hue.

## Typography

- **Sans body, mono metadata. No serif.** (This is the deliberate break from a
  warm editorial-serif look.) Body: `Inter, system-ui, "PingFang SC", …`.
  Metadata / labels / metrics / code: `ui-monospace, "SF Mono", "JetBrains Mono"`.
- Mono labels are uppercase with `.08–.14em` tracking. They name sections
  (`00 / THESIS`), carry units, and read metric values.
- Heading weight, not colour, sets hierarchy. Default hero weight ~680; keep
  contrast high. Never set Chinese text in all-caps.

## Three content widths

| Width | Token | Use |
| --- | --- | --- |
| Reading · 44rem | `--read` | continuous prose, the argument |
| Content · 72rem | `--content` | tables, figures, mixed layout |
| Stage · 90rem | `--stage` | the top bar and full-bleed chrome |

Do not set every block to the same width. Prose stays narrow; evidence widens.

## Rhythm

- A faint horizontal grid (`--grid`, 2.5rem) runs behind the page — the
  instrument-panel texture. It drops on mobile.
- Sections open with a mono marker: a short cyan tick, the number, the kind.
- Hairline rules (`--line`) separate sections and table rows; borders are 1px,
  never heavy. Whitespace does the separating work.

## Component vocabulary

Each component binds one relationship. See `components.html` for rendered
specimens. Bind the smallest one that carries the claim; delete any whose
relationship is absent.

| Component | Relationship | Use when | Avoid |
| --- | --- | --- | --- |
| **Thesis hero** | the bounded conclusion | every artifact opens with one | a slogan with no boundary |
| **Metastrip** | headline metrics at a glance | 3–5 numbers frame the answer | dumping every number here |
| **Evidence ledger** | claims are not equal | verified / interpretation / proposal coexist | a card grid with no state |
| **Bar figure** | magnitude / comparison | one comparison on a shared scale | no unit, no baseline, truncated axis |
| **Spec block** | the field/param names *are* the contract | an interface or command is itself evidence | decorative code |
| **Boundary columns** | changes vs open questions | separating promise from reality | one card per sentence |

Charts: prefer inline SVG or semantic HTML/CSS over any runtime chart library.
Every figure carries a one-line, readable conclusion and keeps object, unit,
sample bound, and measurement condition attached to the number.

## Evidence states

| State | Class | Meaning |
| --- | --- | --- |
| verified | `.state.verified` | supported by a cited source + method |
| interpretation | `.state.interp` | your reading; explicitly not a source quote |
| proposal | `.state.proposal` | not yet landed / not yet verified |

Use them anywhere a claim's strength matters — the ledger, inline, a metastrip
cell — so a reader never mistakes an inference for a measurement.
