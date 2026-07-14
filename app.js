const DB_NAME = 'helm-html-archive';
const DB_VERSION = 3;
const STORE = 'documents';
const SETTINGS = 'settings';
const SCHEMA = 'HDOC/1.0';
const DOCUMENT_TYPES = new Set(['report', 'brief', 'reference', 'dashboard', 'note']);
const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;
const UNASSIGNED_PROJECT = Object.freeze({ id: 'unassigned', name: 'Needs project' });
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_SEARCH_TEXT = 250000;
const AGENT_BRIDGE_URL = 'http://127.0.0.1:4175';
const SHARE_API_URL = '/api/share';

const templates = [
  { id: 'research-report', title: 'Research dossier', type: 'report', tags: ['research', 'evidence'], summary: 'Question → answer → evidence → recommendation.', accent: '#e7e6df' },
  { id: 'decision-brief', title: 'Decision brief', type: 'brief', tags: ['decision', 'active'], summary: 'Decision → comparison → recommendation → checkpoint.', accent: '#d6e5f0' },
  { id: 'reference-note', title: 'Reference note', type: 'reference', tags: ['reference', 'notes'], summary: 'Pattern → application → caveats → primary sources.', accent: '#f0ddcf' }
];

const seedDocuments = [
  { id: 'welcome-to-helm', title: 'Welcome to Helm', type: 'reference', tags: ['start-here', 'library'], summary: 'Your local-first HTML library. Import an artifact or begin with a template.', source: 'Helm', project: { id: 'helm', name: 'Helm' }, createdAt: '2026-07-13T09:00:00.000Z', updatedAt: '2026-07-13T09:00:00.000Z' },
  { id: 'document-contract', title: 'The Helm document contract', type: 'reference', tags: ['standard', 'HDOC/1.0'], summary: 'The small, portable agreement that lets HTML artifacts carry their own context.', source: 'Helm', project: { id: 'helm', name: 'Helm' }, createdAt: '2026-07-13T09:02:00.000Z', updatedAt: '2026-07-13T09:02:00.000Z' }
];

let documents = [];
let selectedId = null;
let activeFilter = 'all';
let activeProject = 'all';
let toastTimer;
let templateToCreate = templates[0];
let editingId = null;
let pendingDuplicateImport = null;
let archiveFolderHandle = null;
let folderReplaceArmed = false;
let agentInboxDocuments = [];
let selectedAgentInboxIds = new Set();
let appearanceMode = 'system';
let readerArtifactId = null;
let readerLoadToken = 0;
let readerSlowTimer = null;

const APPEARANCE_MODES = new Set(['light', 'dark', 'system']);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const safeText = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const slug = (value) => safeText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artifact';
const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown date' : new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', year: 'numeric' }).format(date);
};
const byteLabel = (value = 0) => value < 1024 ? `${value || 0} B` : `${(value / 1024).toFixed(1)} KB`;
const isTimestamp = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const normaliseTimestamp = (value, fallback) => isTimestamp(value) ? new Date(value).toISOString() : fallback;
const normaliseTags = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []).filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 8);

function normaliseProject(value, fallback = UNASSIGNED_PROJECT) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const name = safeText(raw.name || raw.label || (typeof value === 'string' ? value : '')).slice(0, 100);
  const candidateId = safeText(raw.id, name ? slug(name) : '');
  if (!name && !candidateId) return { ...fallback };
  return {
    id: PROJECT_ID_PATTERN.test(candidateId) ? candidateId : slug(candidateId || name),
    name: name || candidateId
  };
}

function projectFor(artifact) {
  return normaliseProject(artifact?.project);
}

function inferredLegacyProject(input, manifest) {
  const identity = safeText(input?.sourceDocumentId, safeText(manifest?.id, safeText(input?.id))).toLowerCase();
  if (identity.startsWith('texas-gto-lab-')) return { id: 'texas-gto-lab', name: 'Texas GTO Lab' };
  if (identity === 'codex-memory-activation-20260713' || identity === 'codex-helm-workflow-reference-2026-07-13') return { id: 'helm', name: 'Helm' };
  if (identity.startsWith('gpt55-lexbench-')) return { id: 'lexbrowserenv', name: 'LexBrowserEnv' };
  if (input?.id === 'welcome-to-helm' || input?.id === 'document-contract' || safeText(input?.source) === 'Helm') return { id: 'helm', name: 'Helm' };
  return UNASSIGNED_PROJECT;
}

