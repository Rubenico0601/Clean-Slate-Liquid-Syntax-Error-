# CleanSlate — Chrome Extension (thin shell)

A tiny launcher that grabs a Liquid template from whatever page you're on (CleverTap dashboard, BEE Plugin iframe, anything with a textarea) and opens it in the live CleanSlate web tool at:

> https://rubenico0601.github.io/Clean-Slate-Liquid-Syntax-Error-/

The extension itself contains no UI code — just the extraction + handoff logic (~3 KB). All the linting, conversion, preview, and variable-inspection lives on the website. **Any update you push to the website's `main` branch is live for every extension user on their next click**, with no zip redistribution or extension reload required.

## What's in here

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest, declares permissions (`activeTab`, `scripting`, `app.getbee.io` host access). |
| `background.js` | Service worker. On toolbar click: scans the active tab + iframes for editor content, base64-encodes it, opens CleanSlate with the template in the URL hash. |
| `README.md` | This file. |

That's it. 20 KB total.

## Install (unpacked)

1. `chrome://extensions/`
2. Toggle **Developer mode** (top-right).
3. **Load unpacked** → pick this `chrome-extension/` folder.
4. Pin the extension to the toolbar.

After updating any file here, click the **reload** ↻ icon on the extension's tile. Website changes (anything outside this folder) need no reload — they go live as soon as GitHub Pages publishes them.

## How to use it

On any page with a Liquid template (CleverTap email builder, BEE Plugin editor, plain textarea on a docs page, etc.):

1. Optionally select the template text (Ctrl/Cmd+A inside the editor).
2. Click the CleanSlate toolbar icon.
3. CleanSlate opens in a new tab with the template already pasted in the Linter. A small toast confirms the import.

The extension tries (in order, picking the longest non-empty match across all same-origin frames):

1. The current text selection
2. The focused textarea or contenteditable
3. Any CodeMirror, Monaco, or Ace editor on the page
4. The largest contenteditable
5. The largest textarea

If nothing matches, CleanSlate opens empty so you can paste manually.

## Permissions

- `activeTab` — read the current tab's content only when you click the toolbar icon. No background access.
- `scripting` — execute the extraction function in the active tab.
- `host_permissions: https://app.getbee.io/*` — needed to reach into the BEE Plugin editor iframe that CleverTap embeds for the drag-and-drop email builder.

No `<all_urls>`, no `storage`, no content scripts running anywhere outside the active tab.

## How the handoff works

```
[ Extension ]               [ Website ]
extract template      →   reads location.hash
base64-encode               decodes #template=...
open URL:                   pre-fills editor
  https://...github.io/        runs linter
  #template=<base64>           shows import toast
```

The template travels in the URL hash (`#template=<base64>`). Hashes don't get sent to the server, so the template stays client-side end to end.

## Big-template fallback

URLs have practical size limits (~32 KB is the safe zone before some proxies/networks misbehave; Chrome's hard limit is ~2 MB). The extension checks the encoded size before opening:

- **Under 32 KB:** open with `#template=...`. Auto-imported.
- **Over 32 KB:** open with `#err=toobig`. Website shows a "paste manually" toast.

About 95% of real CleverTap templates fit under 32 KB. If the 5% becomes a pain point, we can add a clipboard-fallback path.

## Updating the URL (forks, custom domains)

Change the `CLEANSLATE_URL` constant at the top of `background.js` and reload the extension.

## Future: Chrome Web Store

If you want to publish properly so colleagues install once and get auto-updates from Chrome:

- [ ] Create a Chrome Web Store developer account ($5 one-time).
- [ ] Add icons (16/48/128 PNGs at `icons/`) and reference them from `manifest.json`.
- [ ] Zip the `chrome-extension/` folder and submit.
- [ ] Choose public, unlisted (link-only), or private.

Because this is a thin shell, you'll almost never need to publish a new version — only when the extraction logic needs changing. Website changes flow automatically via GitHub Pages.
