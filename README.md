# Helm

<p align="center"><strong>A local-first artifact library for HTML that AI agents produce — for one person to read and keep.</strong></p>

Helm does two things well:

- **Ease of use** — any coding agent (Claude Code, Codex, anything) hands off a
  finished report by *writing one file*. No token, no daemon, no review inbox.
- **Professionalism** — a built-in authoring skill produces self-contained
  `HDOC/1.1` HTML in a distinct cool-grey engineering design system, so the
  output actually looks and reads like a report.

There is no sharing, publishing, cloud, or build step. The library is a folder.
A static gallery reads it back.

## The whole model

```text
agent  ──writes──▶  $HELM_LIBRARY/<slug>/index.html   (standalone HDOC/1.1)
                          │
                     helm index  ──▶  catalog.json
                          │
                     gallery/  ──▶  static browse (python http, no logic)
```

- **The library is the filesystem.** One folder per artifact, one `index.html`
  inside. The original bytes are the record.
- **Publishing = writing a file + reindexing.** Nothing gates it.
- **Every artifact is portable.** Self-contained HTML, embedded CSS, inline
  manifest, light/dark, no dependency on Helm to be readable.

## Start in one minute

```bash
git clone https://github.com/waple0820/Helm.git
cd Helm
bin/helm init                 # set the library path + install the skill
bin/helm serve                # http://127.0.0.1:4173/gallery/
```

## Hand an artifact to Helm

From any agent, once the analysis is done:

```bash
bin/helm new "Decision-relevant title" --type decision --source claude-code
# → edit $HELM_LIBRARY/<slug>/index.html: replace every specimen
bin/helm check $HELM_LIBRARY/<slug>/index.html   # HDOC contract must pass
bin/helm index                                   # rebuild catalog.json
```

The authoring standard the agent follows lives in [`skill/`](skill/):
[`SKILL.md`](skill/SKILL.md) (workflow), [`design-system.md`](skill/design-system.md)
(the cool-grey identity + component grammar), and
[`components.html`](skill/components.html) (rendered vocabulary).

## CLI

| Command | Does |
| --- | --- |
| `helm init` | set the library path, install the skill into detected agents |
| `helm new <title>` | scaffold a standalone HDOC artifact into the library |
| `helm index` | rescan the library, rebuild `catalog.json` |
| `helm serve` | static HTTP for the gallery + library |
| `helm check <file>` | validate the HDOC/1.1 contract |

Python standard library only. No dependencies.

## Layout

```text
bin/helm            the CLI (one file)
skill/              authoring skill: SKILL.md, design-system.md, template.html, components.html
gallery/            static browser (reads library/catalog.json)
library/            the library — one folder per artifact + catalog.json
docs/               ARCHITECTURE.md, HDOC-SPEC.md
```

MIT. Local-first, personal, no cloud.
