# Helm Channels

Channels is Helm's first revision model. It separates the thing a reader follows from the immutable HTML evidence that produced each version.

## Model

- **Artifact** — stable logical identity, catalog metadata, project, workflow status, current Revision, published Revision, and optional Fork origin.
- **Revision** — immutable HTML bytes addressed by SHA-256, with authoring time, validation evidence, parent Revision, and optional publication metadata.
- **Channel** — the Artifact's stable read-only intranet address. Publishing advances it with compare-and-swap; it never rewrites an immutable Revision address.

The browser database stores Artifacts and Revisions in separate IndexedDB stores. Upgrading from the legacy document store is automatic and non-destructive.

## Workflow

```text
Draft revision -> Reviewed -> Published stable address
       |                         |
       +-> new revision ---------+-> explicit publish advances Channel
       +-> Fork creates a new Artifact with recorded origin
```

A new Revision after publication returns the Artifact to Draft while leaving the last published Revision identifiable. Catalog-only edits do not create Revisions. A Fork begins with the exact source bytes for provenance; before it can own a separate Channel, its author must create a new valid HDOC Revision whose embedded manifest ID matches the Fork Artifact ID. Helm blocks publication while those identities differ.

## Addresses

- `/a/<artifact-id>` is the stable Channel address.
- `/r/<sha256>.html` is an immutable Revision address.

`POST /api/channels/publish` accepts the exact HDOC HTML plus an optional `base_revision_sha256`. A stale base returns `409` instead of silently replacing a newer publication. `POST /api/channels/artifacts/<id>/revoke` removes the stable address; immutable Revision files remain evidence originals.

## Backup compatibility

`HARC/1.0` remains readable. Helm carries Channel fields and the Revision graph through `metadata.extensions`; a clean-library recovery recreates immutable Revisions, their shares, current head, published head, status, and Fork origin. Existing-ID imports remain non-destructive and require an explicit product decision.

## Phase-one boundary

This phase is single-owner and local-first. It does not add collaborative editing, remote identity, automatic sync, merge semantics, or access-control lists. Those need a separate trust and conflict model.
