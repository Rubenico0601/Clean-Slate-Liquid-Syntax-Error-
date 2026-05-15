// Runs inside the Chrome side panel. The panel iframes the linter site
// in ?panel=1 mode (issues-only view) and brokers two message flows:
//
//   1. Import: button click → ask background to read BEE → reload iframe
//      with the template encoded in the URL hash.
//   2. Apply fix: iframe postMessages a patched template → ask background
//      to write it back to BEE's CodeMirror → report success to iframe.

const SITE_BASE_FALLBACK = 'https://rubenico0601.github.io/Clean-Slate-Liquid-Syntax-Error-/';
const EXPECTED_ORIGIN = 'https://rubenico0601.github.io';
let siteBase = SITE_BASE_FALLBACK;

const frame = document.getElementById('linter-frame');
const importBtn = document.getElementById('import-btn');
const newtabBtn = document.getElementById('newtab-btn');
const statusEl = document.getElementById('status');

function setStatus(msg, kind) {
  statusEl.textContent = msg || '';
  statusEl.dataset.kind = kind || '';
}

function buildIframeUrl(base, template) {
  const url = new URL(base);
  url.searchParams.set('panel', '1');
  url.searchParams.set('t', String(Date.now())); // cache-bust → forces full reload
  if (template) {
    const params = new URLSearchParams();
    params.set('template', base64EncodeUtf8(template));
    params.set('size', String(template.length));
    params.set('src', 'sidepanel');
    url.hash = params.toString();
  }
  return url.toString();
}

// Load the linter site (panel mode) as soon as the panel opens, even
// without a template — colleagues should see the empty-state UI first.
chrome.runtime.sendMessage({ type: 'CLEANSLATE_GET_SITE_URL' }, (resp) => {
  if (resp && resp.siteUrl) siteBase = resp.siteUrl;
  frame.src = buildIframeUrl(siteBase, null);
});

importBtn.addEventListener('click', () => {
  setStatus('Reading template from the dashboard…', 'info');
  chrome.runtime.sendMessage({ type: 'CLEANSLATE_READ_TEMPLATE' }, (resp) => {
    if (!resp || !resp.ok) {
      const err = (resp && resp.error) || 'unknown error';
      setStatus('Could not read template: ' + err, 'err');
      return;
    }
    const text = resp.text || '';
    if (!text.trim()) {
      setStatus('No template found. Open the HTML editor on the dashboard and try again.', 'warn');
      return;
    }
    frame.src = buildIframeUrl(resp.siteUrl || siteBase, text);
    setStatus('Imported ' + (text.length / 1024).toFixed(1) + ' KB. Issues will appear in the panel.', 'ok');
  });
});

newtabBtn.addEventListener('click', () => {
  // Strip ?panel=1 when popping out so the user gets the full app in the tab.
  const u = new URL(siteBase);
  chrome.tabs.create({ url: u.toString() });
});

// Apply-fix flow: the iframe (running on github.io) posts CLEANSLATE_APPLY_FIX
// when the user clicks "Apply to dashboard". Validate origin, then ask
// background to write the new template into BEE's CodeMirror on the active tab.
window.addEventListener('message', (event) => {
  if (event.origin !== EXPECTED_ORIGIN) return; // ignore everything else
  const msg = event.data || {};
  if (msg.type !== 'CLEANSLATE_APPLY_FIX') return;
  const template = msg.template || '';
  if (!template) {
    replyToIframe({ type: 'CLEANSLATE_APPLY_FIX_RESULT', ok: false, error: 'Empty template' });
    return;
  }
  setStatus('Writing fix to dashboard…', 'info');
  chrome.runtime.sendMessage(
    { type: 'CLEANSLATE_WRITE_TEMPLATE', template: template },
    (resp) => {
      if (resp && resp.ok) {
        setStatus('Dashboard updated.', 'ok');
        replyToIframe({ type: 'CLEANSLATE_APPLY_FIX_RESULT', ok: true });
      } else {
        const err = (resp && resp.error) || 'unknown error';
        setStatus('Write failed: ' + err, 'err');
        replyToIframe({ type: 'CLEANSLATE_APPLY_FIX_RESULT', ok: false, error: err });
      }
    }
  );
});

function replyToIframe(msg) {
  if (frame && frame.contentWindow) {
    try { frame.contentWindow.postMessage(msg, EXPECTED_ORIGIN); } catch (e) {}
  }
}

function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
