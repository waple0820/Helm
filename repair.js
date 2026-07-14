/*
 * Helm compliant-copy repair helper.
 *
 * This module is intentionally pure: it reads one HTML record, creates a new
 * HDOC/1.0 record, and returns it. It never talks to IndexedDB, localStorage,
 * the network, or the DOM outside the DOMParser used to read the source.
 */
(function attachHelmRepair(root, factory) {
  const api = factory(root);
  if (root) root.HelmRepair = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createHelmRepair(root) {
  'use strict';

  const SCHEMA_VERSION = 'HDOC/1.0';
  const DOCUMENT_TYPES = new Set(['report', 'brief', 'reference', 'dashboard', 'note']);
  const DROP_ELEMENTS = new Set([
    'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
    'object', 'embed', 'form', 'button', 'input', 'select', 'textarea',
    'details', 'dialog', 'audio', 'video', 'source', 'track'
  ]);
  const INLINE_ELEMENTS = new Set(['em', 'strong', 'b', 'i', 'code', 'kbd', 'mark', 'small', 'sub', 'sup', 'span']);
  const MAX_CONTENT_CHARS = 120000;

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
  }

  function scriptJson(value) {
    return JSON.stringify(value, null, 2)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
  }

  function slugify(value, fallback) {
    const slug = String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 54);
    return slug || fallback;
  }

  function timestamp(value) {
    const candidate = value instanceof Date ? value : new Date(value || Date.now());
    return Number.isNaN(candidate.valueOf()) ? new Date().toISOString() : candidate.toISOString();
  }

  function textFromMeta(document, name) {
    return cleanText(document.querySelector(`meta[name="${name}"]`)?.getAttribute('content'));
  }

  function parseManifest(document) {
    const node = document.querySelector('script[type="application/json"][data-helm-manifest], script[data-helm-manifest]');
    if (!node) return {};
    try {
      const parsed = JSON.parse(node.textContent || '');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function readableContainer(document) {
    return document.querySelector('main[data-document-root], main, article, [role="main"], body');
  }

  function firstReadableTitle(container) {
    return cleanText(container?.querySelector('h1, h2, h3, h4, h5, h6')?.textContent);
  }

  function pickTitle(record, manifest, document, container, options) {
    const candidate = options.title || record.title || manifest.title || textFromMeta(document, 'helm:title')
      || cleanText(document.querySelector('title')?.textContent) || firstReadableTitle(container) || 'Recovered HTML artifact';
    return cleanText(candidate).slice(0, 100) || 'Recovered HTML artifact';
  }

  function pickType(record, manifest, document, options) {
    const candidate = cleanText(options.type || record.type || manifest.type || textFromMeta(document, 'helm:type')).toLowerCase();
    return DOCUMENT_TYPES.has(candidate) ? candidate : 'reference';
  }

  function normaliseTags(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(',');
    const tags = [];
    const seen = new Set();
    values.forEach((valueItem) => {
      const tag = slugify(cleanText(valueItem), '').slice(0, 40);
      if (tag && !seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
    });
    return tags.slice(0, 8);
  }

  function pickTags(record, manifest, document, options) {
    const supplied = options.tags ?? record.tags ?? manifest.tags ?? textFromMeta(document, 'helm:tags');
    const tags = normaliseTags(supplied);
    return tags.length ? tags : ['repaired'];
  }

  function pickSummary(record, manifest, document, container, title, sourceLabel, options) {
    const firstParagraph = cleanText(container?.querySelector('p')?.textContent);
    const candidate = options.summary || record.summary || manifest.summary || textFromMeta(document, 'helm:summary') || firstParagraph
      || `A compliant copy of ${title} recovered from ${sourceLabel}.`;
    return cleanText(candidate).slice(0, 240) || `A compliant copy of ${title}.`;
  }

  function pickProject(record, manifest) {
    const candidate = record.project || manifest.project;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const id = cleanText(candidate.id);
    const name = cleanText(candidate.name);
    return /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(id) && name ? { id: id.slice(0, 100), name: name.slice(0, 100) } : null;
  }

  function collectedIds(existingIds) {
    if (existingIds instanceof Set) return new Set(existingIds);
    if (Array.isArray(existingIds)) return new Set(existingIds);
    return new Set();
  }

  function randomAscii() {
    if (root?.crypto?.getRandomValues) {
      const bytes = new Uint32Array(2);
      root.crypto.getRandomValues(bytes);
      return `${bytes[0].toString(36)}${bytes[1].toString(36)}`;
    }
    return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }

  function uniqueId(record, title, options) {
    const taken = collectedIds(options.existingIds);
    if (typeof record.id === 'string') taken.add(record.id);
    const requested = slugify(options.id || options.idPrefix || title, 'artifact');
    const base = `${requested}-compliant-copy`.slice(0, 72).replace(/-+$/g, '');
    let id = `${base}-${Date.now().toString(36)}-${randomAscii().slice(0, 12)}`.replace(/-+/g, '-');
    let attempt = 2;
    while (taken.has(id)) {
      id = `${base}-${Date.now().toString(36)}-${randomAscii().slice(0, 12)}-${attempt}`.replace(/-+/g, '-');
      attempt += 1;
    }
    return id;
  }

  function safeHref(value) {
    const href = String(value || '').trim();
    return /^(?:https?:|mailto:|tel:|#)/i.test(href) ? href : '';
  }

  function inlineHtml(node) {
    if (!node) return '';
    if (node.nodeType === 3) return escapeHtml(node.nodeValue);
    if (node.nodeType !== 1 || DROP_ELEMENTS.has(node.tagName.toLowerCase())) return '';
    const tag = node.tagName.toLowerCase();
    const children = [...node.childNodes].map(inlineHtml).join('');
    if (tag === 'br') return '<br>';
    if (tag === 'a') {
      const href = safeHref(node.getAttribute('href'));
      return href && cleanText(node.textContent) ? `<a href="${escapeHtml(href)}">${children}</a>` : children;
    }
    if (INLINE_ELEMENTS.has(tag)) {
      const safeTag = tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag;
      return `<${safeTag}>${children}</${safeTag}>`;
    }
    return children;
  }

  function listHtml(list) {
    const tag = list.tagName.toLowerCase() === 'ol' ? 'ol' : 'ul';
    const items = [...list.children]
      .filter((child) => child.tagName?.toLowerCase() === 'li')
      .map((item) => {
        const inline = [...item.childNodes]
          .filter((child) => !(child.nodeType === 1 && ['ul', 'ol'].includes(child.tagName.toLowerCase())))
          .map(inlineHtml).join('');
        const nested = [...item.children]
          .filter((child) => ['ul', 'ol'].includes(child.tagName.toLowerCase()))
          .map(listHtml).join('');
        return `<li>${inline || escapeHtml(cleanText(item.textContent))}${nested}</li>`;
      }).join('');
    return items ? `<${tag}>${items}</${tag}>` : '';
  }

  function tableHtml(table) {
    const caption = cleanText(table.querySelector(':scope > caption')?.textContent);
    const rows = [...table.querySelectorAll('tr')].filter((row) => !row.closest('table') || row.closest('table') === table);
    const serialisedRows = rows.map((row, rowIndex) => {
      const cells = [...row.children].filter((cell) => ['td', 'th'].includes(cell.tagName.toLowerCase()));
      if (!cells.length) return '';
      return cells.map((cell) => {
        const header = rowIndex === 0 || cell.tagName.toLowerCase() === 'th';
        const tag = header ? 'th' : 'td';
        const span = ['colspan', 'rowspan'].map((attribute) => {
          const value = Number(cell.getAttribute(attribute));
          return Number.isInteger(value) && value > 1 ? ` ${attribute}="${value}"` : '';
        }).join('');
        return `<${tag}${span}>${inlineHtml(cell) || escapeHtml(cleanText(cell.textContent))}</${tag}>`;
      }).join('');
    }).filter(Boolean);
    if (!serialisedRows.length) return '';
    const header = `<thead><tr>${serialisedRows[0]}</tr></thead>`;
    const body = serialisedRows.length > 1 ? `<tbody>${serialisedRows.slice(1).map((row) => `<tr>${row}</tr>`).join('')}</tbody>` : '';
    return `<table>${caption ? `<caption>${escapeHtml(caption)}</caption>` : ''}${header}${body}</table>`;
  }

  function definitionListHtml(list) {
    const items = [...list.children].filter((node) => ['dt', 'dd'].includes(node.tagName?.toLowerCase())).map((node) => {
      const tag = node.tagName.toLowerCase();
      return `<${tag}>${inlineHtml(node) || escapeHtml(cleanText(node.textContent))}</${tag}>`;
    }).join('');
    return items ? `<dl>${items}</dl>` : '';
  }

  function extractContent(container) {
    const fragments = [];
    let lastHeading = 1;
    let characterCount = 0;

    function append(fragment) {
      if (!fragment || characterCount >= MAX_CONTENT_CHARS) return;
      characterCount += cleanText(fragment).length;
      fragments.push(fragment);
    }

    function walk(node) {
      if (!node || characterCount >= MAX_CONTENT_CHARS) return;
      if (node.nodeType === 3) {
        const text = cleanText(node.nodeValue);
        if (text) append(`<p>${escapeHtml(text)}</p>`);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (DROP_ELEMENTS.has(tag)) return;
      if (/^h[1-6]$/.test(tag)) {
        const text = cleanText(node.textContent);
        if (!text) return;
        const originalLevel = Number(tag.slice(1));
        const level = Math.min(6, Math.max(2, Math.min(originalLevel, lastHeading + 1)));
        lastHeading = level;
        append(`<h${level}>${escapeHtml(text)}</h${level}>`);
        return;
      }
      if (tag === 'p') {
        const content = inlineHtml(node);
        if (cleanText(node.textContent)) append(`<p>${content || escapeHtml(cleanText(node.textContent))}</p>`);
        return;
      }
      if (tag === 'blockquote') {
        const content = inlineHtml(node);
        if (cleanText(node.textContent)) append(`<blockquote><p>${content || escapeHtml(cleanText(node.textContent))}</p></blockquote>`);
        return;
      }
      if (tag === 'pre') {
        const text = node.textContent || '';
        if (cleanText(text)) append(`<pre><code>${escapeHtml(text)}</code></pre>`);
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        append(listHtml(node));
        return;
      }
      if (tag === 'table') {
        append(tableHtml(node));
        return;
      }
      if (tag === 'dl') {
        append(definitionListHtml(node));
        return;
      }
      if (tag === 'img') {
        const alt = cleanText(node.getAttribute('alt'));
        if (alt) append(`<p class="image-description">Image description: ${escapeHtml(alt)}</p>`);
        return;
      }
      [...node.childNodes].forEach(walk);
    }

    [...(container?.childNodes || [])].forEach(walk);
    const recovered = fragments.join('');
    if (cleanText(recovered)) return recovered;
    const fallback = cleanText(container?.textContent).slice(0, MAX_CONTENT_CHARS);
    return `<p>${escapeHtml(fallback || 'No readable source content could be recovered from this artifact.')}</p>`;
  }

  function cleanLang(value) {
    const lang = cleanText(value);
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang) ? lang : 'en';
  }

  function buildHtml({ id, title, type, tags, summary, createdAt, sourceId, sourceLabel, lang, manifest, content }) {
    const styles = 'body{margin:0;background:#f4f3ef;color:#17202a;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65}main{max-width:780px;margin:0 auto;padding:72px 28px 96px}.eyebrow{margin:0 0 20px;color:#697681;font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em}.rule{width:44px;height:2px;background:#e85b40;margin:0 0 28px}h1,h2,h3,h4,h5,h6{color:#18202a;font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.03em;line-height:1.15}h1{max-width:700px;margin:0;font-size:clamp(2.45rem,7vw,4.35rem)}h2{margin:2.7rem 0 .65rem;font-size:1.7rem}h3{margin:2rem 0 .5rem;font-size:1.25rem}p,li,dd,td,th{font-size:1rem}p{max-width:700px;color:#44515b}a{color:#1c5f7a}ul,ol{padding-left:1.4rem}li+li{margin-top:.35rem}blockquote{margin:1.5rem 0;padding:.2rem 0 .2rem 1.1rem;border-left:2px solid #e85b40;color:#47545d}pre{overflow:auto;padding:1rem;background:#e9e9e4;border:1px solid #d6d8d2;border-radius:4px}table{width:100%;border-collapse:collapse;margin:1.3rem 0}caption{text-align:left;margin-bottom:.45rem;color:#5f6a72}th,td{padding:.6rem;text-align:left;vertical-align:top;border-bottom:1px solid #d6d8d2}th{color:#26333c;background:#eaebe6}.summary{max-width:680px;font-size:1.08rem}.tags{display:flex;flex-wrap:wrap;gap:.45rem;margin:1.35rem 0 2.4rem}.tags span{border:1px solid #d6d8d2;border-radius:999px;padding:.2rem .55rem;color:#56636b;font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace}.provenance{margin-top:3rem;padding-top:1.2rem;border-top:1px solid #d6d8d2}.provenance p{font-size:.9rem}.image-description{color:#5a6972;font-style:italic}';
    const tagHtml = tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="helm:title" content="${escapeHtml(title)}"><meta name="helm:type" content="${escapeHtml(type)}"><meta name="helm:summary" content="${escapeHtml(summary)}"><meta name="helm:tags" content="${escapeHtml(tags.join(', '))}"><title>${escapeHtml(title)}</title><style>${styles}</style><script type="application/json" data-helm-manifest>${scriptJson(manifest)}</script></head><body><main data-document-root><header><p class="eyebrow">${escapeHtml(type.toUpperCase())} · COMPLIANT COPY · ${escapeHtml(createdAt.slice(0, 10))}</p><div class="rule"></div><h1>${escapeHtml(title)}</h1><p class="summary">${escapeHtml(summary)}</p><div class="tags" aria-label="Document tags">${tagHtml}</div></header><article>${content}</article><section class="provenance"><h2>Provenance</h2><p>This is a non-destructive HDOC/1.0 compliant copy derived from source artifact <strong>${escapeHtml(sourceLabel)}</strong>${sourceId ? ` (ID: <code>${escapeHtml(sourceId)}</code>)` : ''}. The original source was not altered.</p></section></main></body></html>`;
  }

  /**
   * Create a new, sanitised HDOC/1.0 record from an existing HTML record.
   *
   * Options: title, type, tags, summary, author, lang, id, idPrefix,
   * existingIds (Set or array), and now (Date or timestamp) are supported.
   * This function is deliberately non-persistent; callers decide whether to
   * save the returned record.
   */
  function createCompliantCopy(record, options = {}) {
    if (!record || typeof record !== 'object' || typeof record.html !== 'string') {
      throw new TypeError('HelmRepair.createCompliantCopy requires a record with its original HTML in record.html.');
    }
    const Parser = options.DOMParser || root?.DOMParser;
    if (typeof Parser !== 'function') {
      throw new Error('HelmRepair.createCompliantCopy requires a DOMParser implementation.');
    }

    const sourceDocument = new Parser().parseFromString(record.html, 'text/html');
    const sourceManifest = parseManifest(sourceDocument);
    const sourceContainer = readableContainer(sourceDocument);
    const sourceId = cleanText(record.sourceDocumentId || sourceManifest.id || record.id);
    const sourceLabel = cleanText(record.title || sourceManifest.title || textFromMeta(sourceDocument, 'helm:title')
      || cleanText(sourceDocument.querySelector('title')?.textContent) || sourceId || 'unnamed source artifact');
    const title = pickTitle(record, sourceManifest, sourceDocument, sourceContainer, options);
    const type = pickType(record, sourceManifest, sourceDocument, options);
    const tags = pickTags(record, sourceManifest, sourceDocument, options);
    const createdAt = timestamp(options.now);
    const id = uniqueId(record, title, options);
    const summary = pickSummary(record, sourceManifest, sourceDocument, sourceContainer, title, sourceLabel, options);
    const project = pickProject(record, sourceManifest);
    const lang = cleanLang(options.lang || sourceDocument.documentElement?.getAttribute('lang'));
    const manifest = {
      schema_version: SCHEMA_VERSION,
      id,
      title,
      type,
      tags,
      summary,
      created_at: createdAt,
      updated_at: createdAt,
      ...(project ? { project } : {}),
      provenance: {
        author: cleanText(options.author) || 'Helm compliant-copy repair',
        sources: [],
        derived_from: {
          kind: 'local-artifact',
          id: sourceId || null,
          title: sourceLabel,
          repaired_at: createdAt
        }
      }
    };
    const content = extractContent(sourceContainer);
    const html = buildHtml({ id, title, type, tags, summary, createdAt, sourceId, sourceLabel, lang, manifest, content });
    let validation = null;
    let validationStatus = 'unavailable';
    if (root?.HelmValidator?.validate) {
      validation = root.HelmValidator.validate(html, { DOMParser: Parser });
      validationStatus = 'validated';
    }
    const contentText = cleanText(new Parser().parseFromString(html, 'text/html').querySelector('main[data-document-root]')?.textContent);
    const outputRecord = {
      id,
      title,
      type,
      tags: [...tags],
      summary,
      source: `Helm repair from ${sourceLabel}`,
      ...(project ? { project } : {}),
      createdAt,
      updatedAt: createdAt,
      derivedFrom: { id: sourceId || null, title: sourceLabel },
      html,
      contentText,
      validation
    };
    const report = {
      operation: 'compliant-copy-repair',
      source: { id: sourceId || null, title: sourceLabel },
      output: { id, title, schemaVersion: SCHEMA_VERSION },
      validationStatus,
      valid: validation ? validation.valid : null,
      issues: validation?.issues || [],
      limitations: [
        'The helper preserves readable text and basic structure, not the source layout, scripts, interactive behavior, media, or external assets.',
        'Complex nested layouts, charts, and image-only meaning may need manual reconstruction after repair.',
        'No storage is written. Saving the returned record remains the caller’s responsibility.'
      ]
    };
    return { record: outputRecord, report };
  }

  return Object.freeze({ SCHEMA_VERSION, createCompliantCopy });
}));
