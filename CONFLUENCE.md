# CleanSlate — CleverTap Liquid Linter & Toolkit

> **One-line summary**
> A web-based linter, builder, converter, and preview tool for CleverTap Liquid templates (LiqP 0.7.9), with **two** companion Chrome extensions that import templates straight from the CleverTap dashboard — pick the one that fits how you work.

| | |
|---|---|
| **Live tool** | https://rubenico0601.github.io/Clean-Slate-Liquid-Syntax-Error-/ |
| **Liquid engine** | CleverTap LiqP `0.7.9` |
| **Supported channels** | Email (HTML), Push, In-App, Web Pop-up — any CleverTap template using Liquid |
| **Chrome extension — new tab** | `cleanslate-extension.zip` (attached to this page) |
| **Chrome extension — side panel** | `cleanslate-sidepanel-extension.zip` (attached to this page) |
| **Owner** | Ruben Charles · `ruben@clevertap.com` |
| **Status** | Active — internal use, feedback welcome |

> 📷 **Screenshot to add — header banner (optional):** Full landing-page screenshot of the linter with the **Valid Sample** loaded. Crop to a wide aspect ratio (~3:1) so it reads as a banner. Place it directly under this table.

## What it solves

Liquid errors in CleverTap campaigns surface only at send time, often in confusing error messages that don't point at a line number. CleanSlate catches them up-front, on your laptop, before the campaign is even saved. It also bundles the small day-to-day utilities (LP→CT conversion, epoch / minutes converters, variable detection, mock-data preview) that the campaign team was previously doing by hand or by spreadsheet.

## What's inside this page

