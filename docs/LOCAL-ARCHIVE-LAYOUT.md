# Helm portable archive format

`archive-backup.js` exports and imports a portable JSON file for moving a Helm library between browser profiles or keeping an independent backup. It is deliberately separate from the browser database: an importer returns a plan, and the calling application decides what to persist.

## `HARC/1.0`

```json
{
  "format": "helm-archive",
  "schema_version": "HARC/1.0",
  "exported_at": "2026-07-13T12:00:00.000Z",
  "document_count": 1,
  "documents": [
    {
      "id": "decision-brief-q3",
      "metadata": {
        "title": "Q3 decision brief",
        "type": "brief",
        "tags": ["decision", "active"],
        "summary": "The context and recommendation for the Q3 decision.",
        "source": "Planning agent",
        "project": { "id": "planning", "name": "Planning workspace" },
        "created_at": "2026-07-01T08:00:00.000Z",
        "updated_at": "2026-07-13T11:30:00.000Z"
      },
      "html": "<!doctype html>..."
    }
  ]
}
```

The original HTML is stored verbatim in `html`; its embedded HDOC manifest remains part of that source. Archive metadata mirrors Helm's **catalog record** using snake-case timestamp keys. All timestamps are required ISO 8601 values and are copied without changing their original value.

Helm deliberately keeps a catalog overlay separate from the immutable HTML source. A local title, type, tags, summary, source label, project workspace, or `catalogUpdatedAt` may therefore differ from the original HDOC manifest after the user organizes the library. `metadata.project` is a first-class optional catalog field; other overlay facts are preserved through `metadata.extensions`. None are written back into `html` during export or recovery.

`metadata.extensions` is optional. It preserves JSON-only document fields that are not part of Helm's core record — including `sourceDocumentId`, `identityState`, `catalogUpdatedAt`, and copy provenance. Extension field names cannot replace core fields or use prototype-sensitive names.

## Safe import contract

`HelmArchiveBackup.prepareImport(archiveOrJson, existingDocuments)` validates the entire payload before returning anything. It returns only documents whose `id` does not already exist. Same-ID records are returned as `conflicts`; they are never renamed, merged, or overwritten automatically.

```js
const plan = HelmArchiveBackup.prepareImport(jsonText, currentDocuments);
await Promise.all(plan.acceptedDocuments.map(saveDocument));
// Render plan.conflicts for an explicit user decision.
```

Do not persist `acceptedDocuments` until the caller has shown the result. A future conflict-resolution UI may offer an explicit copy, replacement, or revision workflow, but `HARC/1.0` makes no implicit data-loss decision.

## Browser helpers

```js
const archive = HelmArchiveBackup.createArchive(selectedDocuments);
HelmArchiveBackup.downloadArchive(archive);

// Optional Chromium File System Access API; downloads remain the fallback.
if (HelmArchiveBackup.hasFileSystemAccess()) {
  await HelmArchiveBackup.saveWithFileSystemAccess(selectedDocuments);
}
```

`readArchiveFile(file)` accepts a file-input `File`, validates it, and returns the archive. `openWithFileSystemAccess({ existingDocuments })` does the same through the optional picker and returns a safe import plan.
