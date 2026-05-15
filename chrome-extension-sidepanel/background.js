// CleanSlate Liquid Linter — Side Panel build
//
// Toolbar icon click behavior:
//   • Chrome 114+ with sidePanel API → setPanelBehavior tells Chrome to open
//     the side panel on action click. action.onClicked never fires.
//   • Older Chromium / browsers without sidePanel API → setPanelBehavior is
//     undefined and never runs, so action.onClicked is the only listener
//     and we fall back to the new-tab behavior (read editor, open site).
//
// The side panel itself is sidepanel.html (Chrome-hosted, not injected into
// the dashboard's DOM), so CleverTap's CSP cannot block our iframe of the
// linter site the way it would for a content-script-injected panel.

const SITE_URL = 'https://rubenico0601.github.io/Clean-Slate-Liquid-Syntax-Error-/';

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('CleanSlate: setPanelBehavior failed.', err));
}

chrome.action.onClicked.addListener(async (tab) => {
  // Only fires when sidePanel API is unavailable. Fall back to the new-tab
  // experience so the extension still works in Brave, older Edge, etc.
  if (!tab || !tab.id) return;
  let text = '';
  try {
    text = await readTemplateFromTab(tab.id);
  } catch (e) {
    console.warn('CleanSlate: could not read selection.', e);
  }
  chrome.tabs.create({ url: buildSiteUrl(text) });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'CLEANSLATE_READ_TEMPLATE') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: 'No active tab.' });
          return;
        }
        const text = await readTemplateFromTab(tab.id);
        sendResponse({ ok: true, text, siteUrl: SITE_URL });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // keep channel open for async sendResponse
  }
  if (msg && msg.type === 'CLEANSLATE_GET_SITE_URL') {
    sendResponse({ siteUrl: SITE_URL });
    return false;
  }
  if (msg && msg.type === 'CLEANSLATE_WRITE_TEMPLATE') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: 'No active tab.' });
          return;
        }
        const ok = await writeTemplateToTab(tab.id, msg.template || '');
        sendResponse(ok);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});

async function writeTemplateToTab(tabId, template) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: writeToCodeMirror,
    args: [template],
  });
  for (const r of results || []) {
    if (r && r.result && r.result.ok) return { ok: true };
  }
  // Return the most-informative error we saw across frames.
  const firstErr = (results || []).map(r => r && r.result).find(x => x && x.error);
  return { ok: false, error: firstErr ? firstErr.error : 'No CodeMirror editor found in active tab.' };
}

// Runs in the MAIN world inside every frame. Locates the BEE CodeMirror 6
// editor and replaces its full document. Returns {ok: true} on success,
// {ok: false, error: "..."} otherwise. Frames without an editor return
// {ok: false} silently and we ignore them.
function writeToCodeMirror(newText) {
  try {
    const content = document.querySelector('.cm-content');
    if (content && content.cmView && content.cmView.view) {
      const view = content.cmView.view;
      const doc = view.state.doc;
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: newText },
      });
      return { ok: true };
    }
  } catch (e) {
    return { ok: false, error: 'CM6 dispatch failed: ' + (e && e.message ? e.message : String(e)) };
  }
  try {
    const cm5 = document.querySelector('.CodeMirror');
    if (cm5 && cm5.CodeMirror) {
      cm5.CodeMirror.setValue(newText);
      return { ok: true };
    }
  } catch (e) {
    return { ok: false, error: 'CM5 setValue failed: ' + (e && e.message ? e.message : String(e)) };
  }
  return { ok: false };
}

async function readTemplateFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: readSelectionFromFrame,
  });
  let best = '';
  for (const r of results || []) {
    const t = (r && r.result) || '';
    if (t.length > best.length) best = t;
  }
  return best;
}

// Runs in the MAIN world so it can reach CodeMirror's `.cmView` and
// window.monaco objects that are invisible to content-script isolated worlds.
function readSelectionFromFrame() {
  try {
    const content = document.querySelector('.cm-content');
    if (content && content.cmView && content.cmView.view) {
      const doc = content.cmView.view.state.doc;
      if (doc) return doc.toString();
    }
  } catch (e) {}
  try {
    const cm5 = document.querySelector('.CodeMirror');
    if (cm5 && cm5.CodeMirror) return cm5.CodeMirror.getValue();
  } catch (e) {}
  try {
    if (window.monaco && window.monaco.editor && window.monaco.editor.getEditors) {
      const eds = window.monaco.editor.getEditors();
      if (eds && eds.length) return eds[0].getValue();
    }
  } catch (e) {}
  const el = document.activeElement;
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
    const v = el.value || '';
    const s = el.selectionStart, e = el.selectionEnd;
    if (typeof s === 'number' && typeof e === 'number' && s !== e) {
      return v.substring(s, e);
    }
    return v;
  }
  return window.getSelection ? window.getSelection().toString() : '';
}

function buildSiteUrl(text) {
  // Always include #src=... so the site's analytics can attribute the
  // visit to the side-panel-fallback path even when no template was found.
  if (!text || !text.trim()) return SITE_URL + '#src=sidepanel-fallback-empty';
  const params = new URLSearchParams();
  params.set('template', base64EncodeUtf8(text));
  params.set('size', String(text.length));
  params.set('src', 'sidepanel-fallback');
  return SITE_URL + '#' + params.toString();
}

function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
