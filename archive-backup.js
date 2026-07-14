/*
 * Helm portable archive helper.
 *
 * This file deliberately owns no storage. It turns document records into a
 * durable JSON archive and plans a safe, non-destructive import. The app that
 * calls it remains responsible for presenting conflicts and persisting only
 * `acceptedDocuments`.
 */
(function attachHelmArchiveBackup(global) {
  'use strict';

  const FORMAT = 'helm-archive';
  const SCHEMA_VERSION = 'HARC/1.0';
  const RECORD_KEYS = new Set(['id', 'title', 'type', 'tags', 'summary', 'source', 'project', 'createdAt', 'updatedAt', 'html', 'extensions']);
  const RESERVED_EXTENSION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  function isPlainObject(value) {
    // `Object.getPrototypeOf(value) === Object.prototype` would reject valid
    // records handed over from an iframe or another JavaScript realm.
    return Boolean(value) && Object.prototype.toString.call(value) === '[object Object]';
  }

  function isIsoTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
    return !Number.isNaN(Date.parse(value));
  }

  function cloneJson(value, path) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only JSON values.`);
      return value;
    }
    if (Array.isArray(value)) return value.map((item, index) => cloneJson(item, `${path}[${index}]`));
    if (!isPlainObject(value)) throw new TypeError(`${path} must contain only JSON values.`);
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      if (RESERVED_EXTENSION_KEYS.has(key)) throw new TypeError(`${path}.${key} is not an allowed extension key.`);
      copy[key] = cloneJson(item, `${path}.${key}`);
    }
    return copy;
  }

  function issue(path, message) {
    return { path, message };
  }

  function invalid(errors, path, message) {
    errors.push(issue(path, message));
  }

  function normaliseExtensions(value, path, errors) {
    if (value === undefined) return undefined;
    if (!isPlainObject(value)) {
      invalid(errors, path, 'must be a JSON object when present.');
      return undefined;
    }
    try {
      const extensions = cloneJson(value, path);
      Object.keys(extensions).forEach((key) => {
        if (RECORD_KEYS.has(key)) invalid(errors, `${path}.${key}`, 'uses a reserved document field name.');
      });
      return extensions;
    } catch (error) {
      invalid(errors, path, error.message);
      return undefined;
    }
  }

  function documentToArchiveRecord(record, index) {
    const path = `documents[${index}]`;
    if (!isPlainObject(record)) throw new TypeError(`${path} must be a document record.`);
    if (typeof record.id !== 'string' || !record.id.trim()) throw new TypeError(`${path}.id must be a non-empty string.`);
    if (typeof record.title !== 'string' || !record.title.trim()) throw new TypeError(`${path}.title must be a non-empty string.`);
    if (typeof record.type !== 'string' || !record.type.trim()) throw new TypeError(`${path}.type must be a non-empty string.`);
    if (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== 'string')) throw new TypeError(`${path}.tags must be an array of strings.`);
    if (record.summary !== undefined && record.summary !== null && typeof record.summary !== 'string') throw new TypeError(`${path}.summary must be a string or null.`);
    if (record.source !== undefined && record.source !== null && typeof record.source !== 'string') throw new TypeError(`${path}.source must be a string or null.`);
    if (record.project !== undefined && (!isPlainObject(record.project) || typeof record.project.id !== 'string' || !record.project.id.trim() || typeof record.project.name !== 'string' || !record.project.name.trim())) throw new TypeError(`${path}.project must contain non-empty id and name strings.`);
    if (!isIsoTimestamp(record.createdAt)) throw new TypeError(`${path}.createdAt must be an ISO 8601 timestamp.`);
    if (!isIsoTimestamp(record.updatedAt)) throw new TypeError(`${path}.updatedAt must be an ISO 8601 timestamp.`);
    if (typeof record.html !== 'string') throw new TypeError(`${path}.html must contain the original HTML source as a string.`);

    const extensions = {};
    for (const [key, value] of Object.entries(record)) {
      if (!RECORD_KEYS.has(key)) extensions[key] = cloneJson(value, `${path}.${key}`);
    }
    if (record.extensions !== undefined) {
      if (!isPlainObject(record.extensions)) throw new TypeError(`${path}.extensions must be a JSON object when present.`);
      for (const [key, value] of Object.entries(record.extensions)) {
        if (RESERVED_EXTENSION_KEYS.has(key) || RECORD_KEYS.has(key)) throw new TypeError(`${path}.extensions.${key} is a reserved field name.`);
        extensions[key] = cloneJson(value, `${path}.extensions.${key}`);
      }
    }

    const metadata = {
      title: record.title,
      type: record.type,
      tags: [...record.tags],
      summary: record.summary ?? null,
      source: record.source ?? null,
      ...(record.project ? { project: cloneJson(record.project, `${path}.project`) } : {}),
      created_at: record.createdAt,
      updated_at: record.updatedAt
    };
    if (Object.keys(extensions).length) metadata.extensions = extensions;
    return { id: record.id, metadata, html: record.html };
  }

  function createArchive(records, options = {}) {
    if (!Array.isArray(records)) throw new TypeError('createArchive expects an array of document records.');
    const exportedAt = options.exportedAt || new Date().toISOString();
    if (!isIsoTimestamp(exportedAt)) throw new TypeError('exportedAt must be an ISO 8601 timestamp.');
    const documents = records.map(documentToArchiveRecord);
    const ids = new Set();
    documents.forEach((document, index) => {
      if (ids.has(document.id)) throw new TypeError(`documents[${index}].id duplicates another record in this archive.`);
      ids.add(document.id);
    });
    return {
      format: FORMAT,
      schema_version: SCHEMA_VERSION,
      exported_at: exportedAt,
      document_count: documents.length,
      documents
    };
  }

  function validateArchive(payload) {
    const errors = [];
    if (!isPlainObject(payload)) {
      return { valid: false, errors: [issue('$', 'Archive must be a JSON object.')] };
    }
    if (payload.format !== FORMAT) invalid(errors, 'format', `must equal "${FORMAT}".`);
    if (payload.schema_version !== SCHEMA_VERSION) invalid(errors, 'schema_version', `must equal "${SCHEMA_VERSION}".`);
    if (!isIsoTimestamp(payload.exported_at)) invalid(errors, 'exported_at', 'must be an ISO 8601 timestamp.');
    if (!Number.isInteger(payload.document_count) || payload.document_count < 0) invalid(errors, 'document_count', 'must be a non-negative integer.');
    if (!Array.isArray(payload.documents)) invalid(errors, 'documents', 'must be an array.');
    if (Array.isArray(payload.documents) && payload.document_count !== payload.documents.length) invalid(errors, 'document_count', 'must match documents.length.');
    if (errors.length) return { valid: false, errors };

    const documents = [];
    const ids = new Set();
    payload.documents.forEach((document, index) => {
      const path = `documents[${index}]`;
      if (!isPlainObject(document)) {
        invalid(errors, path, 'must be an object.');
        return;
      }
      if (typeof document.id !== 'string' || !document.id.trim()) invalid(errors, `${path}.id`, 'must be a non-empty string.');
      if (ids.has(document.id)) invalid(errors, `${path}.id`, 'duplicates another document id in this archive.');
      ids.add(document.id);
      if (typeof document.html !== 'string') invalid(errors, `${path}.html`, 'must contain the original HTML source as a string.');
      if (!isPlainObject(document.metadata)) {
        invalid(errors, `${path}.metadata`, 'must be an object.');
        return;
      }
      const metadata = document.metadata;
      if (typeof metadata.title !== 'string' || !metadata.title.trim()) invalid(errors, `${path}.metadata.title`, 'must be a non-empty string.');
      if (typeof metadata.type !== 'string' || !metadata.type.trim()) invalid(errors, `${path}.metadata.type`, 'must be a non-empty string.');
      if (!Array.isArray(metadata.tags) || metadata.tags.some((tag) => typeof tag !== 'string')) invalid(errors, `${path}.metadata.tags`, 'must be an array of strings.');
      if (metadata.summary !== null && typeof metadata.summary !== 'string') invalid(errors, `${path}.metadata.summary`, 'must be a string or null.');
      if (metadata.source !== null && typeof metadata.source !== 'string') invalid(errors, `${path}.metadata.source`, 'must be a string or null.');
      if (metadata.project !== undefined && (!isPlainObject(metadata.project) || typeof metadata.project.id !== 'string' || !metadata.project.id.trim() || typeof metadata.project.name !== 'string' || !metadata.project.name.trim())) invalid(errors, `${path}.metadata.project`, 'must contain non-empty id and name strings when present.');
      if (!isIsoTimestamp(metadata.created_at)) invalid(errors, `${path}.metadata.created_at`, 'must be an ISO 8601 timestamp.');
      if (!isIsoTimestamp(metadata.updated_at)) invalid(errors, `${path}.metadata.updated_at`, 'must be an ISO 8601 timestamp.');
      const extensions = normaliseExtensions(metadata.extensions, `${path}.metadata.extensions`, errors);

      if (errors.some((entry) => entry.path === path || entry.path.startsWith(`${path}.`))) return;
      const normalisedMetadata = {
        title: metadata.title,
        type: metadata.type,
        tags: [...metadata.tags],
        summary: metadata.summary,
        source: metadata.source,
        ...(metadata.project ? { project: cloneJson(metadata.project, `${path}.metadata.project`) } : {}),
        created_at: metadata.created_at,
        updated_at: metadata.updated_at
      };
      if (extensions && Object.keys(extensions).length) normalisedMetadata.extensions = extensions;
      documents.push({ id: document.id, metadata: normalisedMetadata, html: document.html });
    });

    if (errors.length) return { valid: false, errors };
    return {
      valid: true,
      errors: [],
      archive: {
        format: FORMAT,
        schema_version: SCHEMA_VERSION,
        exported_at: payload.exported_at,
        document_count: documents.length,
        documents
      }
    };
  }

  function parseArchive(input) {
    let payload = input;
    if (typeof input === 'string') {
      try {
        payload = JSON.parse(input);
      } catch (error) {
        const parseError = new TypeError(`Archive is not valid JSON: ${error.message}`);
        parseError.errors = [issue('$', 'Archive is not valid JSON.')];
        throw parseError;
      }
    }
    const result = validateArchive(payload);
    if (result.valid) return result.archive;
    const error = new TypeError(`Invalid Helm archive: ${result.errors.map((entry) => `${entry.path} ${entry.message}`).join(' ')}`);
    error.errors = result.errors;
    throw error;
  }

  function serialiseArchive(archive, space = 2) {
    return JSON.stringify(parseArchive(archive), null, space);
  }

  function archiveDocumentToRecord(document) {
    const metadata = document.metadata;
    const record = {
      id: document.id,
      title: metadata.title,
      type: metadata.type,
      tags: [...metadata.tags],
      summary: metadata.summary ?? '',
      source: metadata.source ?? '',
      ...(metadata.project ? { project: cloneJson(metadata.project, 'metadata.project') } : {}),
      createdAt: metadata.created_at,
      updatedAt: metadata.updated_at,
      html: document.html
    };
    if (metadata.extensions) {
      for (const [key, value] of Object.entries(metadata.extensions)) {
        if (!RECORD_KEYS.has(key) && !RESERVED_EXTENSION_KEYS.has(key)) record[key] = cloneJson(value, `metadata.extensions.${key}`);
      }
    }
    return record;
  }

  function coerceArchive(recordsOrArchive, options) {
    return Array.isArray(recordsOrArchive) ? createArchive(recordsOrArchive, options) : parseArchive(recordsOrArchive);
  }

  function prepareImport(payload, existingDocuments = []) {
    const archive = parseArchive(payload);
    if (!Array.isArray(existingDocuments)) throw new TypeError('existingDocuments must be an array of current document records.');
    const existingById = new Map();
    existingDocuments.forEach((document, index) => {
      if (document && typeof document.id === 'string' && document.id) existingById.set(document.id, { document, index });
    });
    const acceptedDocuments = [];
    const conflicts = [];
    archive.documents.forEach((document) => {
      const existing = existingById.get(document.id);
      if (existing) {
        conflicts.push({
          id: document.id,
          reason: 'existing-id',
          incoming: archiveDocumentToRecord(document),
          existing: existing.document,
          existingIndex: existing.index
        });
      } else {
        acceptedDocuments.push(archiveDocumentToRecord(document));
      }
    });
    return {
      valid: true,
      archive,
      acceptedDocuments,
      conflicts,
      skippedCount: conflicts.length,
      importedCount: acceptedDocuments.length
    };
  }

  function archiveFilename(exportedAt) {
    return `helm-archive-${exportedAt.slice(0, 10)}.json`;
  }

  function downloadArchive(recordsOrArchive, options = {}) {
    if (!global.document || !global.URL || typeof global.URL.createObjectURL !== 'function') throw new Error('Downloading an archive requires a browser document.');
    const archive = coerceArchive(recordsOrArchive, options);
    const filename = options.filename || archiveFilename(archive.exported_at);
    const blob = new Blob([serialiseArchive(archive)], { type: 'application/json;charset=utf-8' });
    const url = global.URL.createObjectURL(blob);
    const anchor = global.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    global.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout(() => global.URL.revokeObjectURL(url), 0);
    return { archive, filename };
  }

  async function readArchiveFile(file) {
    if (!file || typeof file.text !== 'function') throw new TypeError('readArchiveFile expects a File or Blob with a text() method.');
    return parseArchive(await file.text());
  }

  function hasFileSystemAccess() {
    return typeof global.showSaveFilePicker === 'function' && typeof global.showOpenFilePicker === 'function';
  }

  async function saveWithFileSystemAccess(recordsOrArchive, options = {}) {
    if (typeof global.showSaveFilePicker !== 'function') throw new Error('The File System Access API is unavailable in this browser. Use downloadArchive instead.');
    const archive = coerceArchive(recordsOrArchive, options);
    const filename = options.filename || archiveFilename(archive.exported_at);
    const handle = options.handle || await global.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: 'Helm archive', accept: { 'application/json': ['.json'] } }]
    });
    const writable = await handle.createWritable();
    await writable.write(serialiseArchive(archive));
    await writable.close();
    return { archive, handle, filename };
  }

  async function openWithFileSystemAccess(options = {}) {
    if (typeof global.showOpenFilePicker !== 'function') throw new Error('The File System Access API is unavailable in this browser. Use a file input with readArchiveFile instead.');
    const handle = options.handle || (await global.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Helm archive', accept: { 'application/json': ['.json'] } }]
    }))[0];
    if (!handle) throw new Error('No archive file was selected.');
    const archive = await readArchiveFile(await handle.getFile());
    const plan = prepareImport(archive, options.existingDocuments || []);
    return { ...plan, handle };
  }

  global.HelmArchiveBackup = Object.freeze({
    FORMAT,
    SCHEMA_VERSION,
    createArchive,
    validateArchive,
    parseArchive,
    serialiseArchive,
    archiveDocumentToRecord,
    prepareImport,
    importArchive: prepareImport,
    downloadArchive,
    readArchiveFile,
    hasFileSystemAccess,
    saveWithFileSystemAccess,
    openWithFileSystemAccess
  });
}(window));
