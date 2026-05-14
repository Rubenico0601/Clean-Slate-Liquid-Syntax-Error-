// CleanSlate offscreen — reads the clipboard on behalf of the service
// worker, which can't access navigator.clipboard directly under MV3.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.target === 'offscreen' && msg.action === 'read-clipboard') {
    (async () => {
      try {
        const text = await navigator.clipboard.readText();
        sendResponse({ ok: true, text: text || '' });
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    })();
    return true; // async
  }
});