function knownProjects() {
  const projects = new Map();
  documents.forEach((artifact) => {
    const project = projectFor(artifact);
    projects.set(project.id, project);
  });
  return [...projects.values()].sort((left, right) => {
    if (left.id === UNASSIGNED_PROJECT.id) return 1;
    if (right.id === UNASSIGNED_PROJECT.id) return -1;
    return left.name.localeCompare(right.name);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDocument(artifact) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(artifact);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function removeDocument(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getSetting(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(SETTINGS, 'readonly').objectStore(SETTINGS).get(key);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}

async function setSetting(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(SETTINGS, 'readwrite').objectStore(SETTINGS).put({ key, value });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function setAppearance(mode, persist = false) {
  appearanceMode = APPEARANCE_MODES.has(mode) ? mode : 'system';
  const systemPrefersDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
  document.documentElement.dataset.theme = appearanceMode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : appearanceMode;
  document.documentElement.dataset.appearance = appearanceMode;
  $$('[data-theme-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeMode === appearanceMode)));
  if (persist) void setSetting('appearanceMode', appearanceMode);
}

const appearanceMedia = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
appearanceMedia?.addEventListener?.('change', () => { if (appearanceMode === 'system') setAppearance('system'); });

function manifestFor(artifact) {
  const manifest = {
    schema_version: SCHEMA,
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    tags: artifact.tags,
    summary: artifact.summary,
    created_at: artifact.createdAt,
    updated_at: artifact.updatedAt,
    provenance: { author: 'Personal archive', sources: [] }
  };
  const project = projectFor(artifact);
  if (project.id !== UNASSIGNED_PROJECT.id) manifest.project = project;
  return manifest;
}

function visualModule(type) {
  const copy = type === 'brief'
    ? { kind: 'Decision map', title: 'Make the chosen option and the reason for it visible', nodes: [['A', 'Option', 'upside'], ['B', 'Recommended', 'evidence'], ['C', 'Alternative', 'trade-off']], note: 'Replace the option names and labels with the actual criteria, evidence date, and reversal condition.' }
    : type === 'reference'
      ? { kind: 'Pattern route', title: 'Show when a reusable pattern turns an input into an outcome', nodes: [['01', 'Trigger', 'precondition'], ['02', 'Pattern', 'minimum action'], ['03', 'Outcome', 'observable result']], note: 'Replace this route with the real precondition, smallest dependable action, and observable result.' }
      : type === 'dashboard'
        ? { kind: 'State lens', title: 'Expose the measure, change, and boundary before interpretation', nodes: [['01', 'Measure', 'unit / range'], ['02', 'Change', 'period'], ['03', 'Boundary', 'method']], note: 'Replace these labels with measured values, period, and the condition that limits interpretation.' }
        : type === 'note'
          ? { kind: 'Handoff route', title: 'Make delivery, proof, and the remaining owner visible', nodes: [['01', 'Delivered', 'artifact'], ['02', 'Verified', 'evidence'], ['03', 'Review', 'owner']], note: 'Replace the stages with the delivered result, the proof, and the only remaining human decision.' }
          : { kind: 'Evidence route', title: 'Show how dated evidence earns the current answer', nodes: [['01', 'Observation', 'dated source'], ['02', 'Interpretation', 'confidence'], ['03', 'Action', 'boundary']], note: 'Replace every node with the actual observation, interpretation, and action; keep source, date, and confidence beside the claim.' };
  const [first, second, third] = copy.nodes;
  const node = ([index, label, detail], x) => `<g transform="translate(${x} 20)"><rect width="198" height="110" rx="4"></rect><text class="visual-number" x="16" y="25">${index}</text><text class="visual-label" x="16" y="58">${label}</text><text class="visual-detail" x="16" y="82">${detail}</text></g>`;
  return `<figure class="visual-figure" aria-labelledby="visual-title-${esc(type)}"><div class="visual-heading"><div><p class="visual-kicker">${copy.kind}</p><h2 id="visual-title-${esc(type)}">${copy.title}</h2></div><p>Template visual · replace before handoff</p></div><svg viewBox="0 0 700 150" role="img" aria-label="${esc(copy.title)}"><defs><marker id="arrow-${esc(type)}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z"></path></marker></defs><path class="visual-link" d="M204 75 H244" marker-end="url(#arrow-${esc(type)})"></path><path class="visual-link" d="M438 75 H478" marker-end="url(#arrow-${esc(type)})"></path>${node(first, 0)}${node(second, 250)}${node(third, 500)}</svg><figcaption>${copy.note}</figcaption><ol class="visual-fallback"><li><b>${first[1]}:</b> ${first[2]}.</li><li><b>${second[1]}:</b> ${second[2]}.</li><li><b>${third[1]}:</b> ${third[2]}.</li></ol></figure>`;
}

function articleHtml(artifact, sections = []) {
  const manifest = JSON.stringify(manifestFor(artifact), null, 2).replace(/<\//g, '<\\/');
  const readerPath = artifact.type === 'report' ? 'Question → answer → evidence → action' : artifact.type === 'brief' ? 'Decision → options → recommendation → checkpoint' : artifact.type === 'reference' ? 'Pattern → application → caveats → sources' : artifact.type === 'dashboard' ? 'Current state → measures → change → data notes' : 'Finding → evidence → open question → next step';
  const body = sections.map(([heading, text], index) => {
    const role = /evidence|options|comparison|sources|method/i.test(heading) ? 'evidence' : /recommendation|action|decision|next|boundary|notes/i.test(heading) ? 'action' : 'context';
    return `<section class="report-section ${role}"><div class="section-index">${String(index + 1).padStart(2, '0')}</div><div><h2>${esc(heading)}</h2><p>${esc(text)}</p></div></section>`;
  }).join('');
  const styles = `:root{color-scheme:light;--paper:#f7f6f1;--ink:#1b232c;--muted:#65717a;--line:#d7dad5;--panel:#ecefe9;--accent:#c9543b}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(980px,calc(100% - 48px));margin:0 auto;padding:34px 0 96px}.topline{display:flex;justify-content:space-between;gap:20px;padding-bottom:18px;border-bottom:1px solid var(--line);color:var(--muted);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}.hero{padding:64px 0 38px;border-bottom:1px solid var(--line)}.eyebrow,.section-index{margin:0 0 13px;color:var(--muted);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase}.eyebrow{color:var(--accent)}h1,h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.04em}h1{max-width:760px;margin:0;font-size:clamp(42px,7vw,72px);line-height:.98}h2{margin:0;font-size:29px;line-height:1.1}.summary{max-width:700px;margin:22px 0 0;color:#46535d;font-size:20px;line-height:1.55}.meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:23px}.meta span{padding:5px 7px;border:1px solid var(--line);color:var(--muted);font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.visual-figure{margin:0;padding:30px 0;border-bottom:1px solid var(--line)}.visual-heading{display:flex;justify-content:space-between;gap:28px;align-items:start;margin-bottom:18px}.visual-heading h2{max-width:580px;font-size:24px}.visual-heading>p,.visual-kicker{margin:0;color:var(--muted);font:10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}.visual-kicker{margin-bottom:7px;color:var(--accent)}.visual-figure svg{display:block;width:100%;height:auto;border:1px solid var(--line);background:#fbfbf8}.visual-figure rect{fill:var(--paper);stroke:#9eaaa8}.visual-figure .visual-link{fill:none;stroke:var(--accent);stroke-width:2}.visual-figure marker path{fill:var(--accent)}.visual-number{fill:var(--accent);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}.visual-label{fill:var(--ink);font:600 17px ui-sans-serif,system-ui,sans-serif}.visual-detail{fill:var(--muted);font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.visual-figure figcaption{max-width:700px;margin:12px 0 0;color:#536168;font-size:13px;line-height:1.55}.visual-fallback{display:none}.reader-path{display:grid;grid-template-columns:160px minmax(0,1fr);gap:28px;margin:30px 0 0;padding:22px 0;border-bottom:1px solid var(--line)}.reader-path p{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:22px;line-height:1.32;letter-spacing:-.02em}.reader-path .section-index{color:var(--accent)}.report-section{display:grid;grid-template-columns:160px minmax(0,1fr);gap:28px;padding:46px 0;border-bottom:1px solid var(--line)}.report-section>div:last-child{max-width:700px}.report-section p{margin:15px 0 0;color:#46535d;font-size:16px;line-height:1.72}.report-section.evidence{background:linear-gradient(90deg,transparent 0,transparent 160px,var(--panel) 160px,var(--panel) 100%);padding-left:18px;padding-right:24px}.report-section.action>div:last-child{padding-left:20px;border-left:3px solid var(--accent)}.source-note{margin:34px 0 0;color:var(--muted);font-size:13px;line-height:1.6}@media(max-width:700px){main{width:min(100% - 32px,980px)}.topline,.visual-heading,.reader-path,.report-section{display:block}.topline span:last-child{display:none}.visual-heading>p{margin-top:10px}.visual-figure svg{display:none}.visual-fallback{display:grid;gap:7px;margin:14px 0 0;padding-left:20px;color:#46535d;font-size:14px;line-height:1.55}.reader-path .section-index,.report-section .section-index{margin-bottom:12px}.report-section.evidence{margin-left:-16px;margin-right:-16px;padding-left:16px;background:var(--panel)}}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="helm:title" content="${esc(artifact.title)}"><meta name="helm:type" content="${esc(artifact.type)}"><meta name="helm:summary" content="${esc(artifact.summary)}"><meta name="helm:tags" content="${esc(artifact.tags.join(', '))}"><title>${esc(artifact.title)}</title><style>${styles}</style><script type="application/json" data-helm-manifest>${manifest}</script></head><body><main data-document-root><div class="topline"><span>${esc(artifact.type)} · HDOC/1.0</span><span>Updated ${esc(artifact.updatedAt.slice(0, 10))}</span></div><header class="hero"><p class="eyebrow">Evidence original · ${esc(artifact.type)}</p><h1>${esc(artifact.title)}</h1><p class="summary">${esc(artifact.summary || 'A personal HTML artifact.')}</p><div class="meta">${artifact.tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div></header>${visualModule(artifact.type)}<aside class="reader-path" aria-label="Reader path"><p class="section-index">Reader path</p><p>${esc(readerPath)}</p></aside>${body}<p class="source-note">Before handoff, replace the template visual with actual evidence and add sources, dates, assumptions, and confidence wherever they qualify a factual claim.</p></main></body></html>`;
}

function seedHtml(artifact) {
  const sections = artifact.id === 'welcome-to-helm'
    ? [['What belongs here', 'Save the HTML outputs you want to find again: reports, project briefs, notes, dashboards and finished research. The library stores the original file rather than translating it into a database-only format.'], ['How to begin', 'Import an existing HTML file, or use a template to create a compliant starting point. Select any artifact to open it in the safe reader or export the exact source.']]
    : [['Why a contract', 'HTML is a superb final format for AI-assisted work, but a loose file often loses its purpose and provenance. A tiny manifest makes it searchable, auditable and portable.'], ['Use it elsewhere', 'Give another project the Helm document contract before asking it to generate HTML. The result can be imported here without losing its record.']];
  return articleHtml(artifact, sections);
}

function inspectHtml(html) {
  try {
    if (globalThis.HelmValidator?.validate) return globalThis.HelmValidator.validate(html);
  } catch (error) {
    console.warn('Helm contract validation failed.', error);
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  let manifest = null;
  try { manifest = JSON.parse(parsed.querySelector('script[data-helm-manifest]')?.textContent || 'null'); } catch { /* fallback remains readable */ }
  const content = parsed.querySelector('main[data-document-root], main, article, body');
  return { valid: false, score: 0, manifest, extractedText: safeText(content?.textContent).replace(/\s+/g, ' '), issues: [{ severity: 'warning', code: 'validator-unavailable', message: 'Contract inspection was unavailable in this browser.' }] };
}

function preferredId(value, title) {
  return typeof value === 'string' && /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(value) ? value : slug(title);
}

function uniqueId(preferred, title, takenIds) {
  const base = preferredId(preferred, title);
  if (!takenIds.has(base)) return base;
  let attempt = 2;
  while (takenIds.has(`${base}-${attempt}`)) attempt += 1;
  return `${base}-${attempt}`;
}

function enrichArtifact(record, options = {}) {
  const input = record && typeof record === 'object' ? record : {};
  if (typeof input.html !== 'string') throw new TypeError('An artifact must contain its original HTML source.');
  const now = new Date().toISOString();
  const inspection = inspectHtml(input.html);
  const parsed = new DOMParser().parseFromString(input.html, 'text/html');
  const meta = (name) => safeText(parsed.querySelector(`meta[name="${name}"]`)?.content);
  const manifest = inspection.manifest && typeof inspection.manifest === 'object' && !Array.isArray(inspection.manifest) ? inspection.manifest : {};
  const title = safeText(input.title, safeText(manifest.title, meta('helm:title') || safeText(parsed.querySelector('title')?.textContent, options.fallbackName || 'Untitled artifact'))).slice(0, 100);
  const typeCandidate = safeText(input.type, safeText(manifest.type, meta('helm:type') || 'reference')).toLowerCase();
  const type = DOCUMENT_TYPES.has(typeCandidate) ? typeCandidate : 'reference';
  const tags = normaliseTags(input.tags?.length ? input.tags : manifest.tags?.length ? manifest.tags : meta('helm:tags'));
  const summary = safeText(input.summary, safeText(manifest.summary, meta('helm:summary') || safeText(parsed.querySelector('main p, article p, p')?.textContent, 'Imported HTML artifact.'))).slice(0, 240);
  const source = safeText(input.source, safeText(manifest.provenance?.author, options.fallbackName || 'Imported file'));
  const createdAt = normaliseTimestamp(input.createdAt || manifest.created_at, now);
  const updatedAt = normaliseTimestamp(input.updatedAt || manifest.updated_at, createdAt);
  const takenIds = options.takenIds || new Set();
  const sourceDocumentId = safeText(input.sourceDocumentId, safeText(manifest.id));
  const hasDuplicateSourceIdentity = !options.preserveId && Boolean(sourceDocumentId) && Boolean(options.existingSourceIds?.has(sourceDocumentId));
  const id = options.preserveId && safeText(input.id) ? safeText(input.id) : uniqueId(input.id || sourceDocumentId, title, takenIds);
  takenIds.add(id);
  const identityState = input.identityState === 'catalog-copy' || hasDuplicateSourceIdentity ? 'catalog-copy' : sourceDocumentId ? 'aligned' : 'unmanaged';
  const inferredProject = inferredLegacyProject(input, manifest);
  const project = normaliseProject(input.project || manifest.project, inferredProject);
  const core = new Set(['id', 'title', 'type', 'tags', 'summary', 'source', 'project', 'createdAt', 'updatedAt', 'html', 'contentText', 'validation', 'sourceDocumentId', 'identityState']);
  const extensions = Object.fromEntries(Object.entries(input).filter(([key]) => !core.has(key)));
  const issues = Array.isArray(inspection.issues) ? [...inspection.issues] : [];
  if (identityState === 'catalog-copy' && !issues.some((issue) => issue.code === 'catalog-copy-identity')) {
    issues.unshift({ severity: 'warning', code: 'catalog-copy-identity', message: `Source manifest ID “${sourceDocumentId}” already exists here. This is an explicit catalog copy with library ID “${id}”; its original HTML was not renamed.` });
  }
  return { ...extensions, id, sourceDocumentId: sourceDocumentId || null, identityState, title, type, tags, summary, source, project, createdAt, updatedAt, html: input.html, contentText: safeText(inspection.extractedText).slice(0, MAX_SEARCH_TEXT), validation: { valid: Boolean(inspection.valid), hasManifest: Boolean(inspection.manifest), score: Number.isFinite(inspection.score) ? inspection.score : 0, issues } };
}

async function initialise() {
  try {
    setAppearance(await getSetting('appearanceMode'));
    const stored = await getAll();
    const initialized = await getSetting('libraryInitialized');
    if (!initialized && !stored.length) {
      const seeded = seedDocuments.map((artifact) => ({ ...artifact, html: seedHtml(artifact) }));
      documents = seeded.map((artifact) => enrichArtifact(artifact, { takenIds: new Set() }));
      await Promise.all(documents.map(saveDocument));
    } else {
      const takenIds = new Set();
      documents = stored.map((artifact) => enrichArtifact(artifact.html ? artifact : { ...artifact, html: seedHtml(artifact) }, { takenIds, preserveId: true }));
      await Promise.all(documents.map(saveDocument));
    }
    await setSetting('libraryInitialized', true);
    archiveFolderHandle = await getSetting('archiveFolderHandle');
    selectedId = documents[0]?.id || null;
    render();
    void refreshAgentInboxBadge();
  } catch (error) {
    console.error(error);
    showToast('This browser could not open its local library.');
  }
}

function filteredDocuments() {
  const search = $('#searchInput').value.trim().toLowerCase();
  const sort = $('#sortSelect').value;
  const result = documents.filter((artifact) => {
    const matchesFilter = activeFilter === 'all' || artifact.type === activeFilter;
    const matchesProject = activeProject === 'all' || projectFor(artifact).id === activeProject;
    const project = projectFor(artifact);
    const corpus = [artifact.title, artifact.summary, artifact.type, project.id, project.name, ...(artifact.tags || []), artifact.contentText || ''].join(' ').toLowerCase();
    return matchesFilter && matchesProject && (!search || corpus.includes(search));
  });
  return result.sort((left, right) => sort === 'title' ? left.title.localeCompare(right.title) : new Date(right[sort === 'created' ? 'createdAt' : 'catalogUpdatedAt'] || right.updatedAt) - new Date(left[sort === 'created' ? 'createdAt' : 'catalogUpdatedAt'] || left.updatedAt));
}

function renderCollections() {
  const configured = [['Research', '#c4e878', 'research'], ['Active work', '#8cbdde', 'active'], ['Reference', '#e8bd78', 'reference']];
  $('#collections').innerHTML = configured.map(([label, color, term]) => `<button class="collection" type="button" data-collection="${term}" style="--collection-color:${color}"><i></i>${label}<b>${String(documents.filter((artifact) => artifact.type === term || artifact.tags.some((tag) => tag.toLowerCase() === term)).length).padStart(2, '0')}</b></button>`).join('');
  $('#collections').querySelectorAll('.collection').forEach((button) => button.addEventListener('click', () => {
    $('#searchInput').value = button.dataset.collection;
    activeFilter = 'all';
    activeProject = 'all';
    $$('.filter').forEach((filter) => filter.classList.toggle('active', filter.dataset.filter === 'all'));
    showView('library');
    render();
  }));
}

function renderProjects() {
  const projects = knownProjects();
  if (activeProject !== 'all' && !projects.some((project) => project.id === activeProject)) activeProject = 'all';
  $('#projectSuggestions').innerHTML = projects.filter((project) => project.id !== UNASSIGNED_PROJECT.id).map((project) => `<option value="${esc(project.name)}"></option>`).join('');
  const assignedProjects = projects.filter((project) => project.id !== UNASSIGNED_PROJECT.id);
  const unassignedProject = projects.find((project) => project.id === UNASSIGNED_PROJECT.id);
  $('#projects').innerHTML = [
    `<button class="collection project-collection ${activeProject === 'all' ? 'is-active' : ''}" type="button" data-project="all" style="--collection-color:#8cbdde"><i></i>All projects<b>${String(documents.length).padStart(2, '0')}</b></button>`,
    ...assignedProjects.map((project) => `<button class="collection project-collection ${activeProject === project.id ? 'is-active' : ''}" type="button" data-project="${esc(project.id)}" style="--collection-color:#c4e878"><i></i><span>${esc(project.name)}</span><b>${String(documents.filter((artifact) => projectFor(artifact).id === project.id).length).padStart(2, '0')}</b></button>`)
  ].join('');
  $('#projectReviewLabel').hidden = !unassignedProject;
  $('#projectReview').hidden = !unassignedProject;
  $('#projectReview').innerHTML = unassignedProject ? `<button class="collection project-collection ${activeProject === unassignedProject.id ? 'is-active' : ''}" type="button" data-project="${esc(unassignedProject.id)}" style="--collection-color:#e8bd78"><i></i><span>${esc(unassignedProject.name)}</span><b>${String(documents.filter((artifact) => projectFor(artifact).id === unassignedProject.id).length).padStart(2, '0')}</b></button>` : '';
  $$('.project-collection').forEach((button) => button.addEventListener('click', () => {
    activeProject = button.dataset.project;
    activeFilter = 'all';
    $('#searchInput').value = '';
    $$('.filter').forEach((filter) => filter.classList.toggle('active', filter.dataset.filter === 'all'));
    showView('library');
    render();
  }));
}

function renderLibrary() {
  const filtered = filteredDocuments();
  const query = $('#searchInput').value.trim();
  const activeType = activeFilter === 'all' ? 'All artifacts' : `${activeFilter[0].toUpperCase()}${activeFilter.slice(1)}s`;
  const selectedProject = activeProject === 'all' ? null : knownProjects().find((project) => project.id === activeProject);
  const lenses = [selectedProject ? `Project: ${selectedProject.name}` : null, activeFilter !== 'all' ? activeType : null, query ? `Search: “${query.length > 22 ? `${query.slice(0, 22)}…` : query}”` : null].filter(Boolean);
  const filterState = `· ${lenses.join(' · ') || activeType}`;
  const hasActiveLens = Boolean(query) || activeFilter !== 'all' || activeProject !== 'all';
  const readyCount = documents.filter((artifact) => artifact.validation?.valid).length;
  const projectCount = new Set(documents.map((artifact) => projectFor(artifact).id).filter((id) => id !== UNASSIGNED_PROJECT.id)).size;
  $('#documentCount').textContent = String(documents.length).padStart(2, '0');
  $('#libraryCount').textContent = String(documents.length).padStart(2, '0');
  $('#libraryVisibleCount').textContent = String(filtered.length).padStart(2, '0');
  $('#libraryFilterState').textContent = filterState;
  $('#clearLibraryFilters').hidden = !hasActiveLens;
  $('#contractReadyCount').textContent = String(readyCount).padStart(2, '0');
  $('#librarySourceCount').textContent = String(projectCount).padStart(2, '0');
  $('#documentGrid').innerHTML = filtered.map((artifact, index) => { const project = projectFor(artifact); return `<article class="document-card ${artifact.id === selectedId ? 'selected' : ''}" data-id="${esc(artifact.id)}" data-type="${esc(artifact.type)}" tabindex="0"><div class="card-top"><span class="type-pill ${artifact.id === 'document-contract' ? 'contract-pill' : ''}">${esc(artifact.type.toUpperCase())}</span><button class="card-action" type="button" data-open="${esc(artifact.id)}" aria-label="Open ${esc(artifact.title)}">↗</button></div><div class="card-stage" aria-hidden="true"><span class="card-stage-kicker">${esc(artifact.type)} / ${String(index + 1).padStart(2, '0')}</span><span class="card-stage-mark">${artifact.validation?.valid ? '✓' : '·'}</span><div class="card-stage-lines"><i></i><i></i><i></i></div></div><p class="card-project">PROJECT / ${esc(project.name)}</p><h2>${esc(artifact.title)}</h2><p class="summary">${esc(artifact.summary || 'No summary provided.')}</p><div class="card-bottom"><div class="mini-tags">${artifact.tags.slice(0, 3).map((tag) => `<span class="mini-tag">${esc(tag)}</span>`).join('')}</div><span class="card-date">${dateLabel(artifact.catalogUpdatedAt || artifact.updatedAt)}</span></div></article>`; }).join('');
  $('#emptyState').hidden = Boolean(filtered.length);
  $$('.document-card').forEach((card) => {
    card.addEventListener('click', (event) => { if (!event.target.closest('[data-open]')) selectDocument(card.dataset.id); });
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter') selectDocument(card.dataset.id); });
  });
  $$('[data-open]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); openReader(button.dataset.open); }));
}

function templatePreview(type) {
  const labels = type === 'brief' ? ['option', 'choice', 'check'] : type === 'reference' ? ['trigger', 'pattern', 'outcome'] : ['source', 'claim', 'action'];
  return `<div class="template-visual template-visual-${esc(type)}" aria-hidden="true">${labels.map((label, index) => `<span><b>${String(index + 1).padStart(2, '0')}</b>${esc(label)}</span>`).join('')}</div>`;
}

function renderTemplates() {
  $('#templateGrid').innerHTML = templates.map((template, index) => `<article class="template-card" style="--template-accent:${esc(template.accent)}"><div class="template-card-meta"><span>${String(index + 1).padStart(2, '0')} / HDOC STARTER</span><b>${esc(template.type.toUpperCase())}</b></div><div class="template-cover"><div class="template-sheet template-sheet-${esc(template.type)}"><span>${esc(template.type)} / visual route</span>${templatePreview(template.type)}<div class="template-sheet-rule"></div></div></div><h2>${template.title}</h2><p>${template.summary}</p><div class="template-footer"><div class="mini-tags">${template.tags.map((tag) => `<span class="mini-tag">${esc(tag)}</span>`).join('')}</div><button class="button button-quiet" type="button" data-template="${template.id}">Use template <span>→</span></button></div></article>`).join('');
  $$('[data-template]').forEach((button) => button.addEventListener('click', () => openCreateDialog(templates.find((template) => template.id === button.dataset.template))));
}

function renderInspector() {
  const artifact = documents.find((item) => item.id === selectedId);
  $('#inspectorEmpty').hidden = Boolean(artifact);
  $('#inspectorContent').hidden = !artifact;
  if (!artifact) return;
  const health = artifact.validation || inspectHtml(artifact.html);
  const errors = health.issues.filter((issue) => issue.severity === 'error');
  const warnings = health.issues.filter((issue) => issue.severity === 'warning');
  $('#selectedType').textContent = artifact.type.toUpperCase();
  $('#selectedTitle').textContent = artifact.title;
  $('#selectedSummary').textContent = artifact.summary || 'No summary provided.';
  $('#selectedTags').innerHTML = artifact.tags.map((tag) => `<span>${esc(tag)}</span>`).join('');
  $('#selectedUpdated').textContent = dateLabel(artifact.catalogUpdatedAt || artifact.updatedAt);
  $('#selectedSource').textContent = artifact.source || 'Imported file';
  $('#selectedProject').textContent = projectFor(artifact).name;
  const identity = $('#selectedIdentity');
  identity.textContent = artifact.identityState === 'catalog-copy' ? `Copy: ${artifact.id}` : artifact.sourceDocumentId ? `Aligned: ${artifact.id}` : `Library: ${artifact.id}`;
  identity.title = `Library ID: ${artifact.id}${artifact.sourceDocumentId ? ` · source manifest ID: ${artifact.sourceDocumentId}` : ''}`;
  $('#selectedFormat').textContent = health.hasManifest || health.manifest ? SCHEMA : 'Plain HTML';
  $('#selectedSize').textContent = byteLabel(new Blob([artifact.html]).size);
  $('#manifestDot').className = `quality-dot ${health.valid ? 'good' : ''}`;
  $('#manifestStatus').textContent = health.valid ? 'HDOC/1.0 passed' : errors.length ? `${errors.length} contract error${errors.length === 1 ? '' : 's'}` : `${warnings.length} portability warning${warnings.length === 1 ? '' : 's'}`;
  $('#manifestHint').textContent = health.valid ? 'Portable metadata and structure are present.' : 'The original source is unchanged; review before sharing.';
  $('#healthScore').textContent = `${health.score ?? 0}`;
  $('#healthHint').textContent = health.valid ? (warnings.length ? `Contract passed · ${warnings.length} catalog or portability warning${warnings.length === 1 ? '' : 's'}.` : 'No contract errors detected.') : `${errors.length} error${errors.length === 1 ? '' : 's'} · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`;
  $('#healthIssues').innerHTML = health.issues.slice(0, 3).map((issue) => `<li class="issue-${esc(issue.severity)}">${esc(issue.message)}</li>`).join('');
  $('#repairButton').hidden = health.valid;
  const share = artifact.share && typeof artifact.share.url === 'string' ? artifact.share : null;
  $('#shareButton').disabled = !health.valid;
  $('#shareButton').textContent = share ? 'Copy intranet link' : 'Publish intranet link';
  $('#shareRecord').hidden = !share;
  $('#selectedShare').textContent = share?.url || '';
  $('#selectedShare').href = share?.url || '#';
}

function render() { renderCollections(); renderProjects(); renderLibrary(); renderTemplates(); renderInspector(); $('#archiveDocumentCount').textContent = String(documents.length).padStart(2, '0'); renderFolderStatus(); }
function selectDocument(id) { selectedId = id; renderLibrary(); renderInspector(); }

function showView(view) {
  $$('.view').forEach((element) => element.classList.toggle('active-view', element.id === `${view}View`));
  $$('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === view));
  $('#viewTitle').textContent = view === 'library' ? 'Library' : view === 'templates' ? 'Templates' : 'Document contract';
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function pendingAgentInboxDocuments() {
  const libraryIds = new Set(documents.map((artifact) => artifact.id));
  return agentInboxDocuments.filter((artifact) => artifact && typeof artifact.id === 'string' && typeof artifact.html === 'string' && !libraryIds.has(artifact.id));
}

function updateAgentInboxBadge() {
  const badge = $('#agentInboxCount');
  if (!badge) return;
  const count = pendingAgentInboxDocuments().length;
  badge.hidden = count === 0;
  badge.textContent = String(count);
}

async function fetchAgentBridgeDocuments() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`${AGENT_BRIDGE_URL}/v1/artifacts`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Bridge returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.documents)) throw new Error('Bridge response did not include documents.');
    return payload.documents;
  } finally {
    clearTimeout(timeout);
  }
}

function renderAgentInbox({ online = true, error = null } = {}) {
  const dot = $('#agentInboxDot');
  const status = $('#agentInboxStatus');
  const hint = $('#agentInboxHint');
  const list = $('#agentInboxList');
  const importButton = $('#agentInboxImportButton');
  const refreshButton = $('#agentInboxRefreshButton');
  if (!dot || !status || !hint || !list || !importButton || !refreshButton) return;
  refreshButton.disabled = false;
  dot.classList.toggle('connected', online);
  if (!online) {
    status.textContent = 'Local Bridge unavailable';
    hint.textContent = error ? 'Start Helm Bridge, then refresh. The browser library was not changed.' : 'Bridge listens at 127.0.0.1:4175.';
    list.innerHTML = '<li><b>No Agent connection</b><small>Helm does not expose the browser library to a network service. The Bridge is a separate loopback process.</small></li>';
    importButton.disabled = true;
    importButton.textContent = 'Import selected artifacts';
    return;
  }
  const pending = pendingAgentInboxDocuments();
  const pendingIds = new Set(pending.map((artifact) => artifact.id));
  selectedAgentInboxIds = new Set([...selectedAgentInboxIds].filter((id) => pendingIds.has(id)));
  const selectedCount = pending.filter((artifact) => selectedAgentInboxIds.has(artifact.id)).length;
  const existing = agentInboxDocuments.length - pending.length;
  status.textContent = pending.length ? `${pending.length} artifact${pending.length === 1 ? '' : 's'} ready for review` : 'Inbox is up to date';
  hint.textContent = existing ? `${existing} already present in this browser and will never be overwritten.` : 'Select the artifacts to import; Bridge never writes the browser library directly.';
  list.innerHTML = pending.length
    ? pending.map((artifact) => `<li><label class="agent-inbox-choice"><input type="checkbox" data-agent-inbox-id="${esc(artifact.id)}"${selectedAgentInboxIds.has(artifact.id) ? ' checked' : ''}><span><b>${esc(artifact.title || artifact.id)}</b><small>${esc(projectFor(artifact).name)} · ${esc(artifact.type || 'reference').toUpperCase()} · ${esc(artifact.source || 'unnamed-agent')} · ${esc(artifact.id)}</small></span></label></li>`).join('')
    : '<li><b>No new artifacts</b><small>When an Agent submits a valid HDOC document, it will appear here for your explicit import.</small></li>';
  list.querySelectorAll('[data-agent-inbox-id]').forEach((input) => input.addEventListener('change', () => {
    const id = input.dataset.agentInboxId;
    if (input.checked) selectedAgentInboxIds.add(id);
    else selectedAgentInboxIds.delete(id);
    renderAgentInbox();
  }));
  importButton.disabled = selectedCount === 0;
  importButton.textContent = selectedCount ? `Import selected (${selectedCount})` : 'Select artifacts to import';
}

async function refreshAgentInbox({ forDialog = false } = {}) {
  const refreshButton = $('#agentInboxRefreshButton');
  if (forDialog) {
    $('#agentInboxStatus').textContent = 'Checking local Bridge…';
    $('#agentInboxHint').textContent = 'Reading only the Bridge inbox; your browser library is unchanged.';
    refreshButton.disabled = true;
  }
  try {
    agentInboxDocuments = await fetchAgentBridgeDocuments();
    updateAgentInboxBadge();
    if (forDialog) renderAgentInbox();
    return true;
  } catch (error) {
    console.info('Helm Bridge is not available.', error);
    agentInboxDocuments = [];
    updateAgentInboxBadge();
    if (forDialog) renderAgentInbox({ online: false, error });
    return false;
  } finally {
    if (refreshButton && !forDialog) refreshButton.disabled = false;
  }
}

async function refreshAgentInboxBadge() {
  await refreshAgentInbox();
}

function openAgentInbox() {
  $('#agentInboxDialog').showModal();
  void refreshAgentInbox({ forDialog: true });
}

async function importAgentInbox() {
  const pending = pendingAgentInboxDocuments().filter((artifact) => selectedAgentInboxIds.has(artifact.id));
  if (!pending.length) { showToast('Select one or more Agent artifacts first.'); return; }
  const takenIds = new Set(documents.map((artifact) => artifact.id));
  const knownSourceIds = sourceIdentitySet();
  const accepted = [];
  const duplicates = [];
  let rejected = 0;
  for (const remote of pending) {
    try {
      const artifact = enrichArtifact({
        id: remote.id,
        sourceDocumentId: remote.source_document_id || remote.id,
        title: remote.title,
        type: remote.type,
        tags: remote.tags,
        summary: remote.summary,
        source: `Agent · ${safeText(remote.source, 'unnamed-agent')}`,
        project: remote.project,
        createdAt: remote.created_at,
        updatedAt: remote.updated_at,
        html: remote.html,
        bridge: { source: remote.source, receivedAt: remote.received_at, sha256: remote.sha256 }
      }, { takenIds, existingSourceIds: knownSourceIds, preserveId: false });
      if (artifact.sourceDocumentId) knownSourceIds.add(artifact.sourceDocumentId);
      (artifact.identityState === 'catalog-copy' ? duplicates : accepted).push(artifact);
    } catch (error) {
      rejected += 1;
      console.warn('A Bridge artifact could not be indexed.', error);
    }
  }
  $('#agentInboxDialog').close();
  pending.forEach((artifact) => selectedAgentInboxIds.delete(artifact.id));
  const afterImport = () => refreshAgentInbox();
  if (duplicates.length) showDuplicateImportResolution(accepted, duplicates, { label: 'Agent artifact', skipped: rejected, afterPersist: afterImport });
  else {
    await persistImportedArtifacts(accepted, { label: 'Agent artifact', skipped: rejected });
    await afterImport();
  }
}

async function renderFolderStatus() {
  const status = $('#folderStatus');
  if (!status) return;
  const helper = globalThis.HelmFolderSync;
  const dot = $('#folderStatusDot');
  const hint = $('#folderStatusHint');
  const choose = $('#chooseFolderButton');
  const sync = $('#syncFolderButton');
  const recover = $('#recoverFolderButton');
  dot.classList.remove('connected');
  sync.disabled = true;
  recover.disabled = false;
  if (!helper?.isSupported?.()) {
    status.textContent = 'Browser library only';
    hint.textContent = 'Portable archive export works everywhere; folder sync needs a Chromium browser with File System Access.';
    choose.disabled = true;
    recover.disabled = true;
    return;
  }
  choose.disabled = false;
  if (!archiveFolderHandle) {
    status.textContent = 'No folder connected';
    hint.textContent = 'Connect a folder, then choose Sync now. Helm never watches or writes in the background.';
    return;
  }
  const permission = await helper.verifyPermission(archiveFolderHandle, { mode: 'readwrite', request: false });
  if (!permission.ok) {
    status.textContent = 'Folder permission needed';
    hint.textContent = 'Use Connect folder to renew access, then explicitly sync or recover.';
    return;
  }
  dot.classList.add('connected');
  status.textContent = 'Folder connected';
  const lastSync = await getSetting('lastFolderSyncAt');
  hint.textContent = lastSync ? `Last explicit sync: ${dateLabel(lastSync)}. Sync only runs when you press the button.` : 'Ready for an explicit sync. Existing Helm files require a second confirmation before replacement.';
  sync.disabled = false;
}

async function chooseArchiveFolder() {
  const helper = globalThis.HelmFolderSync;
  if (!helper?.chooseDirectory) { showToast('Folder sync is unavailable in this browser.'); return; }
  try {
    const selection = await helper.chooseDirectory({ mode: 'readwrite', id: 'helm-archive' });
    if (selection.status === 'cancelled') return;
    if (!selection.ok) throw new Error(selection.failures?.[0]?.message || 'Could not connect that folder.');
    archiveFolderHandle = selection.handle;
    folderReplaceArmed = false;
    $('#syncFolderButton').textContent = 'Sync now';
    await setSetting('archiveFolderHandle', archiveFolderHandle);
    await renderFolderStatus();
    showToast('Folder connected. Nothing has been written yet.');
  } catch (error) {
    console.error(error);
    showToast('Helm could not retain access to that folder.');
  }
}

async function syncArchiveFolder() {
  const helper = globalThis.HelmFolderSync;
  if (!helper?.writeArchive || !archiveFolderHandle) { showToast('Connect a local folder before syncing.'); return; }
  const button = $('#syncFolderButton');
  button.disabled = true;
  try {
    const result = await helper.writeArchive(archiveFolderHandle, archiveRecords(), {
      conflictPolicy: folderReplaceArmed ? 'replace' : 'error',
      requestPermission: true
    });
    if (result.status === 'conflict' && result.requiresExplicitReplace) {
      folderReplaceArmed = true;
      button.textContent = 'Confirm replace';
      showToast('A Helm archive already exists there. Click Confirm replace to update Helm-owned files.');
      return;
    }
    if (!result.ok) throw new Error(result.failures?.[0]?.message || `Folder sync stopped: ${result.status}.`);
    folderReplaceArmed = false;
    button.textContent = 'Sync now';
    await setSetting('lastFolderSyncAt', new Date().toISOString());
    showToast(`${documents.length} artifacts synced to the selected folder.`);
  } catch (error) {
    console.error(error);
    showToast('Folder sync did not finish. Existing folder data was left available for recovery.');
  } finally {
    await renderFolderStatus();
  }
}

async function recoverArchiveFolder() {
  const helper = globalThis.HelmFolderSync;
  if (!helper?.recoverArchive) { showToast('Folder recovery is unavailable in this browser.'); return; }
  if (!archiveFolderHandle) {
    await chooseArchiveFolder();
    if (!archiveFolderHandle) return;
  }
  try {
    const recovery = await helper.recoverArchive(archiveFolderHandle, { requestPermission: true });
    if (!recovery.ok || !recovery.complete) throw new Error(recovery.failures?.[0]?.message || 'The folder archive is incomplete. No browser records were changed.');
    const existingIds = new Set(documents.map((artifact) => artifact.id));
    const takenIds = new Set(existingIds);
    const knownSourceIds = sourceIdentitySet();
    const accepted = [];
    const duplicates = [];
    let sameIdSkipped = 0;
    for (const record of recovery.documents) {
      if (existingIds.has(record.id)) { sameIdSkipped += 1; continue; }
      const artifact = enrichArtifact(record, { takenIds, preserveId: true });
      const sourceConflict = Boolean(artifact.sourceDocumentId && knownSourceIds.has(artifact.sourceDocumentId));
      if (artifact.sourceDocumentId) knownSourceIds.add(artifact.sourceDocumentId);
      if (sourceConflict) {
        artifact.identityState = 'catalog-copy';
        artifact.validation.issues.unshift({ severity: 'warning', code: 'catalog-copy-identity', message: `Source manifest ID “${artifact.sourceDocumentId}” already exists here. This is an explicit catalog copy with library ID “${artifact.id}”; its original HTML was not renamed.` });
        duplicates.push(artifact);
      } else accepted.push(artifact);
    }
    if (duplicates.length) showDuplicateImportResolution(accepted, duplicates, { label: 'recovered artifact', skipped: sameIdSkipped });
    else await persistImportedArtifacts(accepted, { label: 'recovered artifact', skipped: sameIdSkipped });
  } catch (error) {
    console.error(error);
    showToast('Folder recovery could not complete; the browser library was not changed.');
  } finally {
    await renderFolderStatus();
  }
}

function openCreateDialog(template) {
  templateToCreate = template;
  $('#createTitle').textContent = template.title;
  $('#newTitle').value = '';
  $('#newSummary').value = template.summary;
  $('#newTags').value = template.tags.join(', ');
  $('#createDialog').showModal();
  setTimeout(() => $('#newTitle').focus(), 30);
}

async function createFromTemplate() {
  const title = $('#newTitle').value.trim();
  if (!title) return;
  const now = new Date().toISOString();
  const base = { id: `${slug(title)}-${Date.now().toString(36)}`, title, type: templateToCreate.type, tags: $('#newTags').value.split(',').map((tag) => tag.trim()).filter(Boolean), summary: $('#newSummary').value.trim(), source: 'Helm template', project: activeProject === 'all' ? { id: 'helm', name: 'Helm' } : knownProjects().find((project) => project.id === activeProject) || UNASSIGNED_PROJECT, createdAt: now, updatedAt: now };
  const sections = templateToCreate.id === 'research-report'
    ? [['Question and scope', 'State the exact question, audience, decision window, and what this artifact deliberately leaves out.'], ['Short answer', 'Write the decision-relevant conclusion in one or two sentences before adding background.'], ['Evidence ledger', 'Add dated sources, observations, counter-evidence, and the confidence each item earns.'], ['Interpretation and next action', 'Explain what the evidence means, the recommendation it supports, and the condition that would trigger a revisit.'], ['Sources and method', 'Record primary sources, dates, definitions, assumptions, and collection limits.']]
    : templateToCreate.id === 'decision-brief'
      ? [['Decision and deadline', 'Describe the call that needs to be made, the owner, and the non-negotiable constraints.'], ['Recommendation', 'State the selected path in one direct sentence before explaining the alternatives.'], ['Options and comparison', 'Compare realistic alternatives on the same benefits, costs, risks, and evidence.'], ['Action and checkpoint', 'Name the next action, accountable owner, and date or condition for review.'], ['Risk and reversal condition', 'Record the assumption, counter-signal, or new evidence that would reopen the decision.']]
      : [['Pattern in one line', 'Explain the reusable idea in plain language before adding implementation detail.'], ['When to use it', 'State the preconditions, expected benefit, and the case where a simpler alternative is better.'], ['Smallest reliable workflow', 'Describe the fewest dependable steps and the observable result that confirms success.'], ['Caveats and sources', 'Record version sensitivity, constraints, primary sources, and links worth recovering later.']];
  const artifact = enrichArtifact({ ...base, html: articleHtml(base, sections) }, { takenIds: new Set(documents.map((item) => item.id)) });
  await saveDocument(artifact);
  documents.push(artifact);
  selectedId = artifact.id;
  $('#createDialog').close();
  showView('library');
  render();
  showToast('New HDOC artifact added to your local library.');
  openReader(artifact.id);
}

function sourceIdentitySet(records = documents) {
  return new Set(records.map((artifact) => artifact.sourceDocumentId).filter(Boolean));
}

function parseHtmlDocument(html, filename, takenIds, existingSourceIds) {
  return enrichArtifact({ html, source: filename }, { fallbackName: filename.replace(/\.html?$/i, ''), takenIds, existingSourceIds });
}

async function persistImportedArtifacts(artifacts, { label = 'artifact', skipped = 0 } = {}) {
  if (!artifacts.length) {
    if (skipped) showToast(`${skipped} duplicate artifact${skipped === 1 ? '' : 's'} skipped.`);
    return;
  }
  const outcomes = await Promise.allSettled(artifacts.map(saveDocument));
  const saved = artifacts.filter((_, index) => outcomes[index].status === 'fulfilled');
  const failed = artifacts.length - saved.length;
  if (saved.length) {
    documents.push(...saved);
    selectedId = saved.at(-1).id;
    showView('library');
    render();
  }
  if (failed) console.error('Some imported artifacts could not be saved.', outcomes.filter((outcome) => outcome.status === 'rejected'));
  showToast(`${saved.length} ${label}${saved.length === 1 ? '' : 's'} added${skipped ? ` · ${skipped} skipped` : ''}${failed ? ` · ${failed} could not be saved` : ''}.`);
}

function showDuplicateImportResolution(accepted, duplicates, { label = 'artifact', skipped = 0, afterPersist = null } = {}) {
  pendingDuplicateImport = { accepted, duplicates, label, skipped, afterPersist };
  $('#duplicateImportList').innerHTML = duplicates.map((artifact) => `<li><b>${esc(artifact.title)}</b><small>Source manifest ID: ${esc(artifact.sourceDocumentId || 'unknown')} · proposed library ID: ${esc(artifact.id)}</small></li>`).join('');
  $('#duplicateImportDialog').showModal();
}

async function resolveDuplicateImports(keepCopies) {
  const pending = pendingDuplicateImport;
  pendingDuplicateImport = null;
  if (!pending) return;
  if ($('#duplicateImportDialog').open) $('#duplicateImportDialog').close();
  await persistImportedArtifacts(keepCopies ? [...pending.accepted, ...pending.duplicates] : pending.accepted, { label: pending.label, skipped: pending.skipped + (keepCopies ? 0 : pending.duplicates.length) });
  if (pending.afterPersist) await pending.afterPersist();
}

async function importFiles(files) {
  const htmlFiles = [...files].filter((file) => /\.html?$/i.test(file.name) || file.type === 'text/html');
  if (!htmlFiles.length) { showToast('Choose one or more .html files.'); return; }
  const takenIds = new Set(documents.map((artifact) => artifact.id));
  const knownSourceIds = sourceIdentitySet();
  const imported = [];
  const duplicates = [];
  const rejected = [];
  for (const file of htmlFiles) {
    if (file.size > MAX_IMPORT_BYTES) { rejected.push(`${file.name} is larger than 5 MB`); continue; }
    try {
      const artifact = parseHtmlDocument(await file.text(), file.name, takenIds, knownSourceIds);
      if (artifact.sourceDocumentId) knownSourceIds.add(artifact.sourceDocumentId);
      (artifact.identityState === 'catalog-copy' ? duplicates : imported).push(artifact);
    } catch (error) {
      rejected.push(`${file.name} could not be indexed`);
      console.warn(error);
    }
  }
  if (duplicates.length) showDuplicateImportResolution(imported, duplicates, { skipped: rejected.length });
  else if (imported.length) await persistImportedArtifacts(imported, { skipped: rejected.length });
  else showToast(rejected[0] || 'No readable HTML artifacts were added.');
}

function selectedDocument() { return documents.find((artifact) => artifact.id === selectedId); }

function safeReaderSource(html) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: blob:">`;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (head) => `${head}${csp}`);
  return `<!doctype html><html><head><meta charset="utf-8">${csp}</head><body>${html}</body></html>`;
}

function readerDocument() {
  return documents.find((artifact) => artifact.id === readerArtifactId) || selectedDocument();
}

function resetReaderFrame() {
  readerLoadToken += 1;
  clearTimeout(readerSlowTimer);
  readerSlowTimer = null;
  const dialog = $('#readerDialog');
  const frame = $('#readerFrame');
  frame.onload = null;
  frame.onerror = null;
  frame.removeAttribute('srcdoc');
  frame.src = 'about:blank';
  frame.removeAttribute('aria-hidden');
  dialog.classList.remove('is-loading', 'has-error');
  dialog.removeAttribute('aria-busy');
  $('#readerLoading').hidden = true;
  readerArtifactId = null;
}

function openReader(id = selectedId) {
  const artifact = documents.find((item) => item.id === id);
  if (!artifact) return;
  const dialog = $('#readerDialog');
  const frame = $('#readerFrame');
  const loading = $('#readerLoading');
  const token = ++readerLoadToken;
  readerArtifactId = artifact.id;
  clearTimeout(readerSlowTimer);
  $('#readerTitle').textContent = artifact.title;
  $('#readerLoadingTitle').textContent = 'Opening document';
  $('#readerLoadingHint').textContent = 'Preparing preview…';
  loading.hidden = false;
  dialog.classList.remove('has-error');
  dialog.classList.add('is-loading');
  dialog.setAttribute('aria-busy', 'true');
  frame.setAttribute('aria-hidden', 'true');
  if (!dialog.open) dialog.showModal();

  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (token !== readerLoadToken || !dialog.open) return;
    const source = safeReaderSource(artifact.html);
    frame.onload = () => {
      if (token !== readerLoadToken) return;
      clearTimeout(readerSlowTimer);
      readerSlowTimer = null;
      dialog.classList.remove('is-loading');
      dialog.removeAttribute('aria-busy');
      frame.removeAttribute('aria-hidden');
      loading.hidden = true;
    };
    frame.onerror = () => {
      if (token !== readerLoadToken) return;
      clearTimeout(readerSlowTimer);
      dialog.classList.add('has-error');
      $('#readerLoadingTitle').textContent = 'Preview unavailable';
      $('#readerLoadingHint').textContent = 'The original HTML is still available to export.';
    };
    frame.removeAttribute('src');
    frame.srcdoc = source;
    readerSlowTimer = setTimeout(() => {
      if (token === readerLoadToken && dialog.classList.contains('is-loading')) {
        $('#readerLoadingHint').textContent = 'Still rendering…';
      }
    }, 1800);
  }));
}

function downloadDocument(artifact = selectedDocument()) {
  if (!artifact) return;
  const url = URL.createObjectURL(new Blob([artifact.html], { type: 'text/html;charset=utf-8' }));
  const anchor = Object.assign(window.document.createElement('a'), { href: url, download: `${slug(artifact.title)}.html` });
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Original HTML exported.');
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = Object.assign(document.createElement('textarea'), { value });
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    return copied;
  }
}

async function publishDocument(artifact = selectedDocument()) {
  if (!artifact) return;
  const health = artifact.validation || inspectHtml(artifact.html);
  if (!health.valid) { showToast('Repair the HDOC contract before publishing.'); return; }
  const buttons = $$('[data-share-action]');
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const response = await fetch(SHARE_API_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: artifact.html })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.url) throw new Error(payload.errors?.[0] || payload.message || `Share service returned ${response.status}.`);
    const published = { ...artifact, share: { url: payload.url, sha256: payload.sha256, publishedAt: new Date().toISOString() } };
    await saveDocument(published);
    documents = documents.map((item) => item.id === published.id ? published : item);
    renderInspector();
    const copied = await copyText(payload.url);
    showToast(copied ? 'Read-only intranet link copied.' : 'Published; the link is shown in the inspector.');
  } catch (error) {
    console.error(error);
    showToast('This page could not be published to the intranet.');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function archiveRecords() {
  return documents.map(({ contentText, validation, ...record }) => record);
}

async function exportArchive() {
  try {
    const backup = globalThis.HelmArchiveBackup;
    if (!backup) throw new Error('Archive tools are unavailable.');
    const records = archiveRecords();
    if (backup.hasFileSystemAccess()) await backup.saveWithFileSystemAccess(records);
    else backup.downloadArchive(records);
    $('#archiveDialog').close();
    showToast(`${records.length} artifacts exported as a portable archive.`);
  } catch (error) {
    if (error.name !== 'AbortError') { console.error(error); showToast('Archive export could not be completed.'); }
  }
}

async function importArchiveFile(file) {
  try {
    const backup = globalThis.HelmArchiveBackup;
    if (!backup) throw new Error('Archive tools are unavailable.');
    const archive = await backup.readArchiveFile(file);
    const plan = backup.prepareImport(archive, archiveRecords());
    const takenIds = new Set(documents.map((artifact) => artifact.id));
    const knownSourceIds = sourceIdentitySet();
    const accepted = [];
    const duplicates = [];
    for (const artifact of plan.acceptedDocuments) {
      const enriched = enrichArtifact(artifact, { takenIds, preserveId: true });
      const sourceConflict = Boolean(enriched.sourceDocumentId && knownSourceIds.has(enriched.sourceDocumentId));
      if (enriched.sourceDocumentId) knownSourceIds.add(enriched.sourceDocumentId);
      if (sourceConflict) {
        enriched.identityState = 'catalog-copy';
        enriched.validation.issues.unshift({ severity: 'warning', code: 'catalog-copy-identity', message: `Source manifest ID “${enriched.sourceDocumentId}” already exists here. This is an explicit catalog copy with library ID “${enriched.id}”; its original HTML was not renamed.` });
        duplicates.push(enriched);
      } else accepted.push(enriched);
    }
    $('#archiveDialog').close();
    if (duplicates.length) showDuplicateImportResolution(accepted, duplicates, { label: 'archive artifact', skipped: plan.skippedCount });
    else await persistImportedArtifacts(accepted, { label: 'archive artifact', skipped: plan.skippedCount });
  } catch (error) {
    console.error(error);
    showToast('That file is not a valid Helm archive.');
  }
}

function openMetadataDialog() {
  const artifact = selectedDocument();
  if (!artifact) return;
  editingId = artifact.id;
  $('#catalogTitle').value = artifact.title;
  $('#catalogType').value = artifact.type;
  $('#catalogSummary').value = artifact.summary;
  $('#catalogTags').value = artifact.tags.join(', ');
  $('#catalogSource').value = artifact.source;
  $('#catalogProject').value = projectFor(artifact).id === UNASSIGNED_PROJECT.id ? '' : projectFor(artifact).name;
  $('#metadataDialog').showModal();
}

async function saveCatalogMetadata() {
  const artifact = documents.find((item) => item.id === editingId);
  const title = $('#catalogTitle').value.trim();
  if (!artifact || !title) return;
  const type = $('#catalogType').value;
  const updated = {
    ...artifact,
    title: title.slice(0, 100),
    type: DOCUMENT_TYPES.has(type) ? type : artifact.type,
    summary: $('#catalogSummary').value.trim().slice(0, 240),
    tags: normaliseTags($('#catalogTags').value),
    source: $('#catalogSource').value.trim().slice(0, 120) || 'Personal archive',
    project: normaliseProject($('#catalogProject').value),
    catalogUpdatedAt: new Date().toISOString()
  };
  await saveDocument(updated);
  documents = documents.map((item) => item.id === updated.id ? updated : item);
  selectedId = updated.id;
  editingId = null;
  $('#metadataDialog').close();
  render();
  showToast('Catalog metadata saved. Original HTML is unchanged.');
}

async function repairSelected() {
  const artifact = selectedDocument();
  const repair = globalThis.HelmRepair;
  if (!artifact || !repair?.createCompliantCopy) return;
  try {
    const result = repair.createCompliantCopy(artifact, { existingIds: new Set(documents.map((item) => item.id)) });
    const repaired = enrichArtifact(result.record, { takenIds: new Set(documents.map((item) => item.id)), preserveId: true });
    if (!repaired.validation.valid) throw new Error('The generated compliant copy did not pass validation.');
    await saveDocument(repaired);
    documents.push(repaired);
    selectedId = repaired.id;
    render();
    showToast('A new compliant copy was created. The original is unchanged.');
  } catch (error) {
    console.error(error);
    showToast('A compliant copy could not be created.');
  }
}

async function deleteSelected() {
  const artifact = selectedDocument();
  if (!artifact) return;
  const lastFolderSync = await getSetting('lastFolderSyncAt');
  const backupHint = lastFolderSync ? ` A folder sync was recorded on ${dateLabel(lastFolderSync)}; export or sync again if this change should be recoverable.` : ' No completed folder sync is recorded for this browser library.';
  if (!confirm(`Remove “${artifact.title}” from this browser? The original file will not be touched.${backupHint}`)) return;
  await removeDocument(artifact.id);
  documents = documents.filter((item) => item.id !== artifact.id);
  selectedId = documents[0]?.id || null;
  render();
  showToast('Artifact removed from this browser.');
}

function wireEvents() {
  $$('[data-theme-mode]').forEach((button) => button.addEventListener('click', () => setAppearance(button.dataset.themeMode, true)));
  $('#importButton').addEventListener('click', () => $('#fileInput').click());
  $('#agentInboxButton').addEventListener('click', openAgentInbox);
  $('#agentInboxRefreshButton').addEventListener('click', () => { void refreshAgentInbox({ forDialog: true }); });
  $('#agentInboxImportButton').addEventListener('click', importAgentInbox);
  $$('[data-close-agent-inbox]').forEach((button) => button.addEventListener('click', () => $('#agentInboxDialog').close()));
  $('[data-empty-import]').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', async (event) => { await importFiles(event.target.files); event.target.value = ''; });
  $('#archiveButton').addEventListener('click', async () => { $('#archiveDocumentCount').textContent = String(documents.length).padStart(2, '0'); await renderFolderStatus(); $('#archiveDialog').showModal(); });
  $('#archiveExportButton').addEventListener('click', exportArchive);
  $('#archiveImportButton').addEventListener('click', () => $('#archiveInput').click());
  $('#archiveInput').addEventListener('change', async (event) => { if (event.target.files[0]) await importArchiveFile(event.target.files[0]); event.target.value = ''; });
  $('[data-close-archive]').addEventListener('click', () => $('#archiveDialog').close());
  $('#chooseFolderButton').addEventListener('click', chooseArchiveFolder);
  $('#syncFolderButton').addEventListener('click', syncArchiveFolder);
  $('#recoverFolderButton').addEventListener('click', recoverArchiveFolder);
  $('#templateButton').addEventListener('click', () => openCreateDialog(templates[0]));
  $('#readContract').addEventListener('click', () => showView('contract'));
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  $$('.filter').forEach((button) => button.addEventListener('click', () => { activeFilter = button.dataset.filter; $$('.filter').forEach((filter) => filter.classList.toggle('active', filter === button)); renderLibrary(); }));
  $('#clearLibraryFilters').addEventListener('click', () => { activeFilter = 'all'; activeProject = 'all'; $('#searchInput').value = ''; $$('.filter').forEach((filter) => filter.classList.toggle('active', filter.dataset.filter === 'all')); render(); });
  $('#searchInput').addEventListener('input', renderLibrary);
  $('#sortSelect').addEventListener('change', renderLibrary);
  $$('[data-close-create]').forEach((button) => button.addEventListener('click', () => $('#createDialog').close()));
  $('#createForm').addEventListener('submit', (event) => {
    event.preventDefault();
    createFromTemplate();
  });
  $('#previewButton').addEventListener('click', () => openReader());
  $('#exportButton').addEventListener('click', () => downloadDocument());
  $('#shareButton').addEventListener('click', () => publishDocument());
  $('#readerShare').addEventListener('click', () => publishDocument(readerDocument()));
  $('#readerExport').addEventListener('click', () => downloadDocument(readerDocument()));
  $('#closeReader').addEventListener('click', () => $('#readerDialog').close());
  $('#readerDialog').addEventListener('close', resetReaderFrame);
  $('#editMetadataButton').addEventListener('click', openMetadataDialog);
  $$('[data-close-metadata]').forEach((button) => button.addEventListener('click', () => { editingId = null; $('#metadataDialog').close(); }));
  $('#metadataForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveCatalogMetadata();
  });
  $('#repairButton').addEventListener('click', repairSelected);
  $('#duplicateImportForm').addEventListener('submit', (event) => { event.preventDefault(); resolveDuplicateImports(event.submitter?.id === 'keepDuplicateImports'); });
  $('#duplicateImportDialog').addEventListener('cancel', (event) => { event.preventDefault(); resolveDuplicateImports(false); });
  $('#deleteButton').addEventListener('click', deleteSelected);
  $('#closeInspector').addEventListener('click', () => { selectedId = null; renderLibrary(); renderInspector(); });
  $('#openShortcuts').addEventListener('click', () => $('#shortcutsDialog').showModal());
  $('[data-close-shortcuts]').addEventListener('click', () => $('#shortcutsDialog').close());
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      if (event.key.toLowerCase() === 'n') openCreateDialog(templates[0]);
      if (event.key.toLowerCase() === 'i') $('#fileInput').click();
    }
  });
}

wireEvents();
initialise();
