/**
 * CleanSlate Analytics — CleverTap Web SDK wrapper.
 *
 * Tracks anonymous, device-level usage of the tool. Captures event NAMES
 * and counts only — never template content, error messages with template
 * snippets, or anything that could leak client HTML.
 *
 * Loaded on every page (direct visits, new-tab extension hand-offs, and
 * side-panel iframe). Each event is tagged with `surface` so you can
 * break usage down by entry point in your CT dashboard.
 *
 * Surfaces:
 *   • "direct"             — someone opened the URL themselves
 *   • "new_tab_extension"  — opened from the Chrome new-tab extension
 *   • "side_panel"         — running inside the Chrome side-panel iframe
 */

(function () {
  'use strict';

  // ─── Configuration ─────────────────────────────────────────
  // SET BEFORE DEPLOYING. Find this in your CleverTap dashboard:
  //   Settings → Project ID (top of the page).
  // This is NOT a secret — it appears in client-side JS like a Google
  // Analytics property ID. Safe to commit.
  const CT_ACCOUNT_ID = '8R5-4Z4-ZK7Z';

  // Region of your CleverTap project. One of: 'us1', 'eu1', 'in1', 'sg1',
  // 'aps3', 'mec1'. If unsure, check the URL you log into CT with — the
  // subdomain before "dashboard.clevertap.com" is your region.
  const CT_REGION = 'eu1';

  // ─── Bail out cleanly if not configured ───────────────────
  // Lets the site keep working with no analytics until credentials land.
  // Guard matches the original placeholder literal only — don't change this
  // to compare against the real ID, or analytics will silently no-op.
  if (!CT_ACCOUNT_ID || CT_ACCOUNT_ID === 'YOUR_CT_ACCOUNT_ID_HERE') {
    window.CleanSlateAnalytics = {
      track: function () {},
      ready: false,
      surface: 'unconfigured',
    };
    return;
  }

  // ─── SDK bootstrap (standard CleverTap Web SDK snippet) ───
  window.clevertap = window.clevertap || {
    event: [], profile: [], account: [], onUserLogin: [],
    notifications: [], privacy: [],
  };
  window.clevertap.account.push({ id: CT_ACCOUNT_ID });
  window.clevertap.region = CT_REGION;
  // Anonymous tracking: don't collect IPs, no PII identifiers sent.
  window.clevertap.privacy.push({ optOut: false });
  window.clevertap.privacy.push({ useIP: false });

  (function loadSdk() {
    const wzrk = document.createElement('script');
    wzrk.type = 'text/javascript';
    wzrk.async = true;
    wzrk.src =
      document.location.protocol === 'https:'
        ? 'https://d2r1yp2w7bby2u.cloudfront.net/js/clevertap.min.js'
        : 'http://static.clevertap.com/js/clevertap.min.js';
    const first = document.getElementsByTagName('script')[0];
    if (first && first.parentNode) first.parentNode.insertBefore(wzrk, first);
  })();

  // ─── Surface detection ────────────────────────────────────
  function detectSurface() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('panel') === '1') return 'side_panel';
      const hash = window.location.hash || '';
      if (hash && hash.length > 1) {
        const hashParams = new URLSearchParams(hash.substring(1));
        if (hashParams.get('src')) return 'new_tab_extension';
      }
    } catch (e) {}
    return 'direct';
  }

  const surface = detectSurface();

  // ─── Public API ───────────────────────────────────────────
  // Usage: window.CleanSlateAnalytics.track('Event Name', { key: value });
  // Always non-throwing. Always async. Safe to call before SDK loads —
  // events queue and flush automatically once the SDK is ready.
  function track(eventName, props) {
    try {
      const payload = Object.assign({ surface: surface }, props || {});
      window.clevertap.event.push(eventName, payload);
    } catch (e) {
      // Analytics must never break the app.
    }
  }

  // Side-panel "Import current template" reloads the iframe with a
  // template hash. That reload re-runs this whole script, which would
  // otherwise re-fire Tool Visited and Side Panel Opened every time.
  // Suppress both on the side-panel reload path — Template Imported is
  // already the event that represents what the user did. Direct visits
  // and new-tab extension opens are always genuine new sessions, so they
  // fire normally.
  function hasTemplateHash() {
    try {
      const hash = window.location.hash || '';
      if (!hash || hash.length <= 1) return false;
      return new URLSearchParams(hash.substring(1)).has('template');
    } catch (e) {
      return false;
    }
  }

  const isSidePanelReload = surface === 'side_panel' && hasTemplateHash();

  if (!isSidePanelReload) {
    track('Tool Visited', { panel_mode: surface === 'side_panel' });
    if (surface === 'side_panel') {
      track('Side Panel Opened');
    } else if (surface === 'new_tab_extension') {
      track('New Tab Extension Opened');
    }
  }

  window.CleanSlateAnalytics = { track: track, ready: true, surface: surface };
})();
