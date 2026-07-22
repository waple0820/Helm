# Contributing to Helm

Thank you for improving Helm. The project is small by design, so a focused change with a clear contract is more valuable than a broad refactor.

## Before you start

1. Read [`README.md`](README.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
2. For the artifact contract and agent workflow, read [`AGENTS.md`](AGENTS.md), [`AI-GUIDE.md`](AI-GUIDE.md), [`docs/HDOC-SPEC.md`](docs/HDOC-SPEC.md), and the authoring standard in [`skill/`](skill/).
3. Keep artifacts local and personal. The library is the filesystem; this repo never carries generated artifacts.

## Local verification

```bash
python3 -m unittest discover -s tests -p 'test_*.py'   # CLI + HDOC contract
bin/helm check <file>                                  # validate one artifact
bin/helm serve --port 4180                             # http://127.0.0.1:4180/gallery/
```

## Pull-request expectations

- Explain the user-visible outcome and the preserved invariant.
- Keep unrelated formatting and generated artifacts out of the change.
- Add or update a focused regression test for behavioral changes.
- **Never commit a generated artifact.** Library files and root-level report HTML are gitignored precisely because they may contain internal or confidential content and this repo is public.
- Do not add remote scripts, runtime CDNs, external fonts, or executable HTML to an artifact — `helm check` enforces self-containment.
- Preserve the local-first, zero-dependency guarantee. No framework build, server database, or cloud dependency.

## Design bar

Helm is a calm, evidence-forward research workbench, not a generic file manager or marketing page. Visuals must clarify a real comparison, flow, boundary, or uncertainty; they must not be decoration. See [`skill/design-system.md`](skill/design-system.md).

## Reporting a security issue

Do not include credentials or private artifacts in a public issue. For a vulnerability that could expose a local library or a private document, use GitHub's private vulnerability-reporting channel when it is available; otherwise contact the repository owner privately before publishing technical details.
