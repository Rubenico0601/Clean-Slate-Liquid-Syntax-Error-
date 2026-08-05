# CleanSlate — Liquid Template Linter & Toolkit

> **What this is**
> A free, browser-based tool for checking and fixing Liquid templates before you send a campaign. It catches syntax errors with exact line numbers, validates AMP4Email against the official AMP spec, previews templates with mock data, and cleans up HTML copied out of the email editor. Everything runs inside your own browser — nothing you paste is uploaded.

| | |
|---|---|
| **Open the tool** | https://rubenico0601.github.io/Clean-Slate-Liquid-Syntax-Error-/ |
| **Cost / sign-in** | Free, no account, no login |
| **Liquid engine** | Matches CleverTap's LiqP `0.7.9` |
| **Works with** | Email (HTML), Push, In-App, Web Pop-up — any template using Liquid |
| **Support** | Ruben Charles · `ruben@clevertap.com` |

## What it solves

Liquid errors usually surface only at send time, in messages that don't tell you which line is at fault. CleanSlate catches them up front, in your browser, before the campaign is saved. It also bundles the small utilities that otherwise get done by hand: Leanplum-to-CleverTap conversion, epoch and minute converters, variable detection, mock-data preview, AMP validation, and email-editor paste cleanup.

## Contents

1. [Top toolbar](#top-toolbar-visible-on-every-tab)
2. [Tab 1 — Linter](#tab-1--linter-default)
3. [Tab 2 — Builder](#tab-2--builder)
4. [Tab 3 — Reference](#tab-3--reference)
5. [Tab 4 — Tools](#tab-4--tools)
6. [Tab 5 — Variables](#tab-5--variables)
7. [Tab 6 — Preview](#tab-6--preview)
8. [Tab 7 — AMP](#tab-7--amp-amp4email-validator)
9. [Tab 8 — Unwrap](#tab-8--unwrap)
10. [Security & Privacy](#security--privacy)

---

## Top toolbar (visible on every tab)

| Button | What it does |
|---|---|
| **LP → CT** | Converts a Leanplum Jinja2 template into CleverTap-compatible Liquid (handles `userAttribute['X']`, `userAttribute.X`, Jinja filters, etc.) |
| **Format** | Pretty-prints the HTML and puts each block-level Liquid tag on its own line |
| **Valid Sample** | Loads a clean, well-formed Liquid template — handy for seeing how the tool behaves |
| **Broken Sample** | Loads a template seeded with common Liquid mistakes, so you can see the linter at work |
| **Clear** | Empties the editor |

---

## Tab 1 — Linter (default)

The main feature. Paste any HTML / Liquid template into the editor on the left; errors appear on the right with the exact line number, the problematic snippet, and a fix suggestion.

**What it catches**
- Unbalanced or missing closing tags (`endif`, `endfor`, `endcapture`, …)
- Wrong opening / closing delimiters (`{%`, `{{`, `%}`, `}}`)
- Unknown tags or filters not supported by the LiqP 0.7.9 engine
- Quoted vs. unquoted `now` in date filters (a CleverTap-specific gotcha)
- Mismatched bracket notation in `Profile` / `Event` / `Linked` references
- Unbalanced `[` / `]` inside a Liquid tag — e.g. a missing opening bracket (`Event"Product Viewed"]`) or a missing closing one (`Event["Product Viewed"`). String literals are ignored while counting, so a `]` inside a quoted value won't cause a false positive.

**Right-side Properties panel**
- Lists the properties detected in your template (Profile attributes, Event keys, Linked tokens).
- Toggle it with **Hide Properties** / **Show Properties**.
- **Copy Errors** copies all findings to your clipboard, so you can paste them into a ticket or a message.

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

---

## Tab 3 — Reference

A scrollable cheat-sheet of every Liquid tag, filter, and operator supported by the LiqP 0.7.9 engine. Each entry shows the tag name, a one-line description, and a working example.

**Sections**
- **Block Tags** — `if`, `unless`, `for`, `case`, `comment`, `raw`, `tablerow`, `capture`
- **Standalone Tags** — `assign`, `increment`, `decrement`, `abort`, `break`, `continue`
- **String Filters** — `upcase`, `downcase`, `capitalize`, `replace`, `truncate`, etc.
- **Number Filters** — `plus`, `minus`, `times`, `divided_by`, `round`, etc.
- **Date Filters** — including the CleverTap-specific bare `now` keyword
- **Array Filters** — `first`, `last`, `size`, `join`, `sort`, etc.

---

## Tab 4 — Tools

Two standalone utilities.

### Minutes to Time
Convert "minutes from midnight" values (0–1439) from the Sent Log into readable 12-hour times. Includes quick-example chips (`0 → 12:00 AM`, `470 → 7:50 AM`, …).

### Epoch Timestamp Converter
Two-way converter:
- **Epoch → Readable Date** — paste a Unix timestamp, get GMT plus your local timezone.
- **Date → Epoch** — fill in year/month/day/hour/minute/second, pick GMT or Local, get the epoch in both seconds and milliseconds. **Use Now** auto-fills the current time.

---

## Tab 5 — Variables

Static analysis of a template. Paste the source, click **Analyze**, and the tool reports every dynamic token it found, grouped by type:

- **Profile / Event / Linked** tokens (both dot notation and bracket notation)
- **Assigned string literals** (values pulled from `{% assign %}` statements)
- **Image URLs** referenced inside the template
- **Anchor (link) URLs** referenced inside the template

You can then edit each detected value, click **Apply Replacements**, and send the modified template back to the linter. Useful for swapping placeholder URLs in bulk, or for sanitising a template before sharing it.

---

## Tab 6 — Preview

Render the template with mock data to see what a recipient would actually receive.

1. Paste a Liquid template (email HTML, push body, in-app payload).
2. Click **Detect Variables** — the tool builds a form for every Profile / Event / Linked / assigned variable it found.
3. Fill in mock values, or accept the auto-generated ones.
4. Click **Render** to see the fully resolved output.
5. Toggle between **Rendered** view (HTML preview) and **Source** view (raw output after Liquid evaluation).

---

## Tab 7 — AMP (AMP4Email validator)

Validates AMP4Email templates against the **official AMP validator** — the same engine behind validator.ampproject.org, and the one Gmail uses to decide whether your AMP email renders at all. Paste the template on the left; errors and warnings appear on the right with line and column numbers.

**Why it's a separate tab.** The Liquid linter would flag every `<amp-img>`, `<amp-carousel>`, and `<amp-form>` as an unknown tag, which is noise when the template is genuinely AMP. This tab applies the AMP rules instead.

**What each error row gives you**

| Element | What it does |
|---|---|
| Line / column | Click the row to jump the cursor straight to that spot in the editor |
| Validator message | The official AMP error text |
| **Suggested fix** | Plain-English guidance written for email developers, covering around 35 of the most common AMP4Email error codes — disallowed tags and attributes, inline `style` attributes, missing extension scripts, CSS restrictions, layout attributes, `http://` URLs, the 75 KB `<style amp-custom>` cap, missing boilerplate, and more |
| **Fix** button | One-click auto-fix, shown only where the correction is mechanical (see below) |
| **Spec** button | Opens the AMP spec page for that exact rule |

**What the Fix button will do automatically**

| Error code | Auto-fix applied |
|---|---|
| `DISALLOWED_ATTR` | Strips the offending attribute from that line |
| `DUPLICATE_ATTRIBUTE` | Removes the second occurrence only |
| `INVALID_URL_PROTOCOL` | Rewrites `http://` → `https://` on that line |
| `MISSING_REQUIRED_EXTENSION` | Inserts the correct `<script async custom-element="amp-…">` before `</head>`, and won't double-insert if it's already there |
| `EXTENSION_UNUSED` | Deletes the unused extension `<script>` line, after confirming that line really is the script tag |

Everything else stays suggestion-only by design — where a fix means choosing which value to keep or where to move content, that decision is yours. Validation re-runs after each fix, so the list shrinks as you work. The badge in the panel header shows a live **PASS** / *n* errors / *n* warnings count.

---

## Tab 8 — Unwrap

**The problem.** When you copy HTML out of the email editor and save it as a `.html` file, it doesn't render — you open it in a browser and see the code itself instead of the email. That's because the copy wraps every source line in `<p class="p1">` tags, escapes the markup (`&lt;table&gt;`), and turns tabs into `<span class="Apple-tab-span">`. On top of that, the editor hides the Outlook fallbacks as URL-encoded `<!--{cke_protected}…-->` blocks.

**The fix.** Paste that copy into the Unwrap tab. It rebuilds the real source and gives you a downloadable `.html` file that opens and renders as the actual email. A typical 118 KB paste comes out at around 17 KB.

**Options**

| Option | What it does |
|---|---|
| **Editor-protected comments** | *Restore* (default) decodes the hidden blocks back into real `<!--[if mso]>` conditional comments and `<meta>` tags, keeping your Outlook fallbacks — including the VML rounded button. *Remove* deletes them for a smaller, browser-only file. *Leave as-is* keeps them encoded. |
| **Strip editor-only markup** | Off by default. Removes `data-bee-*` attributes, the `tinyMce-placeholder` class, and `<code data-bee-type="speciallink">` wrappers. Off by default because unwrapping the `<code>` changes the document structure. |
| **Repair broken characters** | On by default. Fixes mis-encoded text (`PiÃ±ata` → `Piñata`, `â€™` → `’`). Only acts when that pattern is actually present. |
| **Add doctype** | On by default. The editor's copy starts at `<html>`, which puts browsers into quirks mode; this prepends `<!DOCTYPE html>`. |

**Output panel**
- **Code / Preview** toggle — Preview renders the result in a sandboxed frame so you can confirm it looks right before downloading.
- A summary lists exactly what changed (blocks decoded, doctype added, size in → size out).
- **Copy** puts the result on your clipboard; **Download** saves it under the filename you choose (defaults to `email.html`).

Cleanup runs as you type, so most of the time you paste and hit Download.

---

# Security & Privacy

> **In one line — nothing you paste into CleanSlate leaves your browser.** There is no backend, no upload, no storage. All linting, conversion, validation, and rendering happens locally in the open tab, and the content is gone the moment you close it. The tool reports anonymous, device-level usage counts (which buttons were clicked) and never any template content.

## What the site does not do

CleanSlate is a fully **client-side, static** web app with no server-side component. Verifiable against the source, which is public:

| Concern | Status |
|---|---|
| Backend server that receives template content | ❌ None — served as static files from GitHub Pages |
| `fetch()` / `XMLHttpRequest` / `WebSocket` calls that send **template content** | ❌ None — templates never leave your browser |
| Analytics on **template content** | ❌ Template content is never captured |
| `localStorage` / `sessionStorage` / IndexedDB writes of template content | ❌ None |
| Clipboard *reading* without an explicit click | ❌ None — the clipboard is only written *to*, when you click a **Copy** button |
| Third-party tracking pixels | ❌ None |
| Sharing data with third-party analytics providers (Google, Mixpanel, etc.) | ❌ None |

Everything you paste — HTML, Liquid, Profile attributes, Event values, mock data — stays inside the browser tab and is discarded when you close it.

## Anonymous usage analytics

CleanSlate records a small set of **anonymous event counts** so the maintainers can see which features are used and prioritise improvements. This is the only network call the tool itself makes. It is device-level and carries no identity.

**What is recorded:**

| Event | Properties (non-content metadata only) |
|---|---|
| `Tool Visited` | `surface` (how the tool was opened), `panel_mode` (true/false) |
| `Template Imported` | `size_kb` (number), `was_unwrapped` (true/false), `format` (`liquid` or `amp4email`) |
| `Sample Loaded` | `kind` (`valid` or `broken`) |
| `Format Clicked` | `size_kb` (number) |
| `LP To CT Conversion Clicked` | (no properties) |
| `Tab Switched` | `tab` (which of the eight tabs) |
| `Fix Applied` | `severity` (`error` / `warning`), `fix_type` (e.g. `decode_html_entities`) |
| `AMP Validated` | `status` (`PASS` / `FAIL`), `errors` (count), `warnings` (count) |
| `AMP Fix Applied` / `AMP Fix Failed` | `code` (the AMP error code, e.g. `DISALLOWED_ATTR`), `severity` |
| `HTML Unwrapped` | `trigger`, `unwrapped` (true/false), counts of decoded blocks, `size_kb` |
| `Unwrapped HTML Copied` / `Previewed` / `Downloaded` | `size_kb` on Downloaded; the others carry no properties |

Note the AMP rows: the error *code* is recorded (`DISALLOWED_ATTR`), but never the error text or the tag and attribute values it refers to — those come from your template and are not captured.

**What is NOT recorded:**

- Template content (HTML, Liquid, Profile / Event / Linked values — anything you paste)
- Error or warning messages that contain template snippets
- Filenames or URLs from your campaigns
- Your name, email, or any personal identifier — tracking is device-level only
- Your IP address (the SDK is configured with `useIP: false`)

**Where it goes:** CleverTap's own analytics project, over HTTPS, not to any third party.

## Third-party dependencies

For completeness, here is everything the page loads from a third party, so a security review has nothing hidden:

| Dependency | Loaded from | Why | What it sees |
|---|---|---|---|
| CodeMirror (editor) | `cdnjs.cloudflare.com` | The code editor in the linter pane | Your IP and that you loaded the script. **Cannot see template content** — your template only exists in the browser after the script has loaded. |
| LiquidJS (rendering engine) | `cdn.jsdelivr.net` | Powers the Preview tab | Same — IP only, no template content. |
| AMP validator (WebAssembly) | `cdn.ampproject.org` | Google's official AMP4Email validator, downloaded on first use of the AMP tab only | Your IP and that you downloaded the validator. **Cannot see template content** — it is a WebAssembly module that runs *inside your browser*; your template is passed to a local function call, never uploaded to Google. |
| Google Fonts | `fonts.googleapis.com`, `fonts.gstatic.com` | Inter and JetBrains Mono, for the interface | Your IP only. |
| GitHub Pages hosting | `rubenico0601.github.io` | Serves the static HTML / JS / CSS | Standard web-server access logs (IP, URL, user-agent). **No template content** — templates never travel in an HTTP request. |
| CleverTap Web SDK | `clevertap.com` | Records the anonymous usage counts described above | Event names and non-content properties (surface, size in KB, severity). IP is suppressed. **Never** template content. |

These third parties can see *that* you visited. None of them has a code path that could reach *what* you pasted.

## Optional hardening

If your security team asks for them, two changes are available. Neither affects functionality:

1. **Subresource Integrity (SRI) hashes** on the CDN-loaded libraries (CodeMirror, LiquidJS), so the browser refuses to execute a library that has been tampered with at the CDN.
2. **Self-hosting the Google Fonts** files instead of loading them from `fonts.googleapis.com`, removing the residual concern about Google receiving your IP. Some EU organisations flag this under GDPR.

Both are small, one-time changes. Contact the address at the top of this page if you need either.

## Frequently asked

**Q: Can anyone other than me see the template I paste?**
No. It is processed entirely in your own browser tab. It is never sent to a server, never saved to cloud storage, never logged, and never captured by the usage analytics. If you close the tab without copying it, it is gone.

**Q: What exactly does the tool report back, then?**
Only anonymous usage counts — *that* the tool was opened and *which buttons were clicked*. See the analytics table above for the full list. Template content, error messages containing template snippets, your email, and your IP are explicitly not captured.

**Q: Does the AMP tab send my template to Google?**
No. It downloads Google's official validator as a WebAssembly module — the same one validator.ampproject.org uses — and runs it locally in your tab. `cdn.ampproject.org` sees that you downloaded the validator, the same way it would see you download a font, and nothing more. There is no upload step.

**Q: Does anything I paste into the Unwrap tab get uploaded?**
No. It is string and document processing in your browser, like every other tab. Download builds the file locally — no server round-trip. Preview renders into a sandboxed frame, which also blocks any scripts that might be inside the template.

**Q: Does GitHub know what templates I'm working on?**
GitHub Pages logs standard request metadata (IP, URL path, user-agent). It does not see template content — templates never travel in an HTTP request, because the site has no backend to send them to.

**Q: Can I use this with confidential data?**
For everyday campaign work, yes. If you operate under strict compliance requirements (healthcare, financial services, regulated EU data), review the optional hardening above with your security team first.

**Q: Do I need to install anything?**
No. It's a web page — open the URL and use it. There is nothing to download and no account to create.
