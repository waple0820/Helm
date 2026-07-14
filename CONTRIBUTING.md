# Contributing to Helm

Thank you for improving Helm. The project is small by design, so a focused change with a clear contract is more valuable than a broad refactor.

## Before you start

1. Read [`README.md`](README.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
2. For retained HTML or agent workflows, read [`AGENTS.md`](AGENTS.md), [`AI-GUIDE.md`](AI-GUIDE.md), and the full [`docs/HTML-DOCUMENT-SPEC.md`](docs/HTML-DOCUMENT-SPEC.md).
3. Keep the original HTML immutable. Catalog metadata is an overlay; it is never a silent source-file rewrite.

## Local verification

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 helm_share_server.py --host 127.0.0.1 --port 4173
```

Open the local app and, when a change affects HTML validity or repair behavior, visit `/tests/contract-smoke.html` and `/tests/repair-smoke.html`. Both should show `passed`.

## Pull-request expectations

- Explain the user-visible outcome and the preserved invariant.
- Keep unrelated formatting and generated artifacts out of the change.
- Add or update a focused regression test for behavioral changes.
- Do not commit Bridge tokens, browser IndexedDB data, private artifacts, machine addresses, or generated local reports.
- Do not add remote scripts, runtime CDNs, or executable HTML to a retained artifact without a documented and reviewed reason.

## Design bar

Helm is a calm, evidence-forward research workbench, not a generic file manager or marketing page. Visuals must clarify a real comparison, flow, boundary, or uncertainty; they must not be decoration. See [`docs/REPORT-DESIGN-STANDARD.md`](docs/REPORT-DESIGN-STANDARD.md).

## Reporting a security issue

Do not include credentials or private artifacts in a public issue. For a vulnerability that could expose a local library, Bridge token, or shared document, use GitHub's private vulnerability-reporting channel when it is available; otherwise contact the repository owner privately before publishing technical details.
