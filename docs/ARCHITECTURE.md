# Helm architecture

Helm is a static browser app plus one Python-stdlib CLI. Nothing runs a
database, a daemon, or the network. A document stays useful even with no tooling
present.

## System map

```text
agent / project
  └─ complete HDOC/1.1 HTML
       └─ write $HELM_LIBRARY/<slug>/index.html   (exact bytes, the record)
             └─ helm index ─▶ catalog.json
                   └─ gallery/ (static) ─▶ browse
```

## Three parts

| Part | Code | Responsibility |
| --- | --- | --- |
| Authoring | `skill/` | The `HDOC/1.1` contract, the cool-grey design system, the scaffold and rendered component vocabulary agents author against. |
| Library + CLI | `bin/helm` | Scaffold, validate, index. The library is a folder; `catalog.json` is derived, never authoritative. |
| Gallery | `gallery/` | A static page that reads `catalog.json` and links to originals. No server logic. |

## Invariants

1. **The filesystem is the library.** One folder per artifact, one `index.html`.
   The original bytes are the record; `catalog.json` is a derived index and can
   be rebuilt at any time with `helm index`.
2. **Artifacts are portable.** Each is a standalone `HDOC/1.1` file with a
   semantic root, embedded CSS, an inline manifest, and provenance. It needs
   nothing from Helm to be readable.
3. **Publishing is writing a file.** No inbox, no review gate, no publish state.
   The library is local and personal.
4. **No new runtime dependency.** Anything added must preserve the local-first,
   zero-dependency, durable-original guarantees. No framework build, server DB,
   or cloud.

## What was removed (and why)

The former sharing / publishing / intranet plane, the loopback Bridge inbox, the
IndexedDB browser library, folder-sync, archive-backup, and the Draft/Reviewed/
Published state machine were all removed. For a single-person, local library they
were ceremony without payoff: the filesystem is the library, and a person's own
files need no import gate.

## Reading order

1. [`README.md`](../README.md) — the whole model.
2. [`skill/SKILL.md`](../skill/SKILL.md) — authoring workflow.
3. [`skill/design-system.md`](../skill/design-system.md) — the visual standard.
4. [`HDOC-SPEC.md`](HDOC-SPEC.md) — the file contract `helm check` enforces.
5. `bin/helm` — the implementation.
