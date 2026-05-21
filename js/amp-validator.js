/**
 * CleanSlate AMP Validator — lazy loader for the official AMP validator.
 *
 * The validator is published by Google at cdn.ampproject.org as a free
 * client-side bundle. It's the same engine that powers
 * https://validator.ampproject.org and the one Gmail uses to gate
 * AMP4Email rendering. We load it on demand the first time someone
 * opens the AMP tab so the rest of the site stays fast.
 *
 * Public API on window.CleanSlateAmp:
 *   validate(html, format?)  — async; returns { status, errors[] }
 *   looksLikeAmp4Email(html) — sync; heuristic for auto-routing imports
 */

(function () {
  'use strict';

  const VALIDATOR_URL = 'https://cdn.ampproject.org/v0/validator_wasm.js';
  let loadPromise = null;

  function loadValidator() {
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      // Already loaded by a prior tab open
      if (window.amp && window.amp.validator) {
        const v = window.amp.validator;
        if (typeof v.init === 'function') {
          v.init().then(() => resolve(v)).catch(reject);
        } else {
          resolve(v);
        }
        return;
      }
      const s = document.createElement('script');
      s.src = VALIDATOR_URL;
      s.async = true;
      s.onload = () => {
        if (!window.amp || !window.amp.validator) {
          reject(new Error('AMP validator script loaded but global was not initialised.'));
          return;
        }
        const v = window.amp.validator;
        // The WASM variant needs init() to fetch + compile the rules bundle.
        if (typeof v.init === 'function') {
          v.init().then(() => resolve(v)).catch(reject);
        } else {
          resolve(v);
        }
      };
      s.onerror = () => reject(new Error('Failed to load AMP validator from ' + VALIDATOR_URL));
      document.head.appendChild(s);
    });
    return loadPromise;
  }

  async function validate(html, format) {
    format = format || 'AMP4EMAIL';
    const validator = await loadValidator();
    return validator.validateString(html, format);
  }

  // Heuristic — checks the first ~500 chars for the AMP4Email signature.
  // Covers both ASCII `amp4email` and the lightning-bolt unicode form.
  function looksLikeAmp4Email(html) {
    if (!html) return false;
    const head = html.slice(0, 500);
    if (head.indexOf('⚡4email') >= 0) return true; // ⚡4email
    if (/<html[^>]*amp4email/i.test(head)) return true;
    if (/<html[^>]*⚡4email/.test(head)) return true;
    return false;
  }

  // ─── Fix suggestions ──────────────────────────────────────
  // Maps AMP validator error codes to plain-English fix guidance.
  // `params` is the array of error-specific values the validator gives us
  // (e.g., for DISALLOWED_TAG, params[0] is the tag name). Not every error
  // code is covered — uncovered codes return null and the user falls back
  // to the validator's own message + Spec link.
  //
  // Codes referenced from:
  // https://github.com/ampproject/amphtml/blob/main/validator/validator.proto
  const AMP_FIX_SUGGESTIONS = {
    DISALLOWED_TAG: (p) =>
      `The tag <${p[0]}> isn't allowed in AMP4Email. Remove it, or replace with the AMP equivalent if one exists ` +
      `(common swaps: <img> → <amp-img>, <iframe> → <amp-iframe>, <video> → <amp-video>, <form> → <amp-form>).`,

    DISALLOWED_TAG_ANCESTOR: (p) =>
      `<${p[0]}> isn't allowed inside <${p[1]}>. Move it to a valid parent — check the AMP4Email spec for where this tag can live.`,

    DISALLOWED_CHILD_TAG_NAME: (p) =>
      `<${p[1]}> can't be a child of <${p[0]}>. Either remove the child or move it outside the parent.`,

    DISALLOWED_FIRST_CHILD_TAG_NAME: (p) =>
      `The first child of <${p[0]}> must be a specific tag; <${p[1]}> isn't valid here. Check the spec for the required first child.`,

    DISALLOWED_ATTR: (p) =>
      `The attribute \`${p[0]}\` isn't allowed on <${p[1]}> in AMP4Email. Remove it. ` +
      `(Common culprits: onclick / onload / on* event handlers, target="_top", and inline JavaScript-style attributes.)`,

    DISALLOWED_PROPERTY_IN_ATTR_VALUE: (p) =>
      `The value \`${p[1]}\` for \`${p[0]}\` isn't allowed in AMP4Email. Check the spec for accepted values for this attribute.`,

    DISALLOWED_STYLE_ATTR: () =>
      `Inline style attributes (style="...") aren't allowed in AMP4Email. Move the styles into your <style amp-custom> block in the <head>.`,

    DISALLOWED_RELATIVE_URL: (p) =>
      `Relative URLs aren't allowed for \`${p[0]}\` on <${p[1]}>. Replace with an absolute https:// URL.`,

    MANDATORY_ATTR_MISSING: (p) =>
      `<${p[1]}> requires the attribute \`${p[0]}\`. Add it.`,

    MANDATORY_ANYOF_ATTR_MISSING: (p) =>
      `<${p[1]}> requires at least one of these attributes: ${p[0]}. Add one.`,

    MANDATORY_ONEOF_ATTR_MISSING: (p) =>
      `<${p[1]}> requires exactly one of these attributes: ${p[0]}. Add one (not multiple).`,

    INVALID_ATTR_VALUE: (p) =>
      `The value of \`${p[0]}\` on <${p[2]}> isn't a valid AMP4Email value. Check the spec for accepted values.`,

    MANDATORY_TAG_MISSING: (p) =>
      `AMP4Email requires the tag <${p[0]}>. Add it — typically inside the <head>. ` +
      `(The required boilerplate includes: <meta charset>, <style amp4email-boilerplate>, <script async src="https://cdn.ampproject.org/v0.js">, and the ⚡4email attribute on <html>.)`,

    DUPLICATE_UNIQUE_TAG: (p) =>
      `Only one <${p[0]}> tag is allowed per AMP4Email document. Remove the duplicate.`,

    DUPLICATE_UNIQUE_TAG_WARNING: (p) =>
      `Only one <${p[0]}> tag should appear per AMP4Email document. Consolidate or remove duplicates.`,

    DUPLICATE_ATTRIBUTE: (p) =>
      `The attribute \`${p[0]}\` appears twice on the same tag. Remove one.`,

    DUPLICATE_DIMENSION: () =>
      `Duplicate width or height attributes on the same tag. Remove the duplicate.`,

    WRONG_PARENT_TAG: (p) =>
      `<${p[0]}> must be a child of <${p[2]}>, not <${p[1]}>. Move the tag into the correct parent.`,

    STYLESHEET_TOO_LONG: (p) =>
      `Your <style amp-custom> block is too long. AMP4Email caps inline CSS at 75 KB. Minify your CSS, drop unused rules, ` +
      `or split components into separate templates.`,

    CSS_SYNTAX_DISALLOWED_PROPERTY_VALUE: (p) =>
      `The CSS property \`${p[0]}\` with value \`${p[1]}\` isn't allowed in AMP4Email. ` +
      `Common offenders: position: fixed/sticky (use static/relative/absolute), !important (remove), behavior: url() (remove), ` +
      `transition timing functions outside the allowed set.`,

    CSS_SYNTAX_DISALLOWED_PROPERTY_VALUE_WITH_HINT: (p) =>
      `CSS \`${p[0]}: ${p[1]}\` isn't allowed. ${p[2] ? 'Try: ' + p[2] : 'Check the spec for accepted values.'}`,

    CSS_SYNTAX_DISALLOWED_PROPERTY: (p) =>
      `The CSS property \`${p[0]}\` isn't allowed in AMP4Email. Remove it. ` +
      `(filter, mix-blend-mode, behavior, and a few others are blocked. animation/transition properties are allowed but with restrictions.)`,

    CSS_SYNTAX_QUALIFIED_RULE_HAS_NO_DECLARATIONS: (p) =>
      `Empty CSS rule for selector \`${p[0]}\`. Add declarations inside { } or delete the empty rule.`,

    INVALID_URL: (p) =>
      `The URL in \`${p[0]}\` on <${p[2]}> isn't a valid AMP URL. Use a complete absolute URL starting with https://.`,

    INVALID_URL_PROTOCOL: (p) =>
      `URLs in AMP4Email must use https://. Found \`${p[0]}\` on <${p[2]}>. Change the protocol to https://.`,

    MISSING_URL: (p) =>
      `<${p[1]}> is missing the \`${p[0]}\` URL attribute. Add it.`,

    MISSING_REQUIRED_EXTENSION: (p) =>
      `Your template uses <${p[0]}> but is missing the matching extension script. ` +
      `Add this to <head>: <script async custom-element="${p[0]}" src="https://cdn.ampproject.org/v0/${p[0]}-0.1.js"></script>`,

    EXTENSION_UNUSED: (p) =>
      `The extension \`${p[0]}\` is loaded but not actually used in the template. Remove the <script> tag from <head> to keep the email lean.`,

    MUTUALLY_EXCLUSIVE_ATTRS: (p) =>
      `The attributes \`${p[0]}\` and \`${p[1]}\` can't both be set on the same tag. Remove one.`,

    INCONSISTENT_UNITS_FOR_WIDTH_HEIGHT: () =>
      `\`width\` and \`height\` attributes must use the same unit (both px, both em, or both unitless).`,

    SPECIFIED_LAYOUT_INVALID: (p) =>
      `\`layout="${p[0]}"\` isn't valid for <${p[1]}>. Try one of: fixed, responsive, fill, fixed-height, nodisplay, container, intrinsic.`,

    IMPLIED_LAYOUT_INVALID: (p) =>
      `The implied layout isn't valid for <${p[1]}>. Add an explicit \`layout="..."\` attribute (try responsive or fixed-height).`,

    MISSING_LAYOUT_ATTRIBUTES: (p) =>
      `<${p[0]}> needs layout attributes. Add width, height, and ideally layout="responsive" (or layout="fixed-height" + height only).`,

    TAG_NOT_ALLOWED_TO_HAVE_SIBLINGS: (p) =>
      `<${p[0]}> can't have sibling tags inside <${p[1]}>. It must be the only child. Wrap or move the siblings.`,

    MANDATORY_CDATA_MISSING_OR_INCORRECT: (p) =>
      `The content inside <${p[0]}> is missing or doesn't match what AMP4Email expects (e.g., the boilerplate <style> block has a fixed body). ` +
      `Compare to the canonical AMP4Email starter template.`,

    DISALLOWED_SCRIPT_TAG: () =>
      `Only specific <script> tags are allowed in AMP4Email: (1) the AMP runtime ` +
      `<script async src="https://cdn.ampproject.org/v0.js">, (2) custom-element extension scripts ` +
      `<script async custom-element="amp-XXX" src="https://cdn.ampproject.org/v0/amp-XXX-VERSION.js">, ` +
      `and (3) inline JSON config like <script type="application/json">. Inline JavaScript, third-party libraries, ` +
      `and event handlers are not allowed. Remove the offending <script> tag.`,

    DEV_MODE_ONLY: (p) =>
      `\`${p[0]}\` is only allowed during development and will be stripped from production AMP. Remove it before sending.`,

    INVALID_JSON_CDATA: (p) =>
      `The JSON content inside <${p[0]}> is malformed. Validate it with a JSON formatter and fix the syntax.`,

    DISALLOWED_DOMAIN: (p) =>
      `The domain in \`${p[0]}\` isn't allowed for this attribute in AMP4Email. ` +
      `Some attributes restrict URLs to specific trusted hosts — check the spec link.`,
  };

  // ─── Auto-fixes ────────────────────────────────────────────
  // Subset of error codes where the fix is purely mechanical and
  // doesn't require a user judgment call. Each handler takes (error, source)
  // and returns the new source string, or null if it can't safely fix.
  // The line/col coming from the validator drives where in the source to
  // operate. Anything ambiguous (which value to use, which duplicate to
  // keep, where to put removed content) deliberately stays a suggestion-
  // only error so the user makes the call.

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const AMP_AUTO_FIXES = {
    DISALLOWED_ATTR: (err, source) => {
      const attr = (err.params || [])[0];
      if (!attr) return null;
      const lines = source.split('\n');
      const lineIdx = (err.line || 1) - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) return null;
      // Match the attribute with optional value (quoted or bare). Leading
      // whitespace is consumed so we don't leave double spaces.
      const pattern = new RegExp(
        '\\s+' + escapeRegex(attr) + '(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s>]+))?',
        'i'
      );
      const newLine = lines[lineIdx].replace(pattern, '');
      if (newLine === lines[lineIdx]) return null;
      lines[lineIdx] = newLine;
      return lines.join('\n');
    },

    DUPLICATE_ATTRIBUTE: (err, source) => {
      const attr = (err.params || [])[0];
      if (!attr) return null;
      const lines = source.split('\n');
      const lineIdx = (err.line || 1) - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) return null;
      // Remove the *second* occurrence only.
      const pattern = new RegExp(
        '\\s+' + escapeRegex(attr) + '\\s*=\\s*(?:"[^"]*"|\'[^\']*\')',
        'gi'
      );
      let n = 0;
      const newLine = lines[lineIdx].replace(pattern, (m) => (++n === 2 ? '' : m));
      if (newLine === lines[lineIdx]) return null;
      lines[lineIdx] = newLine;
      return lines.join('\n');
    },

    INVALID_URL_PROTOCOL: (err, source) => {
      const lines = source.split('\n');
      const lineIdx = (err.line || 1) - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) return null;
      const newLine = lines[lineIdx].replace(/\bhttp:\/\//g, 'https://');
      if (newLine === lines[lineIdx]) return null;
      lines[lineIdx] = newLine;
      return lines.join('\n');
    },

    MISSING_REQUIRED_EXTENSION: (err, source) => {
      const extName = (err.params || [])[0];
      if (!extName) return null;
      // Don't double-insert if the script already exists.
      if (new RegExp('custom-element\\s*=\\s*["\']' + escapeRegex(extName) + '["\']').test(source)) {
        return null;
      }
      const tag =
        '  <script async custom-element="' + extName +
        '" src="https://cdn.ampproject.org/v0/' + extName + '-0.1.js"></script>\n';
      // Prefer inserting just before </head>.
      const headClose = source.match(/<\/head>/i);
      if (headClose && headClose.index !== undefined) {
        return source.slice(0, headClose.index) + tag + source.slice(headClose.index);
      }
      // Fall back to after <head> opener.
      const headOpen = source.match(/<head[^>]*>/i);
      if (headOpen && headOpen.index !== undefined) {
        const after = headOpen.index + headOpen[0].length;
        return source.slice(0, after) + '\n' + tag + source.slice(after);
      }
      return null;
    },

    EXTENSION_UNUSED: (err, source) => {
      const extName = (err.params || [])[0];
      if (!extName) return null;
      const lines = source.split('\n');
      const lineIdx = (err.line || 1) - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) return null;
      // Sanity-check: the named line really does contain the script tag
      // for the unused extension before we drop it.
      if (
        lines[lineIdx].indexOf(extName) >= 0 &&
        /<script\b/i.test(lines[lineIdx])
      ) {
        lines.splice(lineIdx, 1);
        return lines.join('\n');
      }
      return null;
    },
  };

  function canAutoFix(error) {
    return !!(error && error.code && AMP_AUTO_FIXES[error.code]);
  }

  function autoFix(error, source) {
    if (!error || !error.code) return null;
    const handler = AMP_AUTO_FIXES[error.code];
    if (!handler) return null;
    try {
      return handler(error, source);
    } catch (e) {
      return null;
    }
  }

  function suggestFix(error) {
    if (!error || !error.code) return null;
    const handler = AMP_FIX_SUGGESTIONS[error.code];
    if (!handler) return null;
    try {
      return handler(error.params || []);
    } catch (e) {
      return null;
    }
  }

  window.CleanSlateAmp = {
    validate: validate,
    looksLikeAmp4Email: looksLikeAmp4Email,
    suggestFix: suggestFix,
    canAutoFix: canAutoFix,
    autoFix: autoFix,
  };
})();
