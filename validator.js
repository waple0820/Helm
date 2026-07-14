/*
 * Helm document-contract validator.
 *
 * This file deliberately has no dependencies. In a browser it exposes
 * window.HelmValidator; CommonJS consumers can require it when they provide a
 * DOMParser implementation (for example from a DOM test environment).
 */
(function attachHelmValidator(root, factory) {
  const api = factory(root);
  if (root) root.HelmValidator = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createHelmValidator(root) {
  'use strict';

  const SCHEMA_VERSION = 'HDOC/1.0';
  // Increment when validation semantics change so stored revisions can refresh
  // their derived health report without changing immutable HTML bytes.
  const VALIDATOR_VERSION = 2;
  const DOCUMENT_TYPES = new Set(['report', 'brief', 'reference', 'dashboard', 'note']);
  const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  const ID_PATTERN = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;
  const GENERIC_LINK_TEXT = new Set(['click here', 'here', 'link', 'more', 'read more', 'this']);
  const SEVERITY_WEIGHT = { error: 12, warning: 4, info: 0 };

  function issue(issues, code, severity, message, location) {
    issues.push({ code, severity, message, ...(location ? { location } : {}) });
  }

  function normalizedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isUtcTimestamp(value) {
    return typeof value === 'string' && UTC_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
  }

  function isDate(value) {
    if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }

  function isRemoteUrl(value) {
    return /^(?:https?:)?\/\//i.test(value || '');
  }

  function isDataOrFragmentUrl(value) {
    return /^(?:data:|#)/i.test((value || '').trim());
  }

  function isLikelyRelativeUrl(value) {
    const url = (value || '').trim();
    return Boolean(url) && !isRemoteUrl(url) && !isDataOrFragmentUrl(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url);
  }

  function visibleText(element) {
    if (!element) return '';
    const clone = element.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, template, svg').forEach((node) => node.remove());
    return normalizedText(clone.textContent);
  }

  function metaValues(document, name) {
    return [...document.querySelectorAll('meta')]
      .filter((node) => (node.getAttribute('name') || '').toLowerCase() === name)
      .map((node) => (node.getAttribute('content') || '').trim());
  }

  function validateManifest(manifest, issues) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return;

    if (manifest.schema_version !== SCHEMA_VERSION) {
      issue(issues, 'manifest-schema-version', 'error', `Set manifest.schema_version to exactly \`${SCHEMA_VERSION}\`.`, 'manifest.schema_version');
    }

    if (typeof manifest.id !== 'string' || !ID_PATTERN.test(manifest.id)) {
      issue(issues, 'manifest-id', 'error', 'Set manifest.id to a stable lowercase identifier using letters, numbers, and hyphens.', 'manifest.id');
    }

    if (typeof manifest.title !== 'string' || !manifest.title.trim()) {
      issue(issues, 'manifest-title', 'error', 'Add a non-empty manifest.title that a person can recognize.', 'manifest.title');
    } else if (manifest.title.length > 100) {
      issue(issues, 'manifest-title-length', 'error', 'Shorten manifest.title to 100 characters or fewer.', 'manifest.title');
    }

    if (!DOCUMENT_TYPES.has(manifest.type)) {
      issue(issues, 'manifest-type', 'error', 'Set manifest.type to report, brief, reference, dashboard, or note.', 'manifest.type');
    }

    if (!Array.isArray(manifest.tags)) {
      issue(issues, 'manifest-tags', 'error', 'Set manifest.tags to an array of zero to eight concise lowercase tags.', 'manifest.tags');
    } else {
      if (manifest.tags.length > 8) {
        issue(issues, 'manifest-tags-count', 'error', 'Keep manifest.tags to at most eight tags.', 'manifest.tags');
      }
      const seenTags = new Set();
      manifest.tags.forEach((tag, index) => {
        const location = `manifest.tags[${index}]`;
        if (typeof tag !== 'string' || !tag.trim() || tag.length > 40) {
          issue(issues, 'manifest-tag-format', 'error', 'Use a non-empty tag of 40 characters or fewer.', location);
          return;
        }
        if (tag !== tag.toLowerCase()) {
          issue(issues, 'manifest-tag-case', 'warning', 'Use lowercase tags so filtering remains consistent.', location);
        }
        const key = tag.trim().toLowerCase();
        if (seenTags.has(key)) issue(issues, 'manifest-tag-duplicate', 'warning', `Remove duplicate tag \`${tag}\`.`, location);
        seenTags.add(key);
      });
    }

    if (typeof manifest.summary !== 'string' || !manifest.summary.trim()) {
      issue(issues, 'manifest-summary', 'error', 'Add a concise, decision-relevant manifest.summary.', 'manifest.summary');
    } else if (manifest.summary.length > 240) {
      issue(issues, 'manifest-summary-length', 'error', 'Shorten manifest.summary to 240 characters or fewer.', 'manifest.summary');
    }

    if (manifest.project !== undefined) {
      if (!manifest.project || typeof manifest.project !== 'object' || Array.isArray(manifest.project)) {
        issue(issues, 'manifest-project', 'error', 'When present, manifest.project must contain a stable id and a human-readable name.', 'manifest.project');
      } else {
        if (typeof manifest.project.id !== 'string' || !ID_PATTERN.test(manifest.project.id) || manifest.project.id.length > 100) {
          issue(issues, 'manifest-project-id', 'error', 'Set manifest.project.id to a stable lowercase identifier using letters, numbers, and hyphens.', 'manifest.project.id');
        }
        if (typeof manifest.project.name !== 'string' || !manifest.project.name.trim() || manifest.project.name.length > 100) {
          issue(issues, 'manifest-project-name', 'error', 'Set manifest.project.name to a recognizable workspace name of 100 characters or fewer.', 'manifest.project.name');
        }
      }
    }

    ['created_at', 'updated_at'].forEach((field) => {
      if (!isUtcTimestamp(manifest[field])) {
        issue(issues, `manifest-${field}`, 'error', `Set manifest.${field} to an ISO 8601 timestamp in UTC, for example 2026-07-13T00:00:00Z.`, `manifest.${field}`);
      }
    });
    if (isUtcTimestamp(manifest.created_at) && isUtcTimestamp(manifest.updated_at)
      && Date.parse(manifest.updated_at) < Date.parse(manifest.created_at)) {
      issue(issues, 'manifest-timestamp-order', 'error', 'Set manifest.updated_at to the same time as or later than manifest.created_at.', 'manifest.updated_at');
    }

    if (!manifest.provenance || typeof manifest.provenance !== 'object' || Array.isArray(manifest.provenance)) {
      issue(issues, 'manifest-provenance', 'error', 'Add manifest.provenance with an author and a sources array.', 'manifest.provenance');
      return;
    }
    if (typeof manifest.provenance.author !== 'string' || !manifest.provenance.author.trim()) {
      issue(issues, 'manifest-provenance-author', 'error', 'Name the person, project, or agent in manifest.provenance.author.', 'manifest.provenance.author');
    }
    if (!Array.isArray(manifest.provenance.sources)) {
      issue(issues, 'manifest-provenance-sources', 'error', 'Set manifest.provenance.sources to an array; use [] for original writing without external sources.', 'manifest.provenance.sources');
      return;
    }
    manifest.provenance.sources.forEach((source, index) => {
      const location = `manifest.provenance.sources[${index}]`;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        issue(issues, 'manifest-source-format', 'error', 'Use a source object with label, url, and accessed_at fields.', location);
        return;
      }
      if (typeof source.label !== 'string' || !source.label.trim()) {
        issue(issues, 'manifest-source-label', 'warning', 'Add a human-readable label for this source.', `${location}.label`);
      }
      if (typeof source.url !== 'string' || !/^https?:\/\//i.test(source.url.trim())) {
        issue(issues, 'manifest-source-url', 'warning', 'Add an absolute http(s) URL for this source.', `${location}.url`);
      }
      if (!isDate(source.accessed_at)) {
        issue(issues, 'manifest-source-accessed-at', 'warning', 'Add the source access date as YYYY-MM-DD.', `${location}.accessed_at`);
      }
    });
  }

  function validateMetadata(document, manifest, issues) {
    const expected = {
      'helm:title': manifest && manifest.title,
      'helm:type': manifest && manifest.type,
      'helm:summary': manifest && manifest.summary,
      'helm:tags': manifest && Array.isArray(manifest.tags) ? manifest.tags.join(', ') : undefined
    };

    Object.entries(expected).forEach(([name, expectedValue]) => {
      const values = metaValues(document, name);
      if (!values.length) {
        issue(issues, 'metadata-missing', 'error', `Add \`<meta name="${name}" content="…">\` so simple indexers can read the artifact.`, `meta[name="${name}"]`);
        return;
      }
      if (values.length > 1) {
        issue(issues, 'metadata-duplicate', 'warning', `Keep only one \`${name}\` meta element to avoid ambiguous indexing.`, `meta[name="${name}"]`);
      }
      const tagMetadataMatches = name !== 'helm:tags' || !Array.isArray(manifest?.tags)
        || values[0].split(',').map((tag) => tag.trim()).filter(Boolean).join('\u0000') === manifest.tags.join('\u0000');
      if (expectedValue !== undefined && (name === 'helm:tags' ? !tagMetadataMatches : values[0] !== expectedValue)) {
        issue(issues, 'metadata-mismatch', 'error', `Make \`${name}\` match the corresponding manifest value.`, `meta[name="${name}"]`);
      }
    });

    const title = normalizedText(document.querySelector('title')?.textContent);
    if (!title) {
      issue(issues, 'document-title', 'warning', 'Add a <title> so the exported artifact has a useful browser and file label.', 'title');
    } else if (manifest?.title && title !== manifest.title) {
      issue(issues, 'document-title-mismatch', 'warning', 'Make <title> match manifest.title to keep export labels consistent.', 'title');
    }
  }

  function validateStructure(document, issues) {
    if (!document.doctype || document.doctype.name.toLowerCase() !== 'html') {
      issue(issues, 'doctype', 'error', 'Begin the artifact with <!doctype html>.', 'doctype');
    }
    const html = document.documentElement;
    if (!html?.getAttribute('lang')) {
      issue(issues, 'document-language', 'warning', 'Set <html lang="…"> to the document language for accessibility.', 'html');
    }
    if (!document.querySelector('meta[charset]')) {
      issue(issues, 'document-charset', 'warning', 'Declare UTF-8 with <meta charset="utf-8">.', 'head');
    }

    const roots = [...document.querySelectorAll('[data-document-root]')];
    if (!roots.length) {
      issue(issues, 'document-root-missing', 'error', 'Put the meaningful content inside one <main data-document-root> element.', 'main[data-document-root]');
      return null;
    }
    if (roots.length > 1) {
      issue(issues, 'document-root-multiple', 'error', 'Keep exactly one data-document-root element.', '[data-document-root]');
    }
    const rootElement = roots[0];
    if (rootElement.tagName !== 'MAIN') {
      issue(issues, 'document-root-element', 'error', 'Use <main data-document-root>, not another element, as the document root.', '[data-document-root]');
    }

    const text = visibleText(rootElement);
    if (!text) {
      issue(issues, 'document-root-empty', 'error', 'Add meaningful text content inside the document root.', 'main[data-document-root]');
    }

    const headings = [...rootElement.querySelectorAll('h1, h2, h3, h4, h5, h6')];
    const h1s = headings.filter((heading) => heading.tagName === 'H1');
    if (h1s.length !== 1) {
      issue(issues, 'heading-h1-count', 'error', h1s.length ? 'Keep exactly one <h1> inside the document root.' : 'Add one descriptive <h1> inside the document root.', 'main[data-document-root]');
    }
    if (headings.length && headings[0].tagName !== 'H1') {
      issue(issues, 'heading-order-start', 'warning', 'Start the heading outline with the document <h1>.', 'main[data-document-root]');
    }
    let previousLevel = 1;
    headings.forEach((heading) => {
      const level = Number(heading.tagName.slice(1));
      if (level > previousLevel + 1) {
        issue(issues, 'heading-order-skip', 'warning', `Do not skip from h${previousLevel} to h${level}; use an intervening heading level.`, 'main[data-document-root]');
      }
      previousLevel = level;
    });

    const headingsOutsideRoot = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter((heading) => !rootElement.contains(heading));
    if (headingsOutsideRoot.length) {
      issue(issues, 'heading-outside-root', 'warning', 'Move meaningful headings into <main data-document-root> so readers and indexers see one coherent artifact.', 'main[data-document-root]');
    }

    rootElement.querySelectorAll('a[href]').forEach((anchor) => {
      const href = (anchor.getAttribute('href') || '').trim();
      const label = normalizedText(anchor.textContent || anchor.getAttribute('aria-label') || anchor.getAttribute('title'));
      if (!label) issue(issues, 'link-label-missing', 'warning', 'Give each link descriptive text, aria-label, or title.', 'a[href]');
      if (GENERIC_LINK_TEXT.has(label.toLowerCase())) {
        issue(issues, 'link-label-generic', 'warning', `Replace generic link text \`${label}\` with text that names its destination.`, 'a[href]');
      }
      if (anchor.getAttribute('target') === '_blank' && !/\bnoopener\b/i.test(anchor.getAttribute('rel') || '')) {
        issue(issues, 'link-noopener', 'warning', 'Add rel="noopener" to target="_blank" links.', 'a[href]');
      }
      if (isLikelyRelativeUrl(href)) {
        issue(issues, 'link-resource-local', 'warning', `Replace the relative link \`${href}\` with an absolute URL or preserve the referenced content in this artifact; sibling files are not carried with a standalone HTML document.`, 'a[href]');
      }
    });

    rootElement.querySelectorAll('img').forEach((image) => {
      if (!image.hasAttribute('alt')) {
        issue(issues, 'image-alt-missing', 'warning', 'Add alt text, or alt="" for a decorative image.', 'img');
      }
    });
    if (text.length < 40 && rootElement.querySelector('img, svg, canvas')) {
      issue(issues, 'content-mostly-visual', 'warning', 'Add enough text to preserve the artifact’s meaning when images do not load.', 'main[data-document-root]');
    }
    rootElement.querySelectorAll('table').forEach((table) => {
      if (!table.querySelector('th')) {
        issue(issues, 'table-header-missing', 'warning', 'Use <th> cells for table headers so the table remains understandable to assistive technology.', 'table');
      }
    });
    return rootElement;
  }

  function validatePortabilityAndRisk(document, issues) {
    document.querySelectorAll('link[rel~="stylesheet"][href]').forEach((link) => {
      issue(issues, 'stylesheet-dependency', 'warning', 'Embed essential CSS in a <style> element; linked stylesheets make a standalone artifact depend on another file or host.', 'link[rel~="stylesheet"]');
    });

    document.querySelectorAll('style').forEach((style) => {
      const css = style.textContent || '';
      if (/@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i.test(css)) {
        issue(issues, 'css-import-remote', 'warning', 'Remove remote CSS @import rules; they are not available in an offline artifact.', 'style');
      }
      if (/@import\s+/i.test(css) && !/@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i.test(css)) {
        issue(issues, 'css-import-local', 'warning', 'Inline imported CSS instead of depending on another local file.', 'style');
      }
      const urlPattern = /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi;
      let match;
      while ((match = urlPattern.exec(css))) {
        const url = match[2].trim();
        if (isLikelyRelativeUrl(url)) {
          issue(issues, 'css-resource-local', 'warning', `Inline the CSS resource \`${url}\` or use a data URL so the artifact remains portable.`, 'style');
        } else if (isRemoteUrl(url)) {
          issue(issues, 'css-resource-remote', 'warning', `Remote CSS resource \`${url}\` is only safe as a progressive enhancement; keep the document usable without it.`, 'style');
        }
      }
    });

    document.querySelectorAll('img[src], audio[src], video[src], source[src], track[src]').forEach((node) => {
      const src = (node.getAttribute('src') || '').trim();
      if (isLikelyRelativeUrl(src)) {
        issue(issues, 'media-resource-local', 'warning', `Inline the ${node.tagName.toLowerCase()} resource \`${src}\` or make it non-essential; relative files are not part of a standalone HTML artifact.`, node.tagName.toLowerCase());
      } else if (isRemoteUrl(src)) {
        issue(issues, 'media-resource-remote', 'warning', `Remote ${node.tagName.toLowerCase()} resource \`${src}\` should remain a progressive enhancement.`, node.tagName.toLowerCase());
      }
    });

    document.querySelectorAll('script').forEach((script) => {
      const isManifest = script.hasAttribute('data-helm-manifest');
      const type = (script.getAttribute('type') || '').trim().toLowerCase();
      const executable = !type || type === 'module' || /(?:java|ecma)script/.test(type);
      if (!isManifest && executable) {
        const source = (script.getAttribute('src') || '').trim();
        issue(issues, source ? 'script-external' : 'script-inline', 'warning', source
          ? `Remove or clearly justify executable script dependency \`${source}\`; Helm treats artifacts as untrusted documents.`
          : 'Remove or clearly justify inline executable JavaScript; Helm documents should remain readable without code execution.', 'script');
      }
    });

    document.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        if (/^on/i.test(attribute.name)) {
          issue(issues, 'event-handler', 'error', `Remove the ${attribute.name} event handler from <${node.tagName.toLowerCase()}>; documents should not execute embedded actions.`, node.tagName.toLowerCase());
        }
        if (['href', 'src', 'action', 'data'].includes(attribute.name.toLowerCase()) && /^\s*javascript:/i.test(attribute.value)) {
          issue(issues, 'javascript-url', 'error', `Remove the javascript: URL from <${node.tagName.toLowerCase()}>.`, node.tagName.toLowerCase());
        }
      });
    });

    const hasMetaRefresh = [...document.querySelectorAll('meta[http-equiv]')]
      .some((meta) => (meta.getAttribute('http-equiv') || '').toLowerCase() === 'refresh');
    if (hasMetaRefresh) {
      issue(issues, 'meta-refresh', 'warning', 'Remove automatic meta refresh redirects from a portable document.', 'meta[http-equiv="refresh"]');
    }
    if (document.querySelector('base[href]')) {
      issue(issues, 'base-url', 'warning', 'Remove <base>; it changes how relative links resolve after export.', 'base');
    }
    document.querySelectorAll('iframe, object, embed').forEach((node) => {
      issue(issues, 'embedded-content', 'warning', `Avoid <${node.tagName.toLowerCase()}> dependencies; preserve essential content directly in the artifact.`, node.tagName.toLowerCase());
    });
    document.querySelectorAll('form').forEach(() => {
      issue(issues, 'form-interaction', 'warning', 'Avoid forms that depend on a host service; preserve the information as document content instead.', 'form');
    });
  }

  /**
   * Validate an HTML source string against the HDOC/1.0 document contract.
   *
   * `options.DOMParser` lets Node-based callers supply a DOM implementation.
   */
  function validate(htmlSource, options = {}) {
    const issues = [];
    if (typeof htmlSource !== 'string') {
      issue(issues, 'input-not-string', 'error', 'Pass the complete HTML source as a string.', 'input');
      return { valid: false, score: 0, issues, manifest: null, extractedText: '' };
    }

    const Parser = options.DOMParser || root?.DOMParser;
    if (typeof Parser !== 'function') {
      issue(issues, 'domparser-unavailable', 'error', 'A DOMParser implementation is required to validate HTML. In Node, pass { DOMParser } from a DOM environment.', 'environment');
      return { valid: false, score: 0, issues, manifest: null, extractedText: '' };
    }

    let document;
    try {
      document = new Parser().parseFromString(htmlSource, 'text/html');
    } catch (error) {
      issue(issues, 'html-parse-failed', 'error', `HTML could not be parsed: ${error.message || 'unknown parser error'}.`, 'input');
      return { valid: false, score: 0, issues, manifest: null, extractedText: '' };
    }

    let manifest = null;
    const manifestNodes = [...document.querySelectorAll('[data-helm-manifest]')];
    if (!manifestNodes.length) {
      issue(issues, 'manifest-missing', 'error', 'Add one <script type="application/json" data-helm-manifest> block.', '[data-helm-manifest]');
    } else {
      if (manifestNodes.length > 1) {
        issue(issues, 'manifest-multiple', 'error', 'Keep exactly one Helm manifest block.', '[data-helm-manifest]');
      }
      const manifestNode = manifestNodes[0];
      if (manifestNode.tagName !== 'SCRIPT') {
        issue(issues, 'manifest-element', 'error', 'Put the Helm manifest in a <script> element.', '[data-helm-manifest]');
      }
      if ((manifestNode.getAttribute('type') || '').trim().toLowerCase() !== 'application/json') {
        issue(issues, 'manifest-content-type', 'error', 'Set the Helm manifest script type to application/json.', '[data-helm-manifest]');
      }
      try {
        manifest = JSON.parse(manifestNode.textContent || '');
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
          issue(issues, 'manifest-json-object', 'error', 'Use a JSON object for the Helm manifest.', '[data-helm-manifest]');
          manifest = null;
        }
      } catch (error) {
        issue(issues, 'manifest-json-invalid', 'error', `Fix the Helm manifest JSON: ${error.message || 'invalid JSON'}.`, '[data-helm-manifest]');
      }
    }

    validateManifest(manifest, issues);
    validateMetadata(document, manifest, issues);
    const rootElement = validateStructure(document, issues);
    validatePortabilityAndRisk(document, issues);

    const score = Math.max(0, 100 - issues.reduce((total, item) => total + SEVERITY_WEIGHT[item.severity], 0));
    const severityOrder = { error: 0, warning: 1, info: 2 };
    issues.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.code.localeCompare(right.code));
    return {
      valid: !issues.some((item) => item.severity === 'error'),
      score,
      issues,
      manifest,
      extractedText: visibleText(rootElement || document.body)
    };
  }

  return Object.freeze({ SCHEMA_VERSION, VALIDATOR_VERSION, validate });
}));
