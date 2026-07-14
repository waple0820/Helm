# Helm Report Design Standard

## Why this exists

Helm preserves finished thinking, not just files. A retained HTML document should let a reader answer three questions without reopening the task that produced it:

1. What is the answer or decision?
2. What evidence earns that answer?
3. What should happen next, and what remains uncertain?

This is an editorial and information-design standard, not a prescribed visual theme. It takes the useful parts of a strong report studio — thesis-led reading, visible evidence, deliberate visual grammar, and calm density — and makes them portable for any standalone `HDOC/1.0` file.

## The reader path

Every Helm artifact needs a visible reading path. The first screen should establish the artifact's **kind**, **title**, **short answer or purpose**, and enough context to judge its freshness and scope. Do not make a reader scroll through background before learning why the document matters.

For a report or brief, use this sequence unless the subject gives a better reason not to:

1. **Question / decision** — what is being investigated or decided, for whom, and why now.
2. **Short answer** — the conclusion, recommendation, or current state in plain language.
3. **Evidence** — observations, data, sources, alternatives, or examples that materially support the answer.
4. **Interpretation** — what the evidence means; include trade-offs or counter-evidence where they change the conclusion.
5. **Action and boundary** — next step, owner or checkpoint when relevant; state assumptions, unknowns, and confidence.
6. **Method and sources** — dates, source links, collection method, and definitions needed to revisit the work.

Do not add ceremony for its own sake. A short note may compress the sequence; a deep dossier may repeat it in chapters. What must remain is answer-first orientation and a visible route back to evidence.

## Choose the right report shape

Use the document type to select a reader path, not merely a label.

| Type | The reader should get | Typical shape |
| --- | --- | --- |
| `report` | An answer to a question and the evidence behind it | Question → answer → evidence → interpretation → recommendation → sources |
| `brief` | A decision and the real trade-offs | Decision → options/comparison → recommendation → owner/checkpoint → risks |
| `reference` | A durable, reusable explanation | Pattern → when to use → how to apply → caveats → primary sources |
| `dashboard` | The current state plus how to read it | Headline findings → time range/definitions → measures → changes → data notes |
| `note` | A recoverable finding or handoff | Finding → context → supporting evidence → open question / next step |

## Visual evidence, not visual decoration

Visual treatment must reveal the relationship in the material. A strong Helm report is often read first through its figures: the reader should be able to locate the conclusion, the comparison, the boundary, or the change before reading every paragraph. This does **not** mean adding generic illustrations or turning every section into a card.

For a report, brief, dashboard, or operational handoff, inventory every material comparison, sequence, hierarchy, magnitude, composition, uncertainty, claim-strength distinction, case comparison, or action dependency before writing HTML. Place the smallest useful visual module near each claim it clarifies. A short report may need one; a benchmark dossier may need a sequence of complementary modules. Do not impose an arbitrary report-wide maximum that leaves important relationships prose-only.

| Reader needs to see | Use |
| --- | --- |
| Alternatives and trade-offs | Comparison table or matrix |
| Sequence, stages, or ownership | Timeline or flow |
| Relative magnitude or change | Small chart with units, range, and date |
| Hierarchy or system boundaries | Diagram or nested outline |
| Source quality and uncertainty | Evidence ledger with source, claim, date, and confidence |

Never use a chart, image, large number, or diagram as decoration. A factual visual needs a nearby title that says what it proves, readable labels, a unit or denominator and time range where relevant, and a source or method note. Keep the same information available as text or a table so the document remains understandable without the figure.

## The visual evidence contract

Each visual module must make one real relationship easier to understand. Before drawing it, write the sentence it needs to establish. Then use this compact contract:

1. **Claim title** — name the conclusion the reader should see, not the chart type. “Parallel recall reduced total time in this environment” is stronger than “Latency chart”.
2. **Relationship and labels** — show the compared entities, ordering, units, baseline, arrows, or boundaries directly in the visual. A reader should not need a color legend to decode the central relationship.
3. **Evidence state** — distinguish measured fact, verified implementation evidence, interpretation, proposal, and illustrative placeholder. Do not make a mock number or generated image look observed.
4. **Scope note** — place source, date, collection method, confidence, and limiting condition in the figure caption or immediately below it.
5. **Text fallback** — use a semantic `<figure>` with a `figcaption`, an adjacent table/list, or both. Inline SVG needs a title or an accessible text equivalent; no visual may be the only carrier of a consequential claim.

Use inline SVG or semantic HTML/CSS for diagrams and simple charts. They keep the artifact self-contained, printable, searchable, and legible at narrow widths. Do not require a runtime CDN, a canvas-only rendering, a remote image, or interaction to learn the core result.

Keep evidence navigation portable as well as visual. Do not link to sibling files with relative paths such as `../stage2/report.html`: Helm retains one HTML evidence original, not the source directory tree. Use an absolute, durable source URL, or bring the relevant finding and provenance into the artifact. Embed essential visual resources rather than referencing relative image, font, media, or stylesheet files.

## Visual grammar library

Use these patterns consistently rather than inventing a new decorative shape for every report:

