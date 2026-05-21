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

  window.CleanSlateAmp = {
    validate: validate,
    looksLikeAmp4Email: looksLikeAmp4Email,
  };
})();
