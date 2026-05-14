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
  // Read the user's selection via each editor library's own API.
  // window.getSelection() is unreliable for:
  //   - <textarea>/<input>: its selection isn't visible to getSelection()
  //   - CodeMirror/Monaco/Ace: the DOM is virtualized, so getSelection()
  //     only sees the lines that are currently rendered (a Cmd+A on an
  //     80 KB doc may return only ~5 KB)
  // We try each editor first, fall back to the browser selection last.
  function fromSelection() {
    // 1. Focused textarea / single-line input
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' ||
                   (active.tagName === 'INPUT' && active.type === 'text'))) {
      const s = active.selectionStart;
      const e = active.selectionEnd;
      if (typeof s === 'number' && typeof e === 'number' && s !== e) {
        return active.value.substring(s, e);
      }
    }
    // 2. CodeMirror instance with a selection (returns FULL selected text)
    let best = null;
    for (const node of document.querySelectorAll('.CodeMirror')) {
      if (node.CodeMirror && typeof node.CodeMirror.somethingSelected === 'function') {
        try {
          if (node.CodeMirror.somethingSelected()) {
            const t = node.CodeMirror.getSelection();
            if (t && (!best || t.length > best.length)) best = t;
          }
        } catch (e) { /* ignore */ }
      }
    }
    if (best) return best;
    // 3. Monaco editor with a selection
    if (window.monaco && window.monaco.editor && typeof window.monaco.editor.getEditors === 'function') {
      try {
        for (const ed of window.monaco.editor.getEditors()) {
          const sel = ed.getSelection && ed.getSelection();
          const model = ed.getModel && ed.getModel();
          if (sel && model && !sel.isEmpty()) {
            const t = model.getValueInRange(sel);
            if (t && (!best || t.length > best.length)) best = t;
          }
        }
      } catch (e) { /* ignore */ }
    }
    if (best) return best;
    // 4. Ace editor with a selection
    if (window.ace) {
      for (const node of document.querySelectorAll('.ace_editor')) {
        try {
          const ed = window.ace.edit(node);
          const t = ed.getSelectedText && ed.getSelectedText();
          if (t && (!best || t.length > best.length)) best = t;
        } catch (e) { /* ignore */ }
      }
    }
    if (best) return best;
    // 5. Browser selection (contenteditable, plain HTML text, etc.)
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
  // Selection-first, but ACROSS ALL FRAMES pick the LARGEST selection.
  // A stale 800-byte selection in the top frame must not beat an 80 KB
  // Cmd+A inside an iframe-embedded editor.
  const sels = frameResults.filter((r) => r && r.template && r.source === 'selection');
  if (sels.length > 0) {
    return sels.reduce((a, b) => (a.template.length >= b.template.length ? a : b));
  }
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

  let targetUrl = CLEANSLATE_URL;
  if (extractedTemplate) {
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
