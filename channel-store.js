/*
 * Helm Channels repository.
 *
 * Logical artifacts and immutable HTML revisions are stored separately. The
 * legacy `documents` store is retained as a read-only migration source.
 */
(function attachHelmChannelStore(global) {
  'use strict';

  const DEFAULT_DB_NAME = 'helm-html-archive';
  const DB_VERSION = 4;
  const LEGACY_STORE = 'documents';
  const ARTIFACT_STORE = 'artifacts';
  const REVISION_STORE = 'revisions';
  const SETTINGS_STORE = 'settings';
  const MIGRATION_KEY = 'channelsMigrationV1';
  const LEGACY_SHARE_NORMALISATION_KEY = 'legacyShareNormalisationV1';
  const STATUSES = new Set(['draft', 'in-review', 'published', 'archived']);
  const CATALOG_FIELDS = new Set(['title', 'type', 'tags', 'summary', 'source', 'project']);
  const ARTIFACT_FIELDS = new Set([
    'id', 'title', 'type', 'tags', 'summary', 'source', 'project', 'createdAt',
    'updatedAt', 'catalogUpdatedAt', 'status', 'currentRevisionId',
    'publishedRevisionId', 'forkedFrom', 'sourceDocumentId', 'identityState',
    'extensions'
  ]);
  const REVISION_INPUT_FIELDS = new Set([
    ...ARTIFACT_FIELDS, 'html', 'contentText', 'validation', 'share', 'revisionId',
    'contentHash', 'parent', 'authoredAt', 'author', 'derivedVersion'
  ]);

  class ChannelStoreError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'ChannelStoreError';
      this.code = code;
      Object.assign(this, details);
    }
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
      transaction.onerror = () => { /* onabort carries the final error */ };
    });
  }

  function isPlainObject(value) {
    return Boolean(value) && Object.prototype.toString.call(value) === '[object Object]';
  }

  function cloneJson(value, path = 'value') {
    if (value === undefined) return undefined;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only JSON values.`);
      return value;
    }
    if (Array.isArray(value)) return value.map((entry, index) => cloneJson(entry, `${path}[${index}]`));
    if (!isPlainObject(value)) throw new TypeError(`${path} must contain only JSON values.`);
    const copy = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new TypeError(`${path}.${key} is not allowed.`);
      copy[key] = cloneJson(entry, `${path}.${key}`);
    }
    return copy;
  }

  function safeString(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function timestamp(value, fallback) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback;
  }

  function normaliseProject(value) {
    if (!isPlainObject(value)) return { id: 'unassigned', name: 'Needs project' };
    return {
      id: safeString(value.id, 'unassigned'),
      name: safeString(value.name, safeString(value.id, 'Needs project'))
    };
  }

  function normaliseTags(value) {
    return (Array.isArray(value) ? value : []).filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean);
  }

  function normaliseMigratedShare(value) {
    if (!isPlainObject(value)) return null;
    if (value.kind === 'legacy') return cloneJson(value, 'share');
    if (safeString(value.stableUrl)) return cloneJson(value, 'share');
    const legacyUrl = safeString(value.legacyUrl, safeString(value.url));
    let legacyPath = safeString(value.legacyPath, safeString(value.path));
    if (!legacyPath && legacyUrl) {
      try { legacyPath = new URL(legacyUrl, 'http://helm.local').pathname; }
      catch (_error) { /* Leave malformed historical metadata visible but non-actionable. */ }
    }
    if (!legacyUrl && !legacyPath) return cloneJson(value, 'share');
    return {
      kind: 'legacy',
      legacyUrl: legacyUrl || legacyPath,
      legacyPath: legacyPath || null,
      sha256: safeString(value.sha256) || null,
      publishedAt: timestamp(value.publishedAt, null),
      revokedAt: timestamp(value.revokedAt, null)
    };
  }

  function extraFields(input, knownFields) {
    const extensions = isPlainObject(input.extensions) ? cloneJson(input.extensions, 'extensions') : {};
    for (const [key, value] of Object.entries(input)) {
      if (!knownFields.has(key) && value !== undefined) extensions[key] = cloneJson(value, key);
    }
    return Object.keys(extensions).length ? extensions : undefined;
  }

  async function sha256(html) {
    if (!global.crypto?.subtle || typeof global.TextEncoder !== 'function') {
      throw new ChannelStoreError('webcrypto-unavailable', 'Helm Channels requires WebCrypto SHA-256 support.');
    }
    const digest = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function revisionIdForHash(hash) {
    return `sha256:${hash}`;
  }

  function normaliseParent(value) {
    if (value === null || value === undefined) return null;
    if (!isPlainObject(value) || !safeString(value.artifactId) || !safeString(value.revisionId)) {
      throw new TypeError('A revision parent must contain artifactId and revisionId.');
    }
    return { artifactId: value.artifactId.trim(), revisionId: value.revisionId.trim() };
  }

  function artifactFromInput(input, options = {}) {
    const now = options.now || new Date().toISOString();
    const id = safeString(options.id || input.id);
    if (!id) throw new TypeError('An artifact id is required.');
    const createdAt = timestamp(input.createdAt, now);
    const status = STATUSES.has(options.status || input.status) ? (options.status || input.status) : 'draft';
    return {
      id,
      title: safeString(input.title, 'Untitled artifact'),
      type: safeString(input.type, 'reference'),
      tags: normaliseTags(input.tags),
      summary: typeof input.summary === 'string' ? input.summary : '',
      source: typeof input.source === 'string' ? input.source : '',
      project: normaliseProject(input.project),
      createdAt,
      updatedAt: timestamp(input.updatedAt, createdAt),
      catalogUpdatedAt: timestamp(input.catalogUpdatedAt, timestamp(input.updatedAt, createdAt)),
      status,
      currentRevisionId: options.revisionId,
      publishedRevisionId: options.publishedRevisionId || null,
      forkedFrom: options.forkedFrom ? normaliseParent(options.forkedFrom) : null,
      sourceDocumentId: safeString(input.sourceDocumentId) || null,
      identityState: safeString(input.identityState, input.sourceDocumentId ? 'aligned' : 'unmanaged'),
      ...(extraFields(input, REVISION_INPUT_FIELDS) ? { extensions: extraFields(input, REVISION_INPUT_FIELDS) } : {})
    };
  }

  function revisionFromInput(artifactId, input, hash, options = {}) {
    const now = options.now || new Date().toISOString();
    const id = revisionIdForHash(hash);
    return {
      artifactId,
      id,
      contentHash: hash,
      parent: normaliseParent(options.parent),
      createdAt: now,
      authoredAt: timestamp(input.authoredAt || input.updatedAt, timestamp(input.createdAt, now)),
      author: safeString(input.author, safeString(input.source)),
      html: input.html,
      contentText: typeof input.contentText === 'string' ? input.contentText : '',
      validation: input.validation === undefined ? null : cloneJson(input.validation, 'validation'),
      derivedVersion: Number.isInteger(input.derivedVersion) && input.derivedVersion > 0 ? input.derivedVersion : null,
      sourceManifestId: safeString(input.sourceDocumentId) || null,
      share: options.share === undefined || options.share === null ? null : cloneJson(options.share, 'share')
    };
  }

  function projectArtifact(artifact, revision) {
    if (!artifact || !revision) return null;
    return {
      ...cloneJson(artifact, 'artifact'),
      html: revision.html,
      contentText: revision.contentText || '',
      validation: revision.validation,
      derivedVersion: revision.derivedVersion || null,
      share: revision.share,
      revisionId: revision.id,
      contentHash: revision.contentHash,
      revisionCreatedAt: revision.createdAt,
      parentRevision: revision.parent
    };
  }

  function createIndexes(db) {
    let artifacts;
    if (!db.objectStoreNames.contains(ARTIFACT_STORE)) artifacts = db.createObjectStore(ARTIFACT_STORE, { keyPath: 'id' });
    else artifacts = null;
    if (artifacts) {
      artifacts.createIndex('by_project', 'project.id', { unique: false });
      artifacts.createIndex('by_status', 'status', { unique: false });
      artifacts.createIndex('by_updated_at', 'catalogUpdatedAt', { unique: false });
    }
    let revisions;
    if (!db.objectStoreNames.contains(REVISION_STORE)) revisions = db.createObjectStore(REVISION_STORE, { keyPath: ['artifactId', 'id'] });
    else revisions = null;
    if (revisions) {
      revisions.createIndex('by_artifact', 'artifactId', { unique: false });
      revisions.createIndex('by_content_hash', 'contentHash', { unique: false });
      revisions.createIndex('by_created_at', 'createdAt', { unique: false });
    }
    if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
  }

  function openDatabase(dbName) {
    return new Promise((resolve, reject) => {
      const request = global.indexedDB.open(dbName, DB_VERSION);
      request.onupgradeneeded = () => createIndexes(request.result);
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onblocked = () => reject(new ChannelStoreError('database-blocked', 'Close other Helm tabs so the Channels database can be upgraded.'));
      request.onerror = () => reject(request.error);
    });
  }

  function makeRepository(options = {}) {
    const dbName = options.dbName || DEFAULT_DB_NAME;
    let databasePromise = null;
    const database = () => (databasePromise ||= openDatabase(dbName));

    async function getAll(storeName) {
      const db = await database();
      return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
    }

    async function getArtifact(id) {
      const db = await database();
      return requestResult(db.transaction(ARTIFACT_STORE, 'readonly').objectStore(ARTIFACT_STORE).get(id));
    }

    async function getRevision(artifactId, revisionId) {
      const db = await database();
      return requestResult(db.transaction(REVISION_STORE, 'readonly').objectStore(REVISION_STORE).get([artifactId, revisionId]));
    }

    async function getSetting(key) {
      const db = await database();
      const entry = await requestResult(db.transaction(SETTINGS_STORE, 'readonly').objectStore(SETTINGS_STORE).get(key));
      return entry?.value;
    }

    async function setSetting(key, value) {
      const db = await database();
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).put({ key, value });
      await transactionDone(tx);
      return value;
    }

    async function migrateLegacyDocuments() {
      const db = await database();
      const marker = await requestResult(db.transaction(SETTINGS_STORE, 'readonly').objectStore(SETTINGS_STORE).get(MIGRATION_KEY));
      if (marker?.value?.complete) return marker.value;
      if (!db.objectStoreNames.contains(LEGACY_STORE)) {
        const value = { complete: true, migratedCount: 0, completedAt: new Date().toISOString() };
        const tx = db.transaction(SETTINGS_STORE, 'readwrite');
        tx.objectStore(SETTINGS_STORE).put({ key: MIGRATION_KEY, value });
        await transactionDone(tx);
        return value;
      }

      const legacy = await requestResult(db.transaction(LEGACY_STORE, 'readonly').objectStore(LEGACY_STORE).getAll());
      const prepared = [];
      const invalidLegacyRecords = [];
      for (const [index, document] of legacy.entries()) {
        if (!document || typeof document.html !== 'string' || !safeString(document.id)) {
          invalidLegacyRecords.push(safeString(document?.id, `record-${index + 1}`));
          continue;
        }
        const hash = await sha256(document.html);
        const revisionId = revisionIdForHash(hash);
        const publishedRevisionId = document.share ? revisionId : null;
        const artifact = artifactFromInput(document, {
          id: document.id,
          revisionId,
          status: document.share ? 'published' : 'draft',
          publishedRevisionId
        });
        const revision = revisionFromInput(document.id, document, hash, { parent: null, now: timestamp(document.updatedAt, new Date().toISOString()), share: normaliseMigratedShare(document.share) });
        prepared.push({ artifact, revision });
      }
      if (invalidLegacyRecords.length) {
        throw new ChannelStoreError('migration-invalid-records', `Legacy migration stopped before hiding ${invalidLegacyRecords.length} invalid record(s).`, { records: invalidLegacyRecords });
      }

      const existingArtifacts = new Map((await getAll(ARTIFACT_STORE)).map((entry) => [entry.id, entry]));
      const existingRevisions = new Map((await getAll(REVISION_STORE)).map((entry) => [`${entry.artifactId}\u0000${entry.id}`, entry]));
      for (const { artifact, revision } of prepared) {
        const oldRevision = existingRevisions.get(`${revision.artifactId}\u0000${revision.id}`);
        if (oldRevision && oldRevision.html !== revision.html) throw new ChannelStoreError('revision-integrity', `Revision ${revision.id} has conflicting bytes.`);
        const oldArtifact = existingArtifacts.get(artifact.id);
        if (oldArtifact && !oldRevision && oldArtifact.currentRevisionId === revision.id) {
          throw new ChannelStoreError('migration-incomplete', `Artifact ${artifact.id} points to a missing revision.`);
        }
      }

      const completedAt = new Date().toISOString();
      const value = { complete: true, migratedCount: prepared.length, completedAt };
      const tx = db.transaction([ARTIFACT_STORE, REVISION_STORE, SETTINGS_STORE], 'readwrite');
      const artifacts = tx.objectStore(ARTIFACT_STORE);
      const revisions = tx.objectStore(REVISION_STORE);
      for (const { artifact, revision } of prepared) {
        if (!existingRevisions.has(`${revision.artifactId}\u0000${revision.id}`)) revisions.add(revision);
        if (!existingArtifacts.has(artifact.id)) artifacts.add(artifact);
      }
      tx.objectStore(SETTINGS_STORE).put({ key: MIGRATION_KEY, value });
      await transactionDone(tx);
      return value;
    }

    async function normaliseLegacyShares() {
      const db = await database();
      const marker = await requestResult(db.transaction(SETTINGS_STORE, 'readonly').objectStore(SETTINGS_STORE).get(LEGACY_SHARE_NORMALISATION_KEY));
      if (marker?.value?.complete) return marker.value;
      const revisions = await getAll(REVISION_STORE);
      const updates = revisions
        .map((revision) => ({ revision, share: normaliseMigratedShare(revision.share) }))
        .filter(({ revision, share }) => JSON.stringify(revision.share) !== JSON.stringify(share));
      const completedAt = new Date().toISOString();
      const value = { complete: true, normalisedCount: updates.length, completedAt };
      const tx = db.transaction([REVISION_STORE, SETTINGS_STORE], 'readwrite');
      const revisionStore = tx.objectStore(REVISION_STORE);
      for (const { revision, share } of updates) revisionStore.put({ ...revision, share });
      tx.objectStore(SETTINGS_STORE).put({ key: LEGACY_SHARE_NORMALISATION_KEY, value });
      await transactionDone(tx);
      return value;
    }

    async function open() {
      await database();
      await migrateLegacyDocuments();
      await normaliseLegacyShares();
      return repository;
    }

    async function listArtifacts(options = {}) {
      await open();
      const artifacts = await getAll(ARTIFACT_STORE);
      return artifacts.filter((artifact) => options.includeArchived === true || artifact.status !== 'archived');
    }

    async function listRevisions(artifactId) {
      await open();
      const db = await database();
      const tx = db.transaction(REVISION_STORE, 'readonly');
      const records = await requestResult(tx.objectStore(REVISION_STORE).index('by_artifact').getAll(artifactId));
      return records.sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
    }

    async function getDocument(id, revisionId) {
      await open();
      const artifact = await getArtifact(id);
      if (!artifact) return null;
      const revision = await getRevision(id, revisionId || artifact.currentRevisionId);
      return projectArtifact(artifact, revision);
    }

    async function listDocuments(options = {}) {
      const artifacts = await listArtifacts(options);
      return Promise.all(artifacts.map((artifact) => getDocument(artifact.id)));
    }

    async function createOrRevise(input, options = {}) {
      await open();
      if (!isPlainObject(input) || typeof input.html !== 'string') throw new TypeError('createOrRevise requires an HTML document record.');
      const artifactId = safeString(options.artifactId || input.id);
      if (!artifactId) throw new TypeError('createOrRevise requires an artifact id.');
      const hash = await sha256(input.html);
      const revisionId = revisionIdForHash(hash);
      const db = await database();
      const tx = db.transaction([ARTIFACT_STORE, REVISION_STORE], 'readwrite');
      const artifacts = tx.objectStore(ARTIFACT_STORE);
      const revisions = tx.objectStore(REVISION_STORE);
      const existingArtifact = await requestResult(artifacts.get(artifactId));
      const existingRevision = await requestResult(revisions.get([artifactId, revisionId]));

      if (existingRevision) {
        if (existingRevision.html !== input.html) {
          tx.abort();
          throw new ChannelStoreError('revision-integrity', `Revision ${revisionId} has conflicting bytes.`);
        }
        if (!existingArtifact) {
          tx.abort();
          throw new ChannelStoreError('orphan-revision', `Revision ${artifactId}/${revisionId} has no logical artifact.`);
        }
        const currentRevision = existingArtifact.currentRevisionId === revisionId
          ? existingRevision
          : await requestResult(revisions.get([artifactId, existingArtifact.currentRevisionId]));
        if (!currentRevision) {
          tx.abort();
          throw new ChannelStoreError('missing-revision', `Artifact ${artifactId} points to a missing current revision.`);
        }
        await transactionDone(tx);
        return { created: false, revised: false, idempotent: true, artifact: existingArtifact, revision: existingRevision, document: projectArtifact(existingArtifact, currentRevision) };
      }

      if (existingArtifact && options.expectedCurrentRevisionId !== undefined && existingArtifact.currentRevisionId !== options.expectedCurrentRevisionId) {
        tx.abort();
        throw new ChannelStoreError('head-conflict', 'The artifact changed after this revision was prepared.', { expected: options.expectedCurrentRevisionId, actual: existingArtifact.currentRevisionId });
      }

      const parent = options.parent !== undefined
        ? normaliseParent(options.parent)
        : existingArtifact ? { artifactId, revisionId: existingArtifact.currentRevisionId } : null;
      if (parent) {
        const parentRevision = await requestResult(revisions.get([parent.artifactId, parent.revisionId]));
        if (!parentRevision) {
          tx.abort();
          throw new ChannelStoreError('missing-parent', `Parent revision ${parent.artifactId}/${parent.revisionId} does not exist.`);
        }
      }
      const revisionShare = options.revisionShare !== undefined
        ? options.revisionShare
        : (!existingArtifact && !options.forkedFrom ? input.share : null);
      const revision = revisionFromInput(artifactId, input, hash, { parent, share: revisionShare });
      revisions.add(revision);
      let artifact;
      if (existingArtifact) {
        artifact = {
          ...existingArtifact,
          currentRevisionId: revisionId,
          status: existingArtifact.publishedRevisionId === revisionId ? 'published' : 'draft',
          updatedAt: timestamp(input.updatedAt, existingArtifact.updatedAt),
          ...(options.updateCatalog === true ? {
            title: safeString(input.title, existingArtifact.title),
            type: safeString(input.type, existingArtifact.type),
            tags: input.tags ? normaliseTags(input.tags) : existingArtifact.tags,
            summary: typeof input.summary === 'string' ? input.summary : existingArtifact.summary,
            source: typeof input.source === 'string' ? input.source : existingArtifact.source,
            project: input.project ? normaliseProject(input.project) : existingArtifact.project,
            catalogUpdatedAt: new Date().toISOString()
          } : {})
        };
        artifacts.put(artifact);
      } else {
        artifact = artifactFromInput(input, { id: artifactId, revisionId, status: options.status, forkedFrom: options.forkedFrom || parent });
        artifacts.add(artifact);
      }
      await transactionDone(tx);
      return { created: !existingArtifact, revised: Boolean(existingArtifact), idempotent: false, artifact, revision, document: projectArtifact(artifact, revision) };
    }

    async function updateCatalog(id, patch) {
      await open();
      if (!isPlainObject(patch)) throw new TypeError('Catalog patch must be an object.');
      const forbidden = Object.keys(patch).filter((key) => !CATALOG_FIELDS.has(key));
      if (forbidden.length) throw new ChannelStoreError('invalid-catalog-patch', `Catalog fields cannot update: ${forbidden.join(', ')}.`);
      const db = await database();
      const tx = db.transaction(ARTIFACT_STORE, 'readwrite');
      const store = tx.objectStore(ARTIFACT_STORE);
      const artifact = await requestResult(store.get(id));
      if (!artifact) { tx.abort(); throw new ChannelStoreError('not-found', `Artifact ${id} does not exist.`); }
      const updated = { ...artifact, catalogUpdatedAt: new Date().toISOString() };
      if (patch.title !== undefined) updated.title = safeString(patch.title, artifact.title);
      if (patch.type !== undefined) updated.type = safeString(patch.type, artifact.type);
      if (patch.tags !== undefined) updated.tags = normaliseTags(patch.tags);
      if (patch.summary !== undefined) updated.summary = typeof patch.summary === 'string' ? patch.summary : artifact.summary;
      if (patch.source !== undefined) updated.source = typeof patch.source === 'string' ? patch.source : artifact.source;
      if (patch.project !== undefined) updated.project = normaliseProject(patch.project);
      store.put(updated);
      await transactionDone(tx);
      return getDocument(id);
    }

    async function updateRevisionDerivedData(artifactId, revisionId, patch) {
      await open();
      if (!isPlainObject(patch)) throw new TypeError('Revision derived-data patch must be an object.');
      const allowed = new Set(['contentText', 'validation', 'derivedVersion']);
      const forbidden = Object.keys(patch).filter((key) => !allowed.has(key));
      if (forbidden.length) throw new ChannelStoreError('invalid-revision-derived-patch', `Revision derived fields cannot update: ${forbidden.join(', ')}.`);
      const db = await database();
      const tx = db.transaction(REVISION_STORE, 'readwrite');
      const store = tx.objectStore(REVISION_STORE);
      const revision = await requestResult(store.get([artifactId, revisionId]));
      if (!revision) { tx.abort(); throw new ChannelStoreError('missing-revision', `Revision ${artifactId}/${revisionId} does not exist.`); }
      const updated = {
        ...revision,
        ...(patch.contentText !== undefined ? { contentText: typeof patch.contentText === 'string' ? patch.contentText : '' } : {}),
        ...(patch.validation !== undefined ? { validation: patch.validation === null ? null : cloneJson(patch.validation, 'validation') } : {}),
        ...(patch.derivedVersion !== undefined ? { derivedVersion: Number.isInteger(patch.derivedVersion) && patch.derivedVersion > 0 ? patch.derivedVersion : null } : {})
      };
      store.put(updated);
      await transactionDone(tx);
      return updated;
    }

    async function setStatus(id, status, options = {}) {
      await open();
      if (!STATUSES.has(status)) throw new TypeError(`Unknown artifact status: ${status}.`);
      const db = await database();
      const tx = db.transaction([ARTIFACT_STORE, REVISION_STORE], 'readwrite');
      const artifacts = tx.objectStore(ARTIFACT_STORE);
      const artifact = await requestResult(artifacts.get(id));
      if (!artifact) { tx.abort(); throw new ChannelStoreError('not-found', `Artifact ${id} does not exist.`); }
      let publishedRevisionId = artifact.publishedRevisionId || null;
      if (status === 'published') {
        publishedRevisionId = options.revisionId || artifact.currentRevisionId;
        const revision = await requestResult(tx.objectStore(REVISION_STORE).get([id, publishedRevisionId]));
        if (!revision) { tx.abort(); throw new ChannelStoreError('missing-revision', `Revision ${publishedRevisionId} does not exist.`); }
      }
      const updated = { ...artifact, status, publishedRevisionId, catalogUpdatedAt: new Date().toISOString() };
      artifacts.put(updated);
      await transactionDone(tx);
      return getDocument(id);
    }

    async function setRevisionShare(artifactId, revisionId, share) {
      await open();
      if (share !== null && !isPlainObject(share)) throw new TypeError('Revision share metadata must be an object or null.');
      const db = await database();
      const tx = db.transaction(REVISION_STORE, 'readwrite');
      const revisions = tx.objectStore(REVISION_STORE);
      const revision = await requestResult(revisions.get([artifactId, revisionId]));
      if (!revision) { tx.abort(); throw new ChannelStoreError('missing-revision', `Revision ${revisionId} does not exist.`); }
      const immutable = {
        html: revision.html,
        contentHash: revision.contentHash,
        parent: cloneJson(revision.parent, 'parent')
      };
      const updated = { ...revision, share: share === null ? null : cloneJson(share, 'share') };
      // Publication metadata is mutable, but the evidence original and lineage
      // are deliberately copied from the stored record without accepting input.
      updated.html = immutable.html;
      updated.contentHash = immutable.contentHash;
      updated.parent = immutable.parent;
      revisions.put(updated);
      await transactionDone(tx);
      return updated;
    }

    async function revokePublication(artifactId, revisionId, share) {
      await open();
      if (!isPlainObject(share)) throw new TypeError('Revoked publication metadata must be an object.');
      const db = await database();
      const tx = db.transaction([ARTIFACT_STORE, REVISION_STORE], 'readwrite');
      const artifacts = tx.objectStore(ARTIFACT_STORE);
      const revisions = tx.objectStore(REVISION_STORE);
      const artifact = await requestResult(artifacts.get(artifactId));
      const revision = await requestResult(revisions.get([artifactId, revisionId]));
      if (!artifact || !revision) { tx.abort(); throw new ChannelStoreError('not-found', 'The published Artifact or Revision no longer exists.'); }
      revisions.put({ ...revision, share: cloneJson(share, 'share') });
      const status = artifact.currentRevisionId === revisionId ? 'in-review' : artifact.status;
      artifacts.put({ ...artifact, status, catalogUpdatedAt: new Date().toISOString() });
      await transactionDone(tx);
      return getDocument(artifactId);
    }

    async function setCurrentRevision(artifactId, revisionId) {
      await open();
      const db = await database();
      const tx = db.transaction([ARTIFACT_STORE, REVISION_STORE], 'readwrite');
      const artifacts = tx.objectStore(ARTIFACT_STORE);
      const artifact = await requestResult(artifacts.get(artifactId));
      if (!artifact) { tx.abort(); throw new ChannelStoreError('not-found', `Artifact ${artifactId} does not exist.`); }
      const revision = await requestResult(tx.objectStore(REVISION_STORE).get([artifactId, revisionId]));
      if (!revision) { tx.abort(); throw new ChannelStoreError('missing-revision', `Revision ${revisionId} does not exist.`); }
      const updated = {
        ...artifact,
        currentRevisionId: revisionId,
        status: revisionId === artifact.publishedRevisionId ? artifact.status : 'draft',
        catalogUpdatedAt: new Date().toISOString()
      };
      artifacts.put(updated);
      await transactionDone(tx);
      return projectArtifact(updated, revision);
    }

    async function fork(sourceArtifactId, input, options = {}) {
      await open();
      const source = await getArtifact(sourceArtifactId);
      if (!source) throw new ChannelStoreError('not-found', `Artifact ${sourceArtifactId} does not exist.`);
      const sourceRevisionId = options.revisionId || source.currentRevisionId;
      const sourceRevision = await getRevision(sourceArtifactId, sourceRevisionId);
      if (!sourceRevision) throw new ChannelStoreError('missing-revision', `Revision ${sourceRevisionId} does not exist.`);
      const forkInput = { ...projectArtifact(source, sourceRevision), ...(input || {}), html: input?.html ?? sourceRevision.html };
      const newId = safeString(options.artifactId || input?.id);
      if (!newId || newId === sourceArtifactId) throw new TypeError('A fork requires a distinct artifact id.');
      if (await getArtifact(newId)) throw new ChannelStoreError('artifact-exists', `Artifact ${newId} already exists.`);
      const parent = { artifactId: sourceArtifactId, revisionId: sourceRevisionId };
      return createOrRevise({ ...forkInput, id: newId }, { artifactId: newId, parent, forkedFrom: parent, status: options.status || 'draft' });
    }

    async function deleteArtifact(id, options = {}) {
      await open();
      if (options.hard !== true) return setStatus(id, 'archived');
      const db = await database();
      const tx = db.transaction([ARTIFACT_STORE, REVISION_STORE], 'readwrite');
      const artifacts = tx.objectStore(ARTIFACT_STORE);
      if (!await requestResult(artifacts.get(id))) { tx.abort(); throw new ChannelStoreError('not-found', `Artifact ${id} does not exist.`); }
      artifacts.delete(id);
      const index = tx.objectStore(REVISION_STORE).index('by_artifact');
      await new Promise((resolve, reject) => {
        const cursor = index.openKeyCursor(global.IDBKeyRange.only(id));
        cursor.onerror = () => reject(cursor.error);
        cursor.onsuccess = () => {
          const result = cursor.result;
          if (!result) { resolve(); return; }
          tx.objectStore(REVISION_STORE).delete(result.primaryKey);
          result.continue();
        };
      });
      await transactionDone(tx);
      return { deleted: true, id };
    }

    async function close() {
      if (!databasePromise) return;
      const db = await databasePromise;
      db.close();
      databasePromise = null;
    }

    const repository = Object.freeze({
      open,
      close,
      migrateLegacyDocuments,
      listArtifacts,
      listRevisions,
      getArtifact,
      getRevision,
      getSetting,
      setSetting,
      getDocument,
      listDocuments,
      createOrRevise,
      updateCatalog,
      updateRevisionDerivedData,
      setStatus,
      setRevisionShare,
      revokePublication,
      setCurrentRevision,
      fork,
      deleteArtifact,
      projectArtifact
    });
    return repository;
  }

  global.HelmChannelStore = Object.freeze({
    DB_VERSION,
    LEGACY_STORE,
    ARTIFACT_STORE,
    REVISION_STORE,
    SETTINGS_STORE,
    MIGRATION_KEY,
    STATUSES,
    ChannelStoreError,
    sha256,
    revisionIdForHash,
    projectArtifact,
    create: makeRepository,
    defaultRepository: makeRepository()
  });
}(typeof window !== 'undefined' ? window : globalThis));
