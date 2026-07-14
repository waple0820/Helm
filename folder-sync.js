/*
 * Helm explicit archive-folder helper.
 *
 * This module is intentionally storage-agnostic: it never opens IndexedDB and
 * it never watches a directory. A caller chooses a directory in a user gesture,
 * retains that handle if desired, then invokes writeArchive or recoverArchive
 * from an explicit Sync now / Recover action.
 */
(function attachHelmFolderSync(global) {
  'use strict';

  const FORMAT = 'helm-archive';
  const SCHEMA_VERSION = 'HARC/1.0';
  const ARCHIVE_PROFILE = 'folder-index';
  const INDEX_FILENAME = 'helm-archive.json';
  const ARTIFACT_DIRECTORY = 'artifacts';
  const CORE_FIELDS = new Set(['id', 'title', 'type', 'tags', 'summary', 'source', 'createdAt', 'updatedAt', 'html', 'extensions']);
  const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  function isPlainObject(value) {
    return Boolean(value) && Object.prototype.toString.call(value) === '[object Object]';
  }

  function isIsoTimestamp(value) {
    return typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && !Number.isNaN(Date.parse(value));
  }

  function cloneJson(value, path) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only JSON values.`);
      return value;
    }
    if (Array.isArray(value)) return value.map((entry, index) => cloneJson(entry, `${path}[${index}]`));
    if (!isPlainObject(value)) throw new TypeError(`${path} must contain only JSON values.`);
    const copy = {};
    for (const [key, entry] of Object.entries(value)) {
      if (RESERVED_KEYS.has(key)) throw new TypeError(`${path}.${key} is not an allowed extension key.`);
      copy[key] = cloneJson(entry, `${path}.${key}`);
    }
    return copy;
  }

  function failure(path, error) {
    return {
      path,
      name: error?.name || 'Error',
      message: error?.message || String(error)
    };
  }

  function result(status, details = {}) {
    return { ok: status === 'written' || status === 'recovered', status, failures: [], conflicts: [], ...details };
  }

  function hasFileSystemAccess() {
    return typeof global.showDirectoryPicker === 'function';
  }

  function isDirectoryHandle(handle) {
    return Boolean(handle)
      && (handle.kind === undefined || handle.kind === 'directory')
      && typeof handle.getFileHandle === 'function'
      && typeof handle.getDirectoryHandle === 'function';
  }

  function checkMode(mode) {
    if (mode === undefined) return 'read';
    if (mode !== 'read' && mode !== 'readwrite') throw new TypeError('Permission mode must be "read" or "readwrite".');
    return mode;
  }

  async function verifyPermission(handle, options = {}) {
    const mode = checkMode(options.mode);
    if (!isDirectoryHandle(handle)) return { ok: false, state: 'invalid-handle', mode, requested: false };
    if (typeof handle.queryPermission !== 'function') {
      return { ok: false, state: 'unsupported', mode, requested: false, message: 'This directory handle cannot report its permission state.' };
    }
    try {
      let state = await handle.queryPermission({ mode });
      let requested = false;
      if (state !== 'granted' && options.request === true) {
        if (typeof handle.requestPermission !== 'function') {
          return { ok: false, state: 'unsupported', mode, requested: false, message: 'This directory handle cannot request permission.' };
        }
        state = await handle.requestPermission({ mode });
        requested = true;
      }
      return { ok: state === 'granted', state, mode, requested };
    } catch (error) {
      return { ok: false, state: 'error', mode, requested: false, error: failure('directory', error) };
    }
  }

  async function chooseDirectory(options = {}) {
    if (!hasFileSystemAccess()) return result('unsupported', { message: 'The File System Access API is unavailable in this browser.' });
    const mode = checkMode(options.mode === undefined ? 'readwrite' : options.mode);
    const pickerOptions = { mode };
    if (typeof options.id === 'string' && options.id) pickerOptions.id = options.id;
    if (options.startIn !== undefined) pickerOptions.startIn = options.startIn;
    try {
      const handle = await global.showDirectoryPicker(pickerOptions);
      const permission = await verifyPermission(handle, { mode, request: false });
      return result('selected', { ok: true, handle, permission });
    } catch (error) {
      if (error?.name === 'AbortError') return result('cancelled', { message: 'No directory was selected.' });
      return result('picker-failed', { failures: [failure('directory', error)] });
    }
  }

  // A deterministic, filename-safe label. The hash prevents normalisation and
  // case-folding collisions; buildFolderIndex rejects the improbable hash clash.
  function fingerprint(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function safeArtifactId(id) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('An artifact id must be a non-empty string.');
    const slug = id.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/[-_.]{2,}/g, '-')
      .replace(/^[-_.]+|[-_.]+$/g, '')
      .slice(0, 72) || 'artifact';
    return `${slug}--${fingerprint(id)}`;
  }

  function artifactPathForId(id) {
    return `${ARTIFACT_DIRECTORY}/${safeArtifactId(id)}.html`;
  }

  function normaliseExtensions(document, path) {
    const extensions = {};
    for (const [key, value] of Object.entries(document)) {
      if (!CORE_FIELDS.has(key)) extensions[key] = cloneJson(value, `${path}.${key}`);
    }
    if (document.extensions !== undefined) {
      if (!isPlainObject(document.extensions)) throw new TypeError(`${path}.extensions must be a JSON object when present.`);
      for (const [key, value] of Object.entries(document.extensions)) {
        if (RESERVED_KEYS.has(key) || CORE_FIELDS.has(key)) throw new TypeError(`${path}.extensions.${key} is a reserved document field.`);
        extensions[key] = cloneJson(value, `${path}.extensions.${key}`);
      }
    }
    return Object.keys(extensions).length ? extensions : undefined;
  }

  function normaliseDocument(document, index) {
    const path = `documents[${index}]`;
    if (!isPlainObject(document)) throw new TypeError(`${path} must be a document object.`);
    if (typeof document.id !== 'string' || !document.id.trim()) throw new TypeError(`${path}.id must be a non-empty string.`);
    if (typeof document.title !== 'string' || !document.title.trim()) throw new TypeError(`${path}.title must be a non-empty string.`);
    if (typeof document.type !== 'string' || !document.type.trim()) throw new TypeError(`${path}.type must be a non-empty string.`);
    if (!Array.isArray(document.tags) || document.tags.some((tag) => typeof tag !== 'string')) throw new TypeError(`${path}.tags must be an array of strings.`);
    if (document.summary !== undefined && document.summary !== null && typeof document.summary !== 'string') throw new TypeError(`${path}.summary must be a string or null.`);
    if (document.source !== undefined && document.source !== null && typeof document.source !== 'string') throw new TypeError(`${path}.source must be a string or null.`);
    if (!isIsoTimestamp(document.createdAt)) throw new TypeError(`${path}.createdAt must be an ISO 8601 timestamp.`);
    if (!isIsoTimestamp(document.updatedAt)) throw new TypeError(`${path}.updatedAt must be an ISO 8601 timestamp.`);
    if (typeof document.html !== 'string') throw new TypeError(`${path}.html must contain the original HTML source as a string.`);
    const metadata = {
      title: document.title,
      type: document.type,
      tags: [...document.tags],
      summary: document.summary ?? null,
      source: document.source ?? null,
      created_at: document.createdAt,
      updated_at: document.updatedAt
    };
    const extensions = normaliseExtensions(document, path);
    if (extensions) metadata.extensions = extensions;
    return { id: document.id, metadata, html: document.html, artifact_path: artifactPathForId(document.id) };
  }

  function buildFolderIndex(documents, options = {}) {
    if (!Array.isArray(documents)) throw new TypeError('buildFolderIndex expects an array of document records.');
    const exportedAt = options.exportedAt || new Date().toISOString();
    if (!isIsoTimestamp(exportedAt)) throw new TypeError('exportedAt must be an ISO 8601 timestamp.');
    const ids = new Set();
    const paths = new Set();
    const records = documents.map(normaliseDocument).map((document, index) => {
      if (ids.has(document.id)) throw new TypeError(`documents[${index}].id duplicates another document id.`);
      if (paths.has(document.artifact_path)) throw new TypeError(`documents[${index}].id maps to an artifact filename already used by another id.`);
      ids.add(document.id);
      paths.add(document.artifact_path);
      return { id: document.id, metadata: document.metadata, artifact_path: document.artifact_path };
    });
    return {
      format: FORMAT,
      schema_version: SCHEMA_VERSION,
      archive_profile: ARCHIVE_PROFILE,
      artifact_directory: ARTIFACT_DIRECTORY,
      exported_at: exportedAt,
      document_count: records.length,
      documents: records
    };
  }

  function validateArtifactPath(path) {
    return typeof path === 'string'
      && /^artifacts\/[A-Za-z0-9][A-Za-z0-9._-]*\.html$/.test(path)
      && !path.includes('..');
  }

  function validateFolderIndex(payload) {
    const errors = [];
    const add = (path, message) => errors.push({ path, message });
    if (!isPlainObject(payload)) return { valid: false, errors: [{ path: '$', message: 'Folder index must be a JSON object.' }] };
    if (payload.format !== FORMAT) add('format', `must equal "${FORMAT}".`);
    if (payload.schema_version !== SCHEMA_VERSION) add('schema_version', `must equal "${SCHEMA_VERSION}".`);
    if (payload.archive_profile !== ARCHIVE_PROFILE) add('archive_profile', `must equal "${ARCHIVE_PROFILE}".`);
    if (payload.artifact_directory !== ARTIFACT_DIRECTORY) add('artifact_directory', `must equal "${ARTIFACT_DIRECTORY}".`);
    if (!isIsoTimestamp(payload.exported_at)) add('exported_at', 'must be an ISO 8601 timestamp.');
    if (!Number.isInteger(payload.document_count) || payload.document_count < 0) add('document_count', 'must be a non-negative integer.');
    if (!Array.isArray(payload.documents)) add('documents', 'must be an array.');
    if (Array.isArray(payload.documents) && payload.document_count !== payload.documents.length) add('document_count', 'must match documents.length.');
    if (errors.length) return { valid: false, errors };

    const ids = new Set();
    const paths = new Set();
    const documents = [];
    payload.documents.forEach((entry, index) => {
      const path = `documents[${index}]`;
      if (!isPlainObject(entry)) { add(path, 'must be an object.'); return; }
      if (typeof entry.id !== 'string' || !entry.id.trim()) add(`${path}.id`, 'must be a non-empty string.');
      if (ids.has(entry.id)) add(`${path}.id`, 'duplicates another document id.');
      ids.add(entry.id);
      if (!validateArtifactPath(entry.artifact_path)) add(`${path}.artifact_path`, 'must be a safe artifacts/<name>.html path.');
      if (typeof entry.id === 'string' && entry.id.trim() && entry.artifact_path !== artifactPathForId(entry.id)) {
        add(`${path}.artifact_path`, 'must be the deterministic safe path for its document id.');
      }
      if (paths.has(entry.artifact_path)) add(`${path}.artifact_path`, 'duplicates another artifact path.');
      paths.add(entry.artifact_path);
      const metadata = entry.metadata;
      if (!isPlainObject(metadata)) { add(`${path}.metadata`, 'must be an object.'); return; }
      if (typeof metadata.title !== 'string' || !metadata.title.trim()) add(`${path}.metadata.title`, 'must be a non-empty string.');
      if (typeof metadata.type !== 'string' || !metadata.type.trim()) add(`${path}.metadata.type`, 'must be a non-empty string.');
      if (!Array.isArray(metadata.tags) || metadata.tags.some((tag) => typeof tag !== 'string')) add(`${path}.metadata.tags`, 'must be an array of strings.');
      if (metadata.summary !== null && typeof metadata.summary !== 'string') add(`${path}.metadata.summary`, 'must be a string or null.');
      if (metadata.source !== null && typeof metadata.source !== 'string') add(`${path}.metadata.source`, 'must be a string or null.');
      if (!isIsoTimestamp(metadata.created_at)) add(`${path}.metadata.created_at`, 'must be an ISO 8601 timestamp.');
      if (!isIsoTimestamp(metadata.updated_at)) add(`${path}.metadata.updated_at`, 'must be an ISO 8601 timestamp.');
      let extensions;
      try {
        if (metadata.extensions !== undefined) {
          if (!isPlainObject(metadata.extensions)) throw new TypeError('must be a JSON object when present.');
          extensions = cloneJson(metadata.extensions, `${path}.metadata.extensions`);
        }
      } catch (error) { add(`${path}.metadata.extensions`, error.message); }
      documents.push({
        id: entry.id,
        artifact_path: entry.artifact_path,
        metadata: {
          title: metadata.title,
          type: metadata.type,
          tags: Array.isArray(metadata.tags) ? [...metadata.tags] : [],
          summary: metadata.summary,
          source: metadata.source,
          created_at: metadata.created_at,
          updated_at: metadata.updated_at,
          ...(extensions && Object.keys(extensions).length ? { extensions } : {})
        }
      });
    });
    if (errors.length) return { valid: false, errors };
    return {
      valid: true,
      errors: [],
      index: {
        format: FORMAT,
        schema_version: SCHEMA_VERSION,
        archive_profile: ARCHIVE_PROFILE,
        artifact_directory: ARTIFACT_DIRECTORY,
        exported_at: payload.exported_at,
        document_count: documents.length,
        documents
      }
    };
  }

  function parseFolderIndex(input) {
    let value = input;
    if (typeof input === 'string') value = JSON.parse(input);
    const checked = validateFolderIndex(value);
    if (checked.valid) return checked.index;
    const error = new TypeError(`Invalid Helm folder index: ${checked.errors.map((entry) => `${entry.path} ${entry.message}`).join(' ')}`);
    error.errors = checked.errors;
    throw error;
  }

  async function getFileIfPresent(directoryHandle, name) {
    try {
      return { present: true, handle: await directoryHandle.getFileHandle(name, { create: false }) };
    } catch (error) {
      if (error?.name === 'NotFoundError') return { present: false, handle: null };
      throw error;
    }
  }

  async function getDirectoryIfPresent(directoryHandle, name) {
    try {
      return { present: true, handle: await directoryHandle.getDirectoryHandle(name, { create: false }) };
    } catch (error) {
      if (error?.name === 'NotFoundError') return { present: false, handle: null };
      throw error;
    }
  }

  async function writeText(fileHandle, text) {
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (error) {
      try { await writable.abort?.(); } catch { /* Preserve the original error. */ }
      throw error;
    }
  }

  function permissionFailure(permission) {
    const status = permission.state === 'denied' ? 'permission-denied' : 'permission-required';
    return result(status, { permission, failures: permission.error ? [permission.error] : [] });
  }

  async function writeArchive(directoryHandle, documents, options = {}) {
    const conflictPolicy = options.conflictPolicy === undefined ? 'error' : options.conflictPolicy;
    if (conflictPolicy !== 'error' && conflictPolicy !== 'replace') {
      return result('invalid-options', { failures: [{ path: 'conflictPolicy', name: 'TypeError', message: 'conflictPolicy must be "error" or "replace".' }] });
    }
    if (!isDirectoryHandle(directoryHandle)) return result('invalid-handle', { failures: [{ path: 'directory', name: 'TypeError', message: 'writeArchive requires a directory handle.' }] });
    let folderIndex;
    let normalisedDocuments;
    try {
      folderIndex = buildFolderIndex(documents, options);
      normalisedDocuments = documents.map(normaliseDocument);
    } catch (error) {
      return result('invalid-documents', { failures: [failure('documents', error)] });
    }
    const permission = await verifyPermission(directoryHandle, { mode: 'readwrite', request: options.requestPermission === true });
    if (!permission.ok) return permissionFailure(permission);

    let artifacts;
    try {
      artifacts = await getDirectoryIfPresent(directoryHandle, ARTIFACT_DIRECTORY);
      const conflicts = [];
      if (artifacts.present) {
        for (const document of normalisedDocuments) {
          const name = document.artifact_path.slice(`${ARTIFACT_DIRECTORY}/`.length);
          if ((await getFileIfPresent(artifacts.handle, name)).present) conflicts.push({ path: document.artifact_path, reason: 'existing-artifact', id: document.id });
        }
      }
      if ((await getFileIfPresent(directoryHandle, INDEX_FILENAME)).present) conflicts.push({ path: INDEX_FILENAME, reason: 'existing-index' });
      if (conflicts.length && conflictPolicy !== 'replace') {
        return result('conflict', { index: folderIndex, conflicts, requiresExplicitReplace: true, permission });
      }
      const artifactDirectory = artifacts.present ? artifacts.handle : await directoryHandle.getDirectoryHandle(ARTIFACT_DIRECTORY, { create: true });
      const writtenFiles = [];
      const replacedPaths = conflicts.map((entry) => entry.path);
      const failures = [];
      for (const document of normalisedDocuments) {
        const name = document.artifact_path.slice(`${ARTIFACT_DIRECTORY}/`.length);
        try {
          await writeText(await artifactDirectory.getFileHandle(name, { create: true }), document.html);
          writtenFiles.push(document.artifact_path);
        } catch (error) {
          failures.push(failure(document.artifact_path, error));
          break;
        }
      }
      if (failures.length) return result('partial-write', { index: folderIndex, writtenFiles, replacedPaths, failures, conflicts: [], permission });
      try {
        await writeText(await directoryHandle.getFileHandle(INDEX_FILENAME, { create: true }), JSON.stringify(folderIndex, null, 2));
        writtenFiles.push(INDEX_FILENAME);
      } catch (error) {
        failures.push(failure(INDEX_FILENAME, error));
        return result('partial-write', { index: folderIndex, writtenFiles, replacedPaths, failures, conflicts: [], permission });
      }
      return result('written', { index: folderIndex, writtenFiles, replacedPaths, conflicts: [], permission });
    } catch (error) {
      return result('write-failed', { index: folderIndex, failures: [failure('directory', error)], permission });
    }
  }

  function recordFromFolderEntry(entry, html) {
    const metadata = entry.metadata;
    const record = {
      id: entry.id,
      title: metadata.title,
      type: metadata.type,
      tags: [...metadata.tags],
      summary: metadata.summary ?? '',
      source: metadata.source ?? '',
      createdAt: metadata.created_at,
      updatedAt: metadata.updated_at,
      html
    };
    if (metadata.extensions) Object.assign(record, cloneJson(metadata.extensions, `metadata.extensions for ${entry.id}`));
    return record;
  }

  async function readArchive(directoryHandle, options = {}) {
    if (!isDirectoryHandle(directoryHandle)) return result('invalid-handle', { failures: [{ path: 'directory', name: 'TypeError', message: 'readArchive requires a directory handle.' }] });
    const permission = await verifyPermission(directoryHandle, { mode: 'read', request: options.requestPermission === true });
    if (!permission.ok) return permissionFailure(permission);
    let index;
    try {
      const indexHandle = await directoryHandle.getFileHandle(INDEX_FILENAME, { create: false });
      index = parseFolderIndex(await (await indexHandle.getFile()).text());
    } catch (error) {
      return result(error?.name === 'NotFoundError' ? 'missing-index' : 'invalid-index', { failures: [failure(INDEX_FILENAME, error)], permission });
    }
    let artifactDirectory;
    try {
      artifactDirectory = await directoryHandle.getDirectoryHandle(ARTIFACT_DIRECTORY, { create: false });
    } catch (error) {
      return result('incomplete', { index, documents: [], failures: [failure(ARTIFACT_DIRECTORY, error)], permission, complete: false });
    }
    const documents = [];
    const failures = [];
    for (const entry of index.documents) {
      const name = entry.artifact_path.slice(`${ARTIFACT_DIRECTORY}/`.length);
      try {
        const html = await (await (await artifactDirectory.getFileHandle(name, { create: false })).getFile()).text();
        documents.push(recordFromFolderEntry(entry, html));
      } catch (error) {
        failures.push(failure(entry.artifact_path, error));
      }
    }
    if (failures.length) return result('incomplete', { index, documents, failures, permission, complete: false });
    return result('recovered', { index, documents, permission, complete: true });
  }

  global.HelmFolderSync = Object.freeze({
    FORMAT,
    SCHEMA_VERSION,
    ARCHIVE_PROFILE,
    INDEX_FILENAME,
    ARTIFACT_DIRECTORY,
    isSupported: hasFileSystemAccess,
    hasFileSystemAccess,
    chooseDirectory,
    verifyPermission,
    safeArtifactId,
    artifactPathForId,
    buildFolderIndex,
    validateFolderIndex,
    parseFolderIndex,
    writeArchive,
    readArchive,
    recoverArchive: readArchive
  });
}(typeof window !== 'undefined' ? window : globalThis));
