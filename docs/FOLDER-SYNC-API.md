# Helm explicit archive-folder API

`folder-sync.js` is an optional, dependency-free bridge to Chromium's File System Access API. It does not keep a background watcher and does not access IndexedDB. Include it after the rest of Helm's browser scripts:

```html
<script src="folder-sync.js"></script>
```

It exposes `window.HelmFolderSync`.

## Archive layout

The directory selected by the user has exactly these Helm-owned paths:

```text
Selected folder/
  helm-archive.json
  artifacts/
    <safe-id>.html
```

Each artifact file is the document record's original `html` string, written without parsing, normalising, or regenerating it. `<safe-id>` is produced by `HelmFolderSync.safeArtifactId(id)`: a readable, portable slug plus a deterministic identifier suffix. Do not derive filenames yourself; the top-level index is authoritative.

`helm-archive.json` is the `HARC/1.0` **folder-index** profile. It keeps the standard archive envelope and metadata, but stores `artifact_path` instead of duplicating the HTML in JSON:

```json
{
  "format": "helm-archive",
  "schema_version": "HARC/1.0",
  "archive_profile": "folder-index",
  "artifact_directory": "artifacts",
  "exported_at": "2026-07-13T12:00:00.000Z",
  "document_count": 1,
  "documents": [{
    "id": "decision-brief-q3",
    "artifact_path": "artifacts/decision-brief-q3--e70ed5d5.html",
    "metadata": {
      "title": "Q3 decision brief",
      "type": "brief",
      "tags": ["decision"],
      "summary": "The decision context.",
      "source": "Planning agent",
      "created_at": "2026-07-01T08:00:00.000Z",
      "updated_at": "2026-07-13T11:30:00.000Z"
    }
  }]
}
```

## API

- `isSupported()` / `hasFileSystemAccess()` — whether `showDirectoryPicker` exists.
- `chooseDirectory({ mode = 'readwrite', id?, startIn? })` — opens the browser picker. Returns `{ ok, status, handle?, permission?, failures? }`; a user cancellation has `status: 'cancelled'`.
- `verifyPermission(handle, { mode = 'read', request = false })` — checks a retained directory handle. Set `request: true` only inside an explicit user action if the UI wants to request access again.
- `writeArchive(handle, documents, { conflictPolicy = 'error', exportedAt?, requestPermission = false })` — writes `artifacts/<safe-id>.html` for every document and then writes the index last. Document records use Helm's normal fields (`id`, `title`, `type`, `tags`, `summary`, `source`, `createdAt`, `updatedAt`, `html`); extra JSON-only fields are preserved as `metadata.extensions`.
- `readArchive(handle, { requestPermission = false })` / `recoverArchive(...)` — validates the index, loads every referenced original HTML file, and returns recoverable Helm records.
- `buildFolderIndex(documents, { exportedAt? })`, `validateFolderIndex(value)`, `parseFolderIndex(value)`, `safeArtifactId(id)`, and `artifactPathForId(id)` are available for previews or tests.

Every operation returns a structured result with `ok`, `status`, `failures`, and (where applicable) `conflicts`. `readArchive` returns `documents` only from files it successfully loads and marks an incomplete recovery with `complete: false`.

## No implicit replacement

`writeArchive` defaults to `conflictPolicy: 'error'`. If either an artifact file or `helm-archive.json` already exists, it makes **no writes** and returns `status: 'conflict'`, `requiresExplicitReplace: true`, and the exact paths in `conflicts`.

Only a deliberate Sync now action may opt in to replacement:

```js
const selection = await HelmFolderSync.chooseDirectory({ id: 'helm-archive' });
if (!selection.ok) return;

const write = await HelmFolderSync.writeArchive(selection.handle, documents, {
  conflictPolicy: 'replace',
  requestPermission: true
});
```

Writing HTML files happens before the index, so an existing index remains available if a later artifact write fails. The File System Access API has no multi-file atomic transaction; a `partial-write` result therefore always includes the exact completed paths and failures for the UI to show.
