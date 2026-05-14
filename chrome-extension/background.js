// CleanSlate Liquid Linter — Chrome extension
//
// Flow:
//   1. User selects HTML on the CleverTap dashboard (Cmd+A / Ctrl+A).
//   2. User clicks the extension icon.
//   3. We read window.getSelection() from the active tab.
//   4. We open the CleanSlate site in a new tab with the selected HTML
//      passed via URL hash (#template=<base64>&size=<n>&src=selection).

const SITE_URL = 'https://rubenico0601.github.io/Clean-Slate-Liquid-Syntax-Error-/';

chrome.action.onClicked.addListener(async (tab) => {
  let selectedText = '';
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: readSelectionFromFrame
    });
    // Pick the longest selection across all frames.
    for (const r of results || []) {
      const t = (r && r.result) || '';
      if (t.length > selectedText.length) selectedText = t;
    }
  } catch (e) {
    console.warn('CleanSlate: could not read selection from active tab.', e);
  }

  const url = buildSiteUrl(selectedText);
  chrome.tabs.create({ url });
});

// Runs inside the page in the MAIN world so it can reach editor JS objects
// (CodeMirror's `.cmView`, window.monaco, etc.) that are invisible to the
// content-script isolated world. Tries the editor APIs first because they
// return the *full* document; virtual-scrolling editors hide off-screen
// lines from the DOM, so window.getSelection() after Cmd+A only captures
// the visible viewport.
function readSelectionFromFrame() {
  // 1. CodeMirror 6 (BEE Plugin's HTML properties editor uses this)
  try {
    const content = document.querySelector('.cm-content');
    if (content && content.cmView && content.cmView.view) {
      const doc = content.cmView.view.state.doc;
      if (doc) return doc.toString();
    }
  } catch (e) {}

  // 2. CodeMirror 5
  try {
    const cm5 = document.querySelector('.CodeMirror');
    if (cm5 && cm5.CodeMirror) return cm5.CodeMirror.getValue();
  } catch (e) {}

  // 3. Monaco
  try {
    if (window.monaco && window.monaco.editor && window.monaco.editor.getEditors) {
      const eds = window.monaco.editor.getEditors();
      if (eds && eds.length) return eds[0].getValue();
    }
  } catch (e) {}

  // 4. Focused <textarea> / <input>
  const el = document.activeElement;
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
    const v = el.value || '';
    const s = el.selectionStart, e = el.selectionEnd;
    if (typeof s === 'number' && typeof e === 'number' && s !== e) {
      return v.substring(s, e);
    }
    return v;
  }

  // 5. Plain DOM selection (last resort — may be visible viewport only)
  return window.getSelection ? window.getSelection().toString() : '';
}

function buildSiteUrl(text) {
  if (!text || !text.trim()) return SITE_URL;
  const encoded = base64EncodeUtf8(text);
  const params = new URLSearchParams();
  params.set('template', encoded);
  params.set('size', String(text.length));
  params.set('src', 'selection');
  return SITE_URL + '#' + params.toString();
}

function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
