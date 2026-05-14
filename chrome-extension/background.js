// CleanSlate — thin-shell service worker.
//
// Job: extract the template from the active tab, encode it, and open
// the live CleanSlate website with it pre-loaded. The website itself
// lives on GitHub Pages — this extension has no UI of its own, so any
// website update auto-flows to extension users on the next click.

// Where the live UI lives. Update if you fork / move the site.
const CLEANSLATE_URL = 'https://rubenico0601.github.io/Clean-Slate-Liquid-Syntax-Error-/';

// Practical URL-hash safe budget for templates. The hash fragment
// (#...) is never sent to a server — it stays client-side in Chrome —
// so there's no corporate-proxy concern. Chrome handles multi-MB URLs
// in tabs.create without issue, so we set a generous 1 MB ceiling.
// Encoded template would have to exceed 1 MB before the user sees
// the "too large" fallback; that's well past any real email template.
const MAX_HASH_BYTES = 1024 * 1024;

// Function injected into every same-origin frame of the active tab.
// Returns the best-guess template text (selection → focused editor →
// CodeMirror → Monaco → Ace → contenteditable → biggest textarea), or
// an inventory of what was on the page if nothing matched.
function extractTemplateFromPage() {
  function fromSelection() {
    const s = window.getSelection && window.getSelection();
    if (s && s.toString && s.toString().length > 0) return s.toString();
    return null;
  }
  function fromActiveTextarea() {
    const el = document.activeElement;
    if (!el) return null;
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) return el.value || null;
    if (el.isContentEditable && el.innerText) return el.innerText;
    return null;
  }
  function fromCodeMirror() {
    let best = null;
    for (const n of document.querySelectorAll('.CodeMirror')) {
      if (n.CodeMirror && typeof n.CodeMirror.getValue === 'function') {
        const v = n.CodeMirror.getValue();
        if (v && (!best || v.length > best.length)) best = v;
      }
    }
    return best;
  }
  function fromMonaco() {
    if (typeof window.monaco === 'undefined' || !window.monaco.editor) return null;
    try {
      const editors = window.monaco.editor.getEditors();
      let best = null;
      for (const ed of editors) {
        const v = ed.getValue();
        if (v && (!best || v.length > best.length)) best = v;
      }
      return best;
    } catch (e) { return null; }
  }
  function fromAce() {
    if (typeof window.ace === 'undefined') return null;
    let best = null;
    for (const n of document.querySelectorAll('.ace_editor')) {
      try {
        const v = window.ace.edit(n).getValue();
        if (v && (!best || v.length > best.length)) best = v;
      } catch (e) {}
    }
    return best;
  }
  function fromBigContentEditable() {
    let best = null;
    for (const n of document.querySelectorAll('[contenteditable="true"], [contenteditable=""]')) {
      const v = n.innerText;
      if (v && v.length > 50 && (!best || v.length > best.length)) best = v;
    }
    return best;
  }
  function fromBiggestTextarea() {
    let best = null;
    for (const t of document.querySelectorAll('textarea')) {
      const v = t.value;
      if (v && (!best || v.length > best.length)) best = v;
    }
    return best;
  }
  const candidates = [
    { source: 'selection', value: fromSelection() },
    { source: 'active-element', value: fromActiveTextarea() },
    { source: 'codemirror', value: fromCodeMirror() },
    { source: 'monaco', value: fromMonaco() },
    { source: 'ace', value: fromAce() },
    { source: 'contenteditable', value: fromBigContentEditable() },
    { source: 'largest-textarea', value: fromBiggestTextarea() },
  ];
  for (const c of candidates) {
    if (c.value && c.value.trim().length > 0) return { template: c.value, source: c.source };
  }
  return { template: null, source: 'none' };
}

// UTF-8 → base64 → URL-encoded (so non-ASCII templates survive the round trip).
function encodeForUrl(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return encodeURIComponent(btoa(bin));
}

function pickBest(frameResults) {
  // Longest candidate wins across all sources and frames. Previously
  // "selection" always won, which silently dropped 95% of a template
  // when the user had selected only a visible chunk in a tall editor.
  // If the user really wants just a snippet, they can paste it manually.
  const withTemplate = frameResults.filter((r) => r && r.template);
  if (withTemplate.length === 0) return null;
  return withTemplate.reduce((a, b) => (a.template.length >= b.template.length ? a : b));
}

async function handleAction(tab) {
  const url = tab && tab.url ? tab.url : '';
  const canScript = url && !/^(chrome|chrome-extension|about|edge|brave|view-source):/i.test(url);

  let extractedTemplate = null;
  let extractedSource = 'none';

  if (canScript) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: extractTemplateFromPage,
      });
      const frameResults = results.map((r) => r && r.result).filter(Boolean);
      const best = pickBest(frameResults);
      if (best) {
        extractedTemplate = best.template;
        extractedSource = best.source;
      }
    } catch (err) {
      console.warn('CleanSlate extraction failed:', err && err.message);
    }
  }

  // If extraction returns nothing OR very little (likely a virtualized
  // editor like CodeMirror 6 in BEE Plugin's drag-and-drop view), open
  // with the paste prompt instead. The user has presumably Cmd+C'd the
  // editor content — the website's paste prompt reads the clipboard,
  // bypassing DOM virtualization entirely.
  const SUSPICIOUSLY_SMALL = 5000; // bytes
  const tooSmall = !extractedTemplate || extractedTemplate.length < SUSPICIOUSLY_SMALL;

  let targetUrl = CLEANSLATE_URL;
  if (tooSmall) {
    targetUrl = CLEANSLATE_URL + '#paste=1';
  } else if (extractedTemplate) {
    const encoded = encodeForUrl(extractedTemplate);
    const sizeHint = `&size=${extractedTemplate.length}&src=${extractedSource}`;
    if (encoded.length <= MAX_HASH_BYTES) {
      targetUrl = CLEANSLATE_URL + '#template=' + encoded + sizeHint;
    } else {
      targetUrl = CLEANSLATE_URL + '#err=toobig' + sizeHint;
    }
  }

  await chrome.tabs.create({ url: targetUrl });
}

chrome.action.onClicked.addListener(handleAction);