| Relationship | Preferred visual | What must be explicit |
| --- | --- | --- |
| Decision and trade-off | Comparison matrix or highlighted option table | Common criteria, selected option, reason, reversal condition |
| Evidence to conclusion | Evidence route or claim ledger | Observation vs inference, confidence, source/date |
| Steps, ownership, or handoff | Flow or timeline | Verb-labelled transitions, owner, checkpoint or failure path |
| Hierarchy, scope, or architecture | Boundary diagram or nested tree | Containment/ownership, interfaces, excluded scope |
| Magnitude or before/after change | Bar, slope, or small multiple | Unit, denominator, baseline, time window, measurement condition |
| Composition or allocation | Stacked bar or labelled partition | Whole being partitioned and whether parts truly sum to it |
| Uncertainty or range | Interval/range plot with a plain-language readout | Meaning of interval, sample/run boundary, confidence or percentile |
| Headline measures | KPI strip | Unit, denominator, direction, time/environment, and why the measure matters |
| Comparable examples | Case ledger | Same fields, outcome state, evidence, and explicit failure boundary |
| Part-to-whole execution | Trace decomposition | A real total, non-overlapping parts, units, and measurement or illustrative state |
| Action and checkpoint | Roadmap rows | Evidence, owner, next action, metric/checkpoint, and reversal condition |

## Agent component contract

Helm components are an authoring API, not visual inspiration. Substantial agent-authored reports should start with `scripts/helm-report`, declare `manifest.presentation.profile`, and bind each planned relationship to a rendered component through `manifest.presentation.claims` and matching DOM attributes:

```html
<figure
  data-helm-component="range"
  data-helm-claim="C03"
  data-evidence-state="measured"
  data-source="Benchmark run 2026-07-14"
  data-scope="50 cases; one environment; milliseconds">
  ...
</figure>
```

The registered vocabulary is intentionally small: KPI strip, evidence ledger, comparison matrix, ranked bars, range, sequence, hierarchy, trace, case ledger, and roadmap. Extend it only when none of these grammars can explain the relationship without distortion. `scripts/helm-report check` verifies the declared Claim–component coverage and rejects unfinished placeholders before handoff.

Use a real screenshot only when the interface itself is evidence. Annotate version/date and sensitive-data treatment. Use generated imagery only for atmosphere or a clearly labelled conceptual metaphor — never as fabricated operational, product, or measurement evidence.

## Page and component language

- Use one strong title, a compact overline for type/date/status, and a direct summary. The title tells the subject; the summary tells the reader why it matters.
- Create hierarchy with typographic contrast, whitespace, rules, and grouping before adding cards, gradients, or shadows.
- Keep the reading column comfortable. Use a wider canvas only for comparison tables, diagrams, or evidence ledgers that require it.
- Use quiet neutral surfaces and one restrained accent to direct attention. Reserve loud color for a meaningful state such as risk, decision, or change.
- Put supporting metadata close to the claim it qualifies: source, data date, confidence, definition, or assumption. Do not hide essential context behind a hover or an interaction.
- Use cards only when they separate peers the reader may compare or scan. A page made of unrelated cards has no narrative.
- Interactions may filter, reveal method detail, or switch a view; they must not be required to understand the document's core conclusion or evidence.
- Prefer semantic sections, ordered headings, real tables and lists. A visual treatment should survive printing, export, reader mode, and a narrow viewport.

## Required content checks

Before delivering a document, ask:

1. Can a reader state the conclusion or purpose after the first screen?
2. Can they distinguish evidence from interpretation and recommendation?
3. Does every consequential factual claim have a source, date, assumption, or an explicit "unknown" label?
4. Does each table, chart, diagram, or metric answer a specific question that prose alone would answer less clearly?
5. Where the material contains a material comparison, sequence, hierarchy, magnitude, or uncertainty, is there at least one meaningful visual evidence module close to that claim?
6. Does each visual show its labels, units or boundaries, evidence state, and source/method without relying on a hover or interaction?
7. Is the next decision, action, or open question explicit rather than implied?
8. Would the page still read as a report if its visual polish were removed?

If any answer is no, fix the document structure before refining its skin.

## Minimum implementation rules

This standard supplements, but does not replace, [`HTML-DOCUMENT-SPEC.md`](HTML-DOCUMENT-SPEC.md). Continue to deliver one self-contained `HDOC/1.0` file with a manifest, duplicate `helm:*` metadata, one semantic `<main data-document-root>`, embedded essential CSS, and provenance.

Start a substantial artifact from the closest `scripts/helm-report` Profile rather than recreating the information architecture. The files in [`templates/`](../templates/) remain compact compatibility starters; the authoring kit is the canonical source for composable visual components and pre-handoff checks.

## Generator instruction

Give this instruction to an agent in addition to the HDOC contract:

> Design this as a Helm evidence report, not a landing page. Lead with the question and short answer; make the reader's path from evidence to interpretation to next action explicit. Where the material has a comparison, sequence, hierarchy, change, composition, or uncertainty, choose one to three visual evidence modules from the Helm visual grammar and make each carry a named conclusion. Use inline SVG or semantic HTML/CSS; include labels, units or boundaries, evidence state, source/method notes, and a text fallback. Put sources, dates, assumptions, and confidence beside the claims they qualify. Keep essential content visible without interaction, use calm reading-first typography and restrained color, and return one complete standalone HDOC/1.0 HTML document.