1. [Top toolbar](#top-toolbar-visible-on-every-tab)
2. [Tab 1 — Linter](#tab-1--linter-default)
3. [Tab 2 — Builder](#tab-2--builder)
4. [Tab 3 — Reference](#tab-3--reference)
5. [Tab 4 — Tools](#tab-4--tools)
6. [Tab 5 — Variables](#tab-5--variables)
7. [Tab 6 — Preview](#tab-6--preview)
8. [Security & Privacy](#security--privacy)
9. [Chrome extensions — pick a flavor](#chrome-extensions--pick-a-flavor)
   - [Option A — New-tab launcher](#option-a--new-tab-launcher)
   - [Option B — Side panel (recommended)](#option-b--side-panel-recommended)

---


---

## Top toolbar (visible on every tab)

| Button | What it does |
|---|---|
| **LP → CT** | Converts a Leanplum Jinja2 template into CleverTap-compatible Liquid (handles `userAttribute['X']`, `userAttribute.X`, Jinja filters, etc.) |
| **Format** | Pretty-prints the HTML and puts each block-level Liquid tag on its own line |
| **Valid Sample** | Loads a clean, well-formed Liquid template — useful for demo and onboarding |
| **Broken Sample** | Loads a template seeded with common Liquid mistakes — useful for showing the linter at work |
| **Clear** | Empties the editor |

> 📷 **Screenshot to add:** "Top toolbar overview" — full-width screenshot of the header strip showing all five buttons.

---

## Tab 1 — Linter (default)

The main feature. Paste any HTML / Liquid template into the editor on the left; errors appear on the right with the exact line number, the problematic snippet, and a fix suggestion.

**What it catches**
- Unbalanced or missing closing tags (`endif`, `endfor`, `endcapture`, …)
- Wrong opening / closing delimiters (`{%`, `{{`, `%}`, `}}`)
- Unknown tags or filters not supported by CleverTap's LiqP 0.7.9 engine
- Quoted vs. unquoted `now` in date filters (CleverTap-specific gotcha)
- Mismatched bracket notation in `Profile` / `Event` / `Linked` references

**Right-side Properties panel**
- Shows campaign-level properties detected from the template (Profile attributes, Event keys, Linked tokens).
- Toggle visibility with **Hide Properties** / **Show Properties**.
- **Copy Errors** button copies all linter findings to the clipboard for sharing in tickets or Slack.

> 📷 **Screenshots to add (Linter tab — three total):**
> 1. Linter loaded with **Valid Sample** — shows the green "no errors" state.
> 2. Linter loaded with **Broken Sample** — shows the error list on the right with line numbers and the editor highlighting bad lines.
> 3. Properties panel expanded — shows detected Profile / Event tokens.

---

## Tab 2 — Builder

Quick-template generator for the most common Liquid blocks. Click a template card on the left, fill in the form fields, click **Generate Code**, then either **Copy** or **Send to Linter**.

**What you can generate**
- `if / elsif / else` blocks
- `for` loops over arrays
- `case / when` switches
- `assign` statements with defaults
- `capture` blocks
- Common date and number filter chains

> 📷 **Screenshots to add (Builder tab — two total):**
> 1. Builder tab landing page showing the grid of quick-template cards.
> 2. A template selected (e.g. `if / else`), form fields filled in, with the generated code visible on the right.

---

## Tab 3 — Reference

A scrollable cheat-sheet of every Liquid tag, filter, and operator supported by CleverTap's LiqP 0.7.9 engine. Each entry shows the tag name, a one-line description, and a working code example.

**Sections**
- **Block Tags** — `if`, `unless`, `for`, `case`, `comment`, `raw`, `tablerow`, `capture`
- **Standalone Tags** — `assign`, `increment`, `decrement`, `abort`, `break`, `continue`
- **String Filters** — `upcase`, `downcase`, `capitalize`, `replace`, `truncate`, etc.
- **Number Filters** — `plus`, `minus`, `times`, `divided_by`, `round`, etc.
- **Date Filters** — including the CleverTap-specific bare `now` keyword
- **Array Filters** — `first`, `last`, `size`, `join`, `sort`, etc.

> 📷 **Screenshot to add:** Full-page screenshot of the Reference tab showing the card grid layout and at least one expanded example block.

---

## Tab 4 — Tools

Two standalone utilities for day-to-day campaign work.

### Minutes to Time
Convert CleverTap "minutes from midnight" values (0–1439) from the Sent Log into readable 12-hour times. Includes a row of quick-example chips (`0 → 12:00 AM`, `470 → 7:50 AM`, etc.).

### Epoch Timestamp Converter
Two-way converter:
- **Epoch → Readable Date** — paste a Unix timestamp, get GMT + your local timezone.
- **Date → Epoch** — fill in year/month/day/hour/minute/second, pick GMT or Local, get the epoch in both seconds and milliseconds. **Use Now** button auto-fills the current time.

> 📷 **Screenshots to add (Tools tab — two total):**
> 1. Minutes to Time card with `470` entered and the `7:50 AM` result visible.
> 2. Epoch Converter card with both directions filled in (one example each).

---

## Tab 5 — Variables

Static analysis of a template. Paste the source, click **Analyze**, and the tool reports every dynamic token it found, grouped by type:

- **Profile / Event / Linked** tokens (both dot notation and bracket notation)
- **Assigned string literals** (values pulled from `{% assign %}` statements)
- **Image URLs** referenced inside the template
- **Anchor (link) URLs** referenced inside the template

You can then edit each detected value, click **Apply Replacements**, and the modified template is ready to send back to the linter. Useful for sanitising templates before sharing, or for swapping out placeholder URLs in bulk.

> 📷 **Screenshots to add (Variables tab — two total):**
> 1. Variables tab after clicking **Analyze** on the Sample template — left side shows the source, right side shows the categorised token list.
> 2. Edit mode — one or two values changed, with the **Apply Replacements** button highlighted.

---

## Tab 6 — Preview

Render the template with mock data to see what subscribers would actually receive.

**Workflow**
1. Paste a CleverTap Liquid template (email HTML, push body, in-app payload).
2. Click **Detect Variables** — the tool builds a form for every Profile / Event / Linked / assigned variable it found.
3. Fill in mock values (or accept the auto-generated ones).
4. Click **Render** — see the fully resolved output.
5. Toggle between **Rendered** view (HTML preview) and **Source** view (raw output after Liquid evaluation).

> 📷 **Screenshots to add (Preview tab — two total):**
> 1. Preview tab after **Detect Variables** — mock-data form visible on the left with detected fields.
> 2. **Rendered** view of an email after **Render** — shows the styled email preview as a subscriber would see it.

---

# Security & Privacy

> **TL;DR — Templates pasted into CleanSlate (or imported via the Chrome extension) never leave your browser. The tool reports anonymous usage events (feature clicks, surface tags, error counts — **never** template content) to CleverTap's own analytics so the team can see how the tool is being used internally. All linting, conversion, and rendering still happens locally inside the open browser tab.**

## What the site does *not* do

CleanSlate is a fully **client-side, static** web app. It has no server-side component of its own. Verified against the source code:

| Concern | Status |
|---|---|
| Backend server that receives template content | ❌ None — site is served as static files from GitHub Pages |
| `fetch()` / `XMLHttpRequest` / `WebSocket` calls that send **template content** | ❌ None — templates never leave your browser |
| Analytics for **template content** | ❌ Templates are never captured by analytics |
| `localStorage` / `sessionStorage` / IndexedDB writes of template content | ❌ None |
| Clipboard *reading* without an explicit click | ❌ None — clipboard is only written *to*, when you click a **Copy** button |
| Third-party tracking pixels | ❌ None |
| Sharing data with third-party analytics providers (Google, Mixpanel, etc.) | ❌ None |

Everything you paste — HTML, Liquid, Profile attributes, Event values, mock data — stays inside the browser tab and is discarded the moment you close it.

## Anonymous usage analytics

To help the internal team understand how the tool is being used (and prioritise improvements), CleanSlate sends a small set of **anonymous event counts** to CleverTap's own analytics platform via the CleverTap Web SDK. This is the *only* network call made by the tool itself.

**What is sent:**

| Event | Properties (non-content metadata only) |
|---|---|
| `Tool Visited` | `surface` (one of: `direct`, `new_tab_extension`, `side_panel`), `panel_mode` (true/false) — fires on every load |
| `Side Panel Opened` | (no extra props — fires alongside `Tool Visited` when surface is `side_panel`) |
| `New Tab Extension Opened` | (no extra props — fires alongside `Tool Visited` when surface is `new_tab_extension`) |
| `Template Imported` | `source` (`selection`, `sidepanel`, `fallback`, …), `size_kb` (number), `was_unwrapped` (true/false) |
| `Sample Loaded` | `kind` (`valid` or `broken`) |
| `Format Clicked` | `size_kb` (number) |
| `LP To CT Conversion Clicked` | (no properties) |
| `Tab Switched` | `tab` (one of: `linter`, `builder`, `reference`, `tools`, `variables`, `preview`) |
| `Fix Applied` | `severity` (`error` / `warning`), `fix_type` (e.g. `decode_html_entities`) |
| `Side Panel Apply Clicked` | `severity` |

**What is NOT sent:**

- Template content (HTML, Liquid, Profile/Event/Linked values, anything you paste)
- Error or warning messages that include template snippets
- Filenames or URLs from your campaigns
- Your email, name, employee ID, or any personal identifier — tracking is device-level only, not per-TAM
- Your IP address (the SDK is configured with `useIP: false`)

**Where it's sent:**

- CleverTap's own analytics infrastructure (the same internal project the team already operates).
- Sent over HTTPS to CleverTap's region endpoint, not to any third party.

If you (or a client) would prefer the tool to send nothing at all, **open a browser-level "do not track" extension or simply load the linter with a `?noanalytics=1` flag** (planned, not yet implemented — speak to the owner if you need this).

## How the Chrome extension behaves

The extension is equally minimal:

- It activates **only when you click its toolbar icon** — no background scraping, no automatic activity.
- It runs **only on `clevertap.com` and `app.getbee.io`** (declared in the manifest's host permissions).
- On click, it reads the HTML from the editor on the current page and opens a new tab pointing at the CleanSlate site, passing the template in the URL fragment (`#template=…`).
- It makes **no network requests** of its own — no analytics, no logging, no remote calls.
- The URL fragment is **never sent to any server** (browsers don't transmit the part of a URL after `#` in HTTP requests); the site reads it locally and then immediately scrubs it from the URL so it's not retained in browser history.

## Honest disclosures (third-party dependencies)

For completeness, here is what the page legitimately loads from third parties, so a security review has nothing hidden:

| Dependency | Loaded from | Why | What it sees |
|---|---|---|---|
| CodeMirror (editor) | `cdnjs.cloudflare.com` | Standard code editor used in the linter pane | Your IP and that you visited the site. **Cannot see template content** — template content is generated in your browser after the script loads. |
| LiquidJS (rendering engine) | `cdn.jsdelivr.net` | Powers the Preview tab's rendering | Same as above — IP only, no template content. |
| Google Fonts | `fonts.googleapis.com`, `fonts.gstatic.com` | Inter and JetBrains Mono fonts for the UI | Your IP only. No template content. |
| GitHub Pages hosting | `rubenico0601.github.io` | Serves the static HTML/JS/CSS | Standard web-server access logs (IP, URL, user-agent). **No template content** — templates are never sent in any HTTP request. |
| CleverTap Web SDK | `clevertap.com` (internal CT analytics project) | Counts anonymous usage events — see *Anonymous usage analytics* above | Event names (`Tool Visited`, `Fix Applied`, etc.) and non-content properties (surface, size in KB, severity). IP is suppressed (`useIP: false`). **Never** template content. |

These third parties see *that* you visited, not *what* you pasted. Template content has no code path that could reach them.

## If you need a hardened deployment (compliance-sensitive client)

Two optional changes that the security team of a regulated client may ask for. Neither affects functionality:

1. **Subresource Integrity (SRI) hashes** on the CDN-loaded libraries (CodeMirror, LiquidJS). This guarantees the browser refuses to execute the library if it has been tampered with at the CDN. Standard, well-understood mitigation.
2. **Self-host the Google Fonts** files (instead of loading from `fonts.googleapis.com`). Removes the residual privacy concern around Google receiving the user's IP. Some EU clients flag this under GDPR.

Both are small, one-time changes; reach out to the owner listed at the top of this page if a client asks for them.

## Frequently asked

**Q: Can my pasted template be seen by anyone other than me?**
No. Template content is processed entirely in your own browser tab. It is never sent to a server, not saved in cloud storage, not logged, and not captured by the usage analytics. If you close the tab without copying it, it is gone.

**Q: Does the Chrome extension send my templates anywhere?**
No. It reads the current page's editor on click and either opens a new tab or pipes the template into the side-panel iframe. It performs no network requests of its own.

**Q: What does the tool report back to CleverTap analytics, then?**
Only anonymous usage events — *that* you visited and *which buttons you clicked*. See the *Anonymous usage analytics* section above for the full event list. Template content, error messages with template snippets, your email, and your IP are explicitly not captured.

**Q: Is the template visible in browser history?**
The extension passes templates via the URL hash for the hand-off. The site scrubs the hash immediately after import via `history.replaceState`, so it does not persist in browser history.

**Q: Does GitHub know what templates I'm linting?**
GitHub Pages logs standard request metadata (your IP, the URL path, your user-agent). It does not see template content — templates never travel in an HTTP request because the site has no backend to send them to.

**Q: Can I use this with confidential client data?**
For internal CleverTap use and most client work: yes, with confidence. For deployments with strict compliance requirements (e.g. healthcare, financial, regulated EU clients), consider the two hardening steps above before pasting confidential data, and consult your security team if in doubt.

---

# Chrome extensions — pick a flavor

There are two Chrome extensions available. Both pull the template straight from the BEE Plugin editor on the CleverTap dashboard, so you never have to copy/paste. They differ in *where* the linter appears.

| | **Option A — New tab** | **Option B — Side panel** |
|---|---|---|
| Where the linter opens | A fresh Chrome tab next to the dashboard | A panel pinned to the right edge of the dashboard tab |
| Best for | Full editing — using the Builder, Reference, Tools, Variables, and Preview tabs | Quick error triage and fixing — staying in flow on the dashboard |
| Workflow | Click icon → switch to the new tab → see everything | Click icon → panel slides in → errors appear inline, no tab switch |
| Direct write-back to BEE | No — copy fixes manually | **Yes** — click "Apply to dashboard" and the BEE editor updates in place |
| Browser support | Any Chromium browser (Chrome, Edge, Brave, Arc, Opera) | Chrome 114+. Other Chromium browsers fall back to a new-tab open. |
| Install zip | `cleanslate-extension.zip` | `cleanslate-sidepanel-extension.zip` |

**Which should you install?**
- If you're new to CleanSlate or want the full toolkit visible at once → **Option A**.
- If you mostly want to spot errors and fix them quickly while editing on the dashboard → **Option B** (this is what most colleagues will prefer after they've used it once).
- **You can install both** — they don't conflict. The new-tab icon and the side-panel icon look slightly different so you can tell them apart in your toolbar.

---

# Option A — New-tab launcher

A thin companion extension that adds a CleanSlate icon to the Chrome toolbar. When clicked while on the CleverTap dashboard, it reads the full HTML template directly out of the editor (including the BEE Plugin HTML properties panel) and opens the linter in a new tab with the template pre-loaded — no copy/paste needed.

## What you'll be downloading

At the top of this Confluence page you'll find an attachment called **`cleanslate-extension.zip`**. Download it. Once unzipped, you'll see a folder called `chrome-extension/` containing three files:

```
chrome-extension/
├── manifest.json
├── background.js
└── icon-128.png
```

Keep all three files together inside the same folder — Chrome needs them in one place to load the extension.

## Installing the extension (one-time setup)

You only need to do this once. After that, the icon stays in your Chrome toolbar.

1. **Download** `cleanslate-extension.zip` from the attachments section of this page.
2. **Unzip** it somewhere safe where you won't accidentally delete it later — for example, `~/Documents/cleanslate-extension/` on Mac or `C:\Users\<you>\Documents\cleanslate-extension\` on Windows. After unzipping you should see the `chrome-extension/` folder with the three files listed above.
3. Open Chrome and go to **`chrome://extensions`** (paste that into the address bar).
4. In the **top-right** corner of that page, toggle **Developer mode** to **ON**.
5. In the **top-left**, click **Load unpacked**.
6. In the folder-picker dialog, navigate to where you unzipped the file and select the `chrome-extension/` folder. Click **Open** (or **Select Folder**).
7. The CleanSlate extension now appears in your list. A purple `</>` icon will show up in your Chrome toolbar.
8. If the icon is hidden behind the puzzle-piece menu, click the puzzle piece, find **CleanSlate Liquid Linter**, and click the pin icon next to it to keep it visible in the toolbar.

You're done. The icon is now ready to use on any CleverTap dashboard tab.

> 📷 **Screenshots to add (Option A install — three total):**
> 1. `chrome://extensions` page with the **Developer mode** toggle highlighted.
> 2. The **Load unpacked** button highlighted, with the folder-picker dialog showing the `chrome-extension/` folder selected.
> 3. The CleanSlate icon pinned in the Chrome toolbar.

## How to use it

1. Open the CleverTap dashboard and navigate to the email/push campaign you want to lint.
2. Open the HTML editor (either the source-code view or BEE Plugin's HTML properties panel).
3. Click the CleanSlate icon in the Chrome toolbar.
4. A new tab opens with the linter, the template already pasted and auto-linted. Properties are detected, errors are highlighted.

> 📷 **Screenshots to add (Option A usage — two total):**
> 1. CleverTap dashboard with the BEE Plugin HTML properties panel visible and the CleanSlate icon highlighted in the toolbar (with an arrow pointing to it).
> 2. The new tab that opens — the linter already populated with the template, errors visible on the right.

## What updates automatically vs. what doesn't

| Change | Do you need to do anything? |
|---|---|
| Any update to the website (new linter rules, new builder templates, UI tweaks, bug fixes) | **No** — your next click picks up the latest version automatically. You don't need to reinstall or refresh anything. |
| Changes to the extension itself (very rare — only if Chrome or BEE change how the editor works) | Yes — you'll be sent an updated zip; drop the new folder in and re-load it via `chrome://extensions` once. |

## Troubleshooting

- **Icon does nothing** → Refresh the CleverTap dashboard tab once and try again. The extension needs the page to be fully loaded.
- **New tab opens but the template is empty** → The editor wasn't focused. Click anywhere inside the HTML editor first, then click the icon.
- **"This extension has new permissions" prompt** → Click **Accept**. The extension needs permission to read content from `clevertap.com` and `getbee.io` (the BEE Plugin host).

---

# Option B — Side panel (recommended)

A companion extension that opens the linter in Chrome's **side panel** — a strip pinned to the right edge of the dashboard tab. You see the dashboard and the linter at the same time, no tab switching. The panel is purpose-built for narrow widths: instead of showing the editor again (the HTML is already on the dashboard, after all), it shows **just the issues list**. Click any issue to expand it, see the offending line in context, edit it inline, and click **Apply to dashboard** — the BEE editor on the left updates in place. No copy/paste, no tab switching.

## What you'll be downloading

At the top of this Confluence page you'll find an attachment called **`cleanslate-sidepanel-extension.zip`**. Download it. Once unzipped, you'll see a folder called `chrome-extension-sidepanel/` containing six files:

```
chrome-extension-sidepanel/
├── manifest.json
├── background.js
├── sidepanel.html
├── sidepanel.css
├── sidepanel.js
└── icon-128.png
```

Keep all six files together inside the same folder — Chrome needs them in one place to load the extension.

## Installing the side-panel extension (one-time setup)

Same flow as the new-tab extension. You only need to do this once.

1. **Download** `cleanslate-sidepanel-extension.zip` from the attachments section of this page.
2. **Unzip** it somewhere safe where you won't accidentally delete it later — for example, `~/Documents/cleanslate-sidepanel/` on Mac or `C:\Users\<you>\Documents\cleanslate-sidepanel\` on Windows. After unzipping you should see the `chrome-extension-sidepanel/` folder with the six files listed above.
3. Open Chrome and go to **`chrome://extensions`** (paste that into the address bar).
4. In the **top-right** corner of that page, toggle **Developer mode** to **ON** if it isn't already.
5. In the **top-left**, click **Load unpacked**.
6. In the folder-picker dialog, navigate to where you unzipped the file and select the `chrome-extension-sidepanel/` folder. Click **Open** (or **Select Folder**).
7. **CleanSlate Liquid Linter (Side Panel)** appears in your extensions list. A new purple icon shows up in your Chrome toolbar.
8. If the icon is hidden behind the puzzle-piece menu, click the puzzle piece, find **CleanSlate Liquid Linter (Side Panel)**, and click the pin icon next to it.

> 📷 **Screenshots to add (Option B install — three total):**
> 1. `chrome://extensions` page showing the **CleanSlate Liquid Linter (Side Panel)** extension card after Load unpacked.
> 2. The Chrome puzzle-piece menu open, with the side-panel extension being pinned.
> 3. Both CleanSlate icons (new-tab + side panel) pinned side-by-side in the toolbar — useful if you've installed both.

## How to use it

1. Open the CleverTap dashboard and navigate to the email/push campaign you want to lint.
2. Open the HTML editor (either the source-code view or BEE Plugin's HTML properties panel).
3. Click the **CleanSlate (Side Panel)** icon in the Chrome toolbar. The side panel slides in from the right edge of the window. The panel header shows a purple **"Import current template"** button.
4. Click **"Import current template"**. The panel reads the BEE editor and displays every error and warning the linter finds. The counter at the top tells you how many issues exist.
5. Click any issue card to expand it. You'll see:
   - The line above the problem
   - The problematic line (highlighted in red)
   - The line below
   - An editable textarea pre-filled with the bad line
6. **Edit the line** in the textarea to fix the issue. As soon as your edit differs from the original, the **Apply to dashboard** button lights up in purple.
7. Click **Apply to dashboard**. The BEE editor on the left side of the CleverTap dashboard updates in place with your fix. The panel re-lints and the issue disappears from the list.
8. Repeat for each issue. When everything's clean, save your campaign in CleverTap as usual.

> 📷 **Screenshots to add (Option B usage — five total):**
> 1. The CleverTap dashboard with the side panel open on the right, empty state ("Waiting for template…").
> 2. After clicking **Import current template** — issues list populated, summary pill at top showing the count.
> 3. An issue card expanded — context lines + the editable textarea visible, **Apply to dashboard** button still greyed out (no edit yet).
> 4. Same card with an edit made — **Apply to dashboard** button now bright purple.
> 5. After clicking Apply — the BEE editor on the left has been updated, the issue is gone from the panel, success toast visible.

## What "Apply to dashboard" actually does

When you click Apply, the panel doesn't just copy the fix to your clipboard. It uses Chrome's scripting permissions to directly update the BEE Plugin's internal editor — the same field you'd type into manually on the dashboard. After it runs, you can save the campaign and the fix will be persisted to CleverTap exactly as if you'd typed it yourself.

It replaces the entire template, not just the one line, so any other edits you've been making in the BEE editor will be preserved as part of the same write. If you'd rather not have automatic write-back, you can still copy-paste manually — the textarea content is freely selectable.

## What updates automatically vs. what doesn't

Same as Option A:

| Change | Do you need to do anything? |
|---|---|
| Any update to the website (linter rules, panel layout, error messages) | **No** — your next panel open picks up the latest version automatically. |
| Changes to the extension itself (rare) | Yes — you'll be sent an updated zip; drop the new folder in and reload it via `chrome://extensions` once. |

## Troubleshooting

- **Icon does nothing** → Make sure you're on Chrome 114 or newer (`chrome://version`). On older Chromium browsers (Brave, older Edge), clicking the icon falls back to opening the linter in a new tab.
- **Panel opens but the iframe is blank** → A network blip or the GitHub Pages site is temporarily unreachable. Reload the panel by closing it and clicking the icon again.
- **"Import current template" says success but nothing appears** → The HTML editor wasn't focused on the dashboard. Click into the BEE Plugin HTML view first, then click Import again.
- **"Could not read template: Cannot access contents of the page"** → Chrome blocked access to the BEE iframe. Remove and reinstall the extension from `chrome://extensions` (this triggers the permission prompt fresh — accept it).
- **Apply to dashboard says success but the BEE editor didn't update** → The dashboard's HTML editor was closed before you clicked Apply. Open the HTML view again and re-import.
- **The side panel stays open across all tabs** → Yes, this is currently expected behavior. Chrome's side panel persists across tabs by design. Close the panel manually using the **×** in its header when you're done.

---

# How to publish this to Confluence

1. In Confluence, create a new page and give it the title **CleanSlate — CleverTap Liquid Linter & Toolkit**.
2. Click the **`+`** (Insert) menu → **Markup** → paste the contents of this file → select **Markdown** → **Insert**.
3. Replace each `> 📷 Screenshot to add:` block with the actual screenshot, captured per the descriptions above.
4. Attach **both** zip files to the page (Confluence: page actions → **Attachments** → upload):
   - `cleanslate-extension.zip` (new-tab launcher)
   - `cleanslate-sidepanel-extension.zip` (side panel)
5. Link each zip in the corresponding **"What you'll be downloading"** section so colleagues can download whichever flavor they want directly from this doc.

**Total screenshots needed: 25**

| Section | Count |
|---|---|
| Top toolbar | 1 |
| Linter tab | 3 |
| Builder tab | 2 |
| Reference tab | 1 |
| Tools tab | 2 |
| Variables tab | 2 |
| Preview tab | 2 |
| Option A — install | 3 |
| Option A — usage | 2 |
| Option B — install | 3 |
| Option B — usage | 5 |
| (Optional) header banner | +1 |
