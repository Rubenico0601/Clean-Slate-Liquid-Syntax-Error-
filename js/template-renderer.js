/**
 * Template Renderer — Renders a CleverTap LiqP template with mock data.
 *
 * Wraps LiquidJS and adds CleverTap-specific shims:
 *   - {% abort %} tag (returns empty output)
 *   - bare `now` keyword (mapped to current Date if not user-supplied)
 *
 * Differences from CleverTap's LiqP 0.7.9 still exist (LiquidJS is
 * Shopify-flavoured); this renderer is a fast iteration tool, not a
 * production substitute.
 */

class TemplateRenderer {

  constructor() {
    if (typeof liquidjs === 'undefined' || !liquidjs.Liquid) {
      throw new Error('LiquidJS is not loaded. Include liquid.browser.min.js before this script.');
    }
    this.engine = new liquidjs.Liquid({
      strictFilters: false,
      strictVariables: false,
      cache: false,
    });
    this._registerAbort();
  }

  _registerAbort() {
    this.engine.registerTag('abort', {
      parse() {},
      render() {
        const err = new Error('Template aborted by {% abort %}');
        err.isAbort = true;
        throw err;
      },
    });
  }

  async render(source, context) {
    // CleverTap LiqP exposes `none` as the "missing value" sentinel
    // (Python/Jinja-inspired). Standard Liquid uses `nil`/`null`; we
    // map `none` to null so `Event["X"] != none` works identically.
    const ctx = { now: new Date(), none: null, nil: null, ...context };
    try {
      const output = await this.engine.parseAndRender(source, ctx);
      return { ok: true, aborted: false, output, error: null };
    } catch (err) {
      if (TemplateRenderer._isAbort(err)) {
        return { ok: true, aborted: true, output: '', error: null };
      }
      return {
        ok: false,
        aborted: false,
        output: '',
        error: TemplateRenderer._formatError(err),
      };
    }
  }

  static _isAbort(err) {
    let cur = err;
    while (cur) {
      if (cur.isAbort) return true;
      cur = cur.originalError || cur.cause;
    }
    return false;
  }

  static _formatError(err) {
    const root = err.originalError || err;
    const message = root.message || String(root);
    let line = root.line ?? err.line ?? null;
    let col = root.col ?? err.col ?? null;
    // LiquidJS often embeds "line:N, col:N" inside the message string
    // rather than on the error object. Pull it out as a fallback.
    if (line === null) {
      const m = message.match(/line:?\s*(\d+)/i);
      if (m) line = parseInt(m[1], 10);
    }
    if (col === null) {
      const m = message.match(/col(?:umn)?:?\s*(\d+)/i);
      if (m) col = parseInt(m[1], 10);
    }
    return { message, line, col, name: root.name || 'Error' };
  }

  /**
   * Given a parsed inspection from VariableInspector, build a mock-data
   * skeleton suitable for `render()`'s context.
   */
  static buildContextFromInspection(inspection, formValues) {
    const context = {};
    for (const cat of inspection.categories) {
      for (const item of cat.items) {
        if (item.subtype === 'Profile') {
          context.Profile = context.Profile || {};
          const v = formValues?.[item.id];
          context.Profile[item.currentValue] = TemplateRenderer._coerce(v, item.currentValue);
        } else if (item.subtype === 'Event') {
          context.Event = context.Event || {};
          const [eventName, propName] = item.currentValue.split('.');
          const v = formValues?.[item.id];
          if (propName) {
            context.Event[eventName] = context.Event[eventName] || {};
            context.Event[eventName][propName] = TemplateRenderer._coerce(v, propName);
          } else {
            context.Event[eventName] = TemplateRenderer._coerce(v, eventName);
          }
        } else if (item.subtype === 'Linked') {
          context.Linked = context.Linked || {};
          const raw = formValues?.[item.id];
          context.Linked[item.currentValue] = TemplateRenderer._parseJsonOrString(raw);
        }
      }
    }
    return context;
  }

  static _coerce(value, _hint) {
    // Empty mock-form input → null, so `field != none` (which we map
    // to `field != null`) is false — matching CleverTap behaviour when
    // a profile/event property isn't set.
    if (value === undefined || value === null || value === '') return null;
    const trimmed = String(value).trim();
    if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    if (/^-?\d*\.\d+$/.test(trimmed)) return parseFloat(trimmed);
    // JSON array / object only (NOT bare true/false/null) — CleverTap
    // profiles are typically strings, and templates often string-compare
    // them (e.g. Profile.opted_out == "true").
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try { return JSON.parse(trimmed); } catch { /* fall through */ }
    }
    return trimmed;
  }

  static _parseJsonOrString(value) {
    if (!value || !String(value).trim()) return null;
    try {
      return JSON.parse(value);
    } catch {
      return String(value);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TemplateRenderer;
}
