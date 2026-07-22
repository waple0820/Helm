# Helm artifact handoff (for agents)

You are producing a durable HTML report for a person to read and keep. The
target is one **self-contained `HDOC/1.1` file** in Helm's cool-grey design
system, dropped into a local folder.

1. Read [`skill/SKILL.md`](skill/SKILL.md) for the workflow, and
   [`skill/design-system.md`](skill/design-system.md) before writing any HTML.
   Look at [`skill/components.html`](skill/components.html) for the rendered
   component vocabulary. Do not imitate the visual style from prose alone.
2. Inventory the claims first: label each material relationship (comparison,
   sequence, hierarchy, magnitude, composition, uncertainty, claim strength,
   action) and its evidence state, then bind each to the smallest component.
3. Scaffold and fill:

   ```bash
   bin/helm new "Decision-relevant title" --type report --source your-agent-name
   # edit $HELM_LIBRARY/<slug>/index.html — replace EVERY specimen,
   # remove every `placeholder`, delete unused components.
   bin/helm check $HELM_LIBRARY/<slug>/index.html   # must pass
   bin/helm index
   ```

Set `$HELM_LIBRARY` (or run `bin/helm init` once) so any agent knows the target
folder. No `bin/helm`? Copy `skill/template.html` and edit the inline
`application/helm+json` manifest by hand.

Produce one complete, answer-first document — not Markdown, not a fragment, not a
partial draft. Keep the manifest `id` stable when revising the same logical
artifact; use a new id for a different document. Do not add a dependency on a
host app, external script, remote asset, or network service. Do not reintroduce
sharing, publishing, or a server — the library is local and personal by design.
