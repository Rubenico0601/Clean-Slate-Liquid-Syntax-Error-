/**
 * HtmlUnwrapper — Turns HTML copied out of the CleverTap email editor back
 * into a plain, renderable .html file.
 *
 * Two kinds of junk get added on the way out of the editor:
 *
 *  1. Rich-text wrapping. Copying the source view puts every line of the
 *     template inside <p class="p1">…</p> with the markup HTML-escaped
 *     (&lt;table&gt;) and tabs turned into <span class="Apple-tab-span">.
 *     A browser then renders the code instead of the email.
 *
 *  2. CKEditor "protected source" blocks:
 *       <!--{cke_protected}{C}%3C!%2D%2D…%2D%2D%3E-->
 *     These hold the URL-encoded MSO conditional comments and <meta> tags
 *     that BEE emits. Left encoded they are dead weight; decoded they are
 *     the original Outlook fallbacks.
 *
 * Everything here is string/DOM work in the browser — nothing is uploaded.
 */

(function () {
  'use strict';

  const DEFAULTS = {
    protectedMode: 'restore',   // 'restore' | 'remove' | 'keep'
    stripEditorMarkup: false,   // data-bee-*, tinyMce placeholder, <code> speciallink
    fixMojibake: true,          // PiÃ±ata → Piñata
    addDoctype: true,
  };

  // ─── Detection ────────────────────────────────────────────
  // Is this a rich-text paste (escaped markup inside <p>/<div>) rather
  // than raw HTML?
  function looksWrapped(raw) {
    if (/Cocoa HTML Writer|Apple-tab-span/i.test(raw)) return true;
    const escaped = (raw.match(/&lt;\/?[a-zA-Z!]/g) || []).length;
    if (escaped < 5) return false;
    // More escaped tags than real ones ⇒ the markup is the content.
    const real = (raw.match(/<\/?[a-zA-Z!]/g) || []).length;
    return escaped >= real * 0.5;
  }

  // ─── Rich-text unwrap ─────────────────────────────────────
  // Text of a node, with <br> counting as a line break. textContent does
  // the entity decoding for us (&lt; → <, &amp; → &).
  function nodeText(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    if (node.tagName === 'BR') return '\n';
    let out = '';
    for (let i = 0; i < node.childNodes.length; i++) {
      out += nodeText(node.childNodes[i]);
    }
    return out;
  }

  function unwrapRichText(raw) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const body = doc.body;
    if (!body) return raw;

    // One source line per leaf block element. Blocks that contain other
    // blocks are skipped so nothing is emitted twice.
    const blocks = body.querySelectorAll('p, div, li, pre');
    const lines = [];
    for (let i = 0; i < blocks.length; i++) {
      const el = blocks[i];
      if (el.querySelector('p, div, li, pre')) continue;
      lines.push(nodeText(el).replace(/^\n+|\n+$/g, ''));
    }
    if (!lines.length) return nodeText(body);
    return lines.join('\n');
  }

  // ─── CKEditor protected source ────────────────────────────
  const PROTECTED_RE = /<!--\{cke_protected\}([\s\S]*?)-->/g;
  // Markers that mean "still encoded": angle brackets, hyphens of a
  // comment, or a doubly-encoded percent. A stray %20 inside a real URL
  // won't match, so we stop before mangling href values.
  const STILL_ENCODED_RE = /%3C|%3E|%2D%2D|%25(?:3C|3E|2D|22|20)/i;

  function decodeProtected(payload) {
    let s = payload;
    for (let i = 0; i < 6 && STILL_ENCODED_RE.test(s); i++) {
      let next;
      try {
        next = decodeURIComponent(s);
      } catch (e) {
        break;
      }
      if (next === s) break;
      s = next;
    }
    s = s.replace(/\{C\}/g, '').trim();

    // The editor wraps the protected markup in an extra comment layer (or
    // two). Peel those off, but never unwrap a genuine conditional
    // comment — that IS the payload.
    for (let i = 0; i < 4; i++) {
      if (s.indexOf('<!--') !== 0 || s.slice(-3) !== '-->') break;
      if (/^<!--\s*(\[if|<!\[endif)/i.test(s)) break;
      const inner = s.slice(4, -3).trim();
      if (inner.charAt(0) !== '<') break;
      s = inner;
    }
    return s;
  }

  // ─── Editor-only markup ───────────────────────────────────
  function stripEditorMarkup(html, stats) {
    let out = html;

    // <code data-bee-type="speciallink">…</code> wrappers around merge tags
    out = out.replace(/<code\b[^>]*\bdata-bee[^>]*>([\s\S]*?)<\/code>/gi, function (m, inner) {
      stats.editorMarkupRemoved++;
      return inner;
    });

    // data-bee-* attributes (quoted and bare)
    out = out.replace(/\s+data-bee-[\w-]*(?:=(?:"[^"]*"|'[^']*'))?/gi, function () {
      stats.editorMarkupRemoved++;
      return '';
    });

    // TinyMCE placeholder class left behind on headings
    out = out.replace(/\s*\btinyMce-placeholder\b/g, function () {
      stats.editorMarkupRemoved++;
      return '';
    });
    out = out.replace(/\sclass=(["'])\s*\1/g, '');

    return out;
  }

  // ─── Mojibake ─────────────────────────────────────────────
  // UTF-8 bytes that were read as Latin-1 ("PiÃ±ata"). Re-interpret them.
  function repairMojibake(html) {
    if (!/\u00c3[\u0080-\u00bf]|\u00e2\u20ac|\u00c2[\u00a0\u00a9\u00ae]/.test(html)) return null;
    try {
      const fixed = decodeURIComponent(escape(html));
      if (fixed && !/\u00c3[\u0080-\u00bf]|\u00e2\u20ac/.test(fixed)) return fixed;
    } catch (e) {}
    return null;
  }

  // ─── Main ─────────────────────────────────────────────────
  function clean(raw, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const stats = {
      unwrapped: false,
      protectedRestored: 0,
      protectedRemoved: 0,
      editorMarkupRemoved: 0,
      mojibakeFixed: false,
      doctypeAdded: false,
      bytesBefore: raw.length,
      bytesAfter: 0,
    };

    if (!raw || !raw.trim()) {
      return { html: '', stats: stats };
    }

    let html = raw;

    // 1. Unwrap the rich-text paste back into source text.
    if (looksWrapped(html)) {
      html = unwrapRichText(html);
      stats.unwrapped = true;
    }

    // 2. Protected-source blocks.
    if (opts.protectedMode !== 'keep') {
      html = html.replace(PROTECTED_RE, function (match, payload) {
        if (opts.protectedMode === 'remove') {
          stats.protectedRemoved++;
          return '';
        }
        const decoded = decodeProtected(payload);
        if (!decoded) {
          stats.protectedRemoved++;
          return '';
        }
        stats.protectedRestored++;
        return decoded;
      });
    }

    // 3. Editor-only attributes and wrappers.
    if (opts.stripEditorMarkup) {
      html = stripEditorMarkup(html, stats);
    }

    // 4. Encoding repair.
    if (opts.fixMojibake) {
      const fixed = repairMojibake(html);
      if (fixed !== null) {
        html = fixed;
        stats.mojibakeFixed = true;
      }
    }

    // 5. Tidy blank lines the unwrap leaves behind.
    html = html.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

    // 6. Doctype — the editor's copy starts at <html>, which puts
    //    browsers into quirks mode.
    if (opts.addDoctype && /<html[\s>]/i.test(html) && !/^\s*<!doctype/i.test(html)) {
      html = '<!DOCTYPE html>\n' + html;
      stats.doctypeAdded = true;
    }

    html += '\n';
    stats.bytesAfter = html.length;
    return { html: html, stats: stats };
  }

  window.HtmlUnwrapper = {
    unwrap: clean,
    looksWrapped: looksWrapped,
    decodeProtected: decodeProtected,
    DEFAULTS: DEFAULTS,
  };
})();
