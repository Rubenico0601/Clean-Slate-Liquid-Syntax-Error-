/**
 * Leanplum (Jinja2) → CleverTap (LiqP 0.7.9) Converter
 * Transforms Leanplum Liquid syntax into CleverTap-compatible Liquid syntax.
 */

class LeanplumConverter {
  constructor() {
    this.changes = [];
    this.warnings = [];
  }

  /**
   * Convert Leanplum template to CleverTap syntax.
   * Returns { output, changes, warnings }
   */
  convert(source) {
    this.changes = [];
    this.warnings = [];
    this.lines = source.split('\n');

    let result = source;

    // Order matters — some transforms depend on earlier ones
    result = this.convertComments(result);
    result = this.convertSetToAssign(result);
    result = this.convertUserAttributes(result);
    result = this.convertLinkedData(result);
    result = this.convertSkipMessage(result);
    result = this.convertAbortWrapping(result);
    result = this.convertNowFunction(result);
    result = this.convertLoopVariables(result);
    result = this.convertParseJson(result);
    result = this.convertFilterSyntax(result);
    result = this.convertLengthFilter(result);
    result = this.convertStringFilter(result);
    result = this.convertTimestampIdioms(result);
    result = this.convertDivideFilter(result);
    result = this.flagJinjaArrayFilters(result);
    result = this.flagRemainingTimeFilters(result);
    result = this.convertArrayLiterals(result);
    result = this.convertArrayMathIndex(result);
    result = this.flagManualReview(result);

    return {
      output: result,
      changes: this.changes,
      warnings: this.warnings,
    };
  }

  // ─── 1. Convert {# comment #} → {% comment %}...{% endcomment %} ──

  convertComments(source) {
    const regex = /\{#\s*([\s\S]*?)\s*#\}/g;
    let count = 0;

    const result = source.replace(regex, (_match, content) => {
      count++;
      return `{% comment %} ${content.trim()} {% endcomment %}`;
    });

    if (count > 0) {
      this.changes.push({
        type: 'auto',
        category: 'Comments',
        description: `Converted ${count} Jinja2 comment(s) from \`{# ... #}\` to \`{% comment %} ... {% endcomment %}\``,
        count,
      });
    }

    return result;
  }

  // ─── 2. Convert {% set %} → {% assign %} ────────────────────────

  convertSetToAssign(source) {
    const regex = /\{%[-\s]*set\s+/g;
    let count = 0;

    const result = source.replace(regex, (match) => {
      count++;
      // Preserve whitespace control hyphens
      return match.replace(/\bset\b/, 'assign');
    });

    if (count > 0) {
      this.changes.push({
        type: 'auto',
        category: 'Variable Assignment',
        description: `Converted ${count} \`{% set %}\` tag(s) to \`{% assign %}\``,
        count,
      });
    }

    return result;
  }

  // ─── 3. Convert userAttribute.X / userAttribute['X'] → Profile ──

  convertUserAttributes(source) {
    // Matches dot notation `userAttribute.foo` and bracket notation
    // `userAttribute['foo']` / `userAttribute["foo"]`. Bracket notation
    // is needed for keys with hyphens, spaces, or other non-identifier chars.
    const regex = /\buserAttribute(?:\.(\w+)|\[\s*(['"])([^'"]+)\2\s*\])/g;
    const found = new Set();
    let count = 0;

    const result = source.replace(regex, (_match, dotProp, quote, bracketProp) => {
      count++;
      if (dotProp) {
        found.add(dotProp);
        return `Profile.${dotProp}`;
      }
      found.add(bracketProp);
      return `Profile[${quote}${bracketProp}${quote}]`;
    });

    if (count > 0) {
      const propList = [...found].join(', ');
      this.changes.push({
        type: 'auto',
        category: 'User Properties',
        description: `Converted ${count} \`userAttribute\` reference(s) (dot and bracket notation) to \`Profile\` — properties: ${propList}`,
        count,
      });
    }

    return result;
  }

  // ─── 4. Convert linkedData references ──────────────────────────

  convertLinkedData(source) {
    const regex = /\blinkedData\.(\w+)(?:\[([^\]]+)\])?/g;
    const found = new Set();
    let count = 0;

    const result = source.replace(regex, (match, apiName, key) => {
      count++;
      found.add(apiName);
      // linkedData doesn't have a direct CleverTap equivalent
      // Keep the variable name but flag for manual review
      return match;
    });

    if (count > 0) {
      const apiList = [...found].join(', ');
      this.warnings.push({
        type: 'manual',
        category: 'Linked Data / API Calls',
        description: `Found ${count} \`linkedData\` reference(s) (APIs: ${apiList}). CleverTap does not have a direct equivalent — these need to be replaced with CleverTap Catalog or Custom API logic. Review and replace manually.`,
        severity: 'high',
      });
    }

    return result;
  }

  // ─── 5. Convert skipmessage() → {% abort %} ────────────────────

  convertSkipMessage(source) {
    // Match skipmessage() as a standalone call (possibly inside tags or text)
    const regex = /skipmessage\(\)/g;
    let count = 0;

    const result = source.replace(regex, () => {
      count++;
      return '{% abort %}';
    });

    if (count > 0) {
      this.changes.push({
        type: 'auto',
        category: 'Abort / Skip Message',
        description: `Converted ${count} \`skipmessage()\` call(s) to \`{% abort %}\``,
        count,
      });
    }

    return result;
  }

  // ─── Convert {{ {% abort %} }} → {% abort %} ───────────────────
  // Catches a common manual-migration mistake where `{% abort %}` is
  // wrapped in output braces (invalid Liquid).

  convertAbortWrapping(source) {
    const regex = /\{\{\s*\{%-?\s*abort\s*-?%\}\s*\}\}/g;
    let count = 0;

    const result = source.replace(regex, () => {
      count++;
      return '{% abort %}';
    });

    if (count > 0) {
      this.changes.push({
        type: 'auto',
        category: 'Abort Tag',
        description: `Unwrapped ${count} \`{{ {% abort %} }}\` occurrence(s) — \`{% abort %}\` is a tag and must not be inside output braces`,
        count,
      });
    }

    return result;
  }

  // ─── Convert now() and "now" → bare now ────────────────────────
  // LiqP 0.7.9 requires the bare `now` keyword. Both Leanplum's
  // `now()` and the common Shopify-Liquid form `"now"` fail here —
  // `"now"` gets treated as a literal string, not a date.

  convertNowFunction(source) {
    let parenCount = 0;
    let quotedCount = 0;

    // `now()` → `now`
    let result = source.replace(/\bnow\s*\(\s*\)/g, () => {
      parenCount++;
      return 'now';
    });

    // `"now" | date:` or `'now' | date:` → `now | date:`
    // Scoped to the `| date` filter chain to avoid touching unrelated string literals.
    result = result.replace(/(['"])now\1(\s*\|\s*date\b)/g, (_m, _q, tail) => {
      quotedCount++;
      return `now${tail}`;
    });

    const total = parenCount + quotedCount;
    if (total > 0) {
      const parts = [];
      if (parenCount) parts.push(`${parenCount} \`now()\` call(s)`);
      if (quotedCount) parts.push(`${quotedCount} quoted \`"now"\`/\`'now'\` use(s) before \`| date:\``);
      this.changes.push({
        type: 'auto',
        category: 'Date Keyword',
        description: `Converted ${parts.join(' and ')} to bare \`now\`. LiqP 0.7.9 treats \`"now"\` as a literal string, not the current-date keyword — only the unquoted form works.`,
        count: total,
      });
    }

    return result;
  }

  // ─── Convert loop.X → forloop.X ────────────────────────────────
  // Jinja2 uses `loop.index0`; standard Liquid uses `forloop.index0`.

  convertLoopVariables(source) {
    const props = ['index0', 'index', 'first', 'last', 'length', 'rindex', 'rindex0'];
    const regex = new RegExp(`\\bloop\\.(${props.join('|')})\\b`, 'g');
    const found = new Set();
    let count = 0;

    const result = source.replace(regex, (_match, prop) => {
      count++;
      found.add(prop);
      return `forloop.${prop}`;
    });

    if (count > 0) {
      const propList = [...found].map(p => `loop.${p}`).join(', ');
      this.changes.push({
        type: 'auto',
        category: 'Loop Variables',
        description: `Converted ${count} Jinja2 loop variable(s) to Liquid \`forloop.X\` form — found: ${propList}`,
        count,
      });
    }

    return result;
  }

  // ─── Convert parsejson(X) → X | parse_json (warn) ─────────────
  // Auto-rewrites the syntax but flags for manual verification —
  // `parse_json` availability depends on the CleverTap account's
  // LiqP build, and JSON-typed Profile fields may already be parsed.

  convertParseJson(source) {
    const regex = /\bparsejson\s*\(\s*([^)]+?)\s*\)/g;
    let count = 0;

    const result = source.replace(regex, (_match, arg) => {
      count++;
      return `${arg.trim()} | parse_json`;
    });

    if (count > 0) {
      this.changes.push({
        type: 'auto',
        category: 'JSON Parsing',
        description: `Converted ${count} \`parsejson(X)\` call(s) to \`X | parse_json\``,
        count,
      });
      this.warnings.push({
        type: 'manual',
        category: 'JSON Parsing',
        description: `\`parse_json\` is a CleverTap-specific filter and may not be available on every account. Verify against your CleverTap dashboard. If the source field is already stored as a JSON-typed Profile attribute, the \`| parse_json\` step may be unnecessary.`,
        severity: 'medium',
      });
    }

    return result;
  }

  // ─── 6. Convert filter parentheses to colon syntax ──────────────
  // Leanplum:  | split('[')  | replace('a', 'b')  | join('')
  // CleverTap: | split: "["  | replace: "a", "b"  | join: ""

  convertFilterSyntax(source) {
    // Match: | filterName(args)
    const regex = /\|\s*(\w+)\(([^)]*)\)/g;
    let count = 0;

    const result = source.replace(regex, (_match, filterName, args) => {
      count++;
      // Convert single quotes to double quotes in args
      const convertedArgs = args.replace(/'/g, '"').trim();
      if (!convertedArgs) {
        return `| ${filterName}`;
      }
      return `| ${filterName}: ${convertedArgs}`;
    });

    if (count > 0) {
      this.changes.push({
        type: 'auto',
        category: 'Filter Syntax',
        description: `Converted ${count} filter(s) from parentheses syntax \`| filter(args)\` to colon syntax \`| filter: args\``,
        count,
      });
    }

    return result;
  }

  // ─── 7. Convert | length → | size ──────────────────────────────

  convertLengthFilter(source) {
    const regex = /\|\s*length\b/g;
    let count = 0;

    const result = source.replace(regex, () => {
      count++;
      return '| size';
    });

    if (count > 0) {
      this.changes.push({
        type: 'auto',
        category: 'Filters',
        description: `Converted ${count} \`| length\` filter(s) to \`| size\``,
        count,
      });
    }

    return result;
  }

  // ─── 8. Remove | string filter ─────────────────────────────────

  convertStringFilter(source) {
    const regex = /\s*\|\s*string\b/g;
    let count = 0;

    const result = source.replace(regex, () => {
      count++;
      return '';
    });

    if (count > 0) {
      this.changes.push({
        type: 'auto',
        category: 'Filters',
        description: `Removed ${count} \`| string\` filter(s) — not needed in CleverTap as type coercion is automatic`,
        count,
      });
    }

    return result;
  }

  // ─── Convert Leanplum time idioms to LiqP equivalents ─────────
  // Leanplum: `<expr> | unixtimestamp | divide: 1000` → seconds
  // LiqP:     `<expr> | date: "%s"` (bare `now` works as a date keyword)
  // Also handles minus_time / plus_time variants in the same chain.

  convertTimestampIdioms(source) {
    const unitSeconds = { hours: 3600, hour: 3600, days: 86400, day: 86400, minutes: 60, minute: 60, seconds: 1, second: 1 };
    let count = 0;
    let result = source;

    // Pattern A: <expr> | (minus_time|plus_time): N,"unit" | unixtimestamp | divide: 1000
    const offsetRegex = /([\w.\[\]"']+)\s*\|\s*(minus_time|plus_time)\s*:\s*(\d+)\s*,\s*"(\w+)"\s*\|\s*unixtimestamp\s*\|\s*divide\s*:\s*1000\b/g;
    result = result.replace(offsetRegex, (match, expr, op, n, unit) => {
      const secs = unitSeconds[unit.toLowerCase()];
      if (!secs) return match;
      count++;
      const total = parseInt(n, 10) * secs;
      const liqpOp = op === 'minus_time' ? 'minus' : 'plus';
      return `${expr} | date: "%s" | ${liqpOp}: ${total}`;
    });

    // Pattern B: <expr> | unixtimestamp | divide: 1000  (no offset)
    const plainRegex = /([\w.\[\]"']+)\s*\|\s*unixtimestamp\s*\|\s*divide\s*:\s*1000\b/g;
    result = result.replace(plainRegex, (_m, expr) => {
      count++;
      return `${expr} | date: "%s"`;
    });

    if (count > 0) {
      this.changes.push({
        type: 'auto',
        category: 'Time / Unix Timestamp',
        description: `Rewrote ${count} Leanplum time-idiom chain(s) (\`| unixtimestamp | divide: 1000\`, with optional \`minus_time\`/\`plus_time\`) to LiqP \`| date: "%s"\` with \`| minus:\`/\`| plus:\` in seconds`,
        count,
      });
    }

    return result;
  }

  // ─── Convert | divide → | divided_by ───────────────────────────
  // Standard Liquid uses `divided_by`; Leanplum exposes `divide`.

  convertDivideFilter(source) {
    const regex = /\|\s*divide\b/g;
    let count = 0;

    const result = source.replace(regex, () => {
      count++;
      return '| divided_by';
    });

    if (count > 0) {
      this.changes.push({
        type: 'auto',
        category: 'Filters',
        description: `Converted ${count} \`| divide\` filter(s) to \`| divided_by\``,
        count,
      });
    }

    return result;
  }

  // ─── Flag Jinja2 array filters (selectattr, list) ──────────────
  // Too complex to auto-rewrite — they require a manual `for` + `if`.

  flagJinjaArrayFilters(source) {
    const selectattr = source.match(/\|\s*selectattr\s*:/g);
    if (selectattr) {
      this.warnings.push({
        type: 'manual',
        category: 'Array Filtering',
        description: `Found ${selectattr.length} \`| selectattr:\` use(s). LiqP 0.7.9 has no equivalent — replace with a \`{% for %}\` loop, an \`{% if %}\` guard, and a manual accumulator. The Leanplum \`newerthan\`/\`olderthan\` operators become numeric comparisons (\`>\`, \`<\`) on the timestamp field.`,
        severity: 'high',
      });
    }

    // `| list` used to materialize a generator — distinct from the
    // `last` filter, which is also valid Liquid.
    const listFilter = source.match(/\|\s*list\b/g);
    if (listFilter) {
      this.warnings.push({
        type: 'manual',
        category: 'Array Filtering',
        description: `Found ${listFilter.length} \`| list\` filter use(s). This is a Jinja2 helper for materializing iterators and has no LiqP equivalent. After rewriting any \`selectattr\` chains as manual loops, the \`| list\` calls should be removed.`,
        severity: 'high',
      });
    }

    return source;
  }

  // ─── Flag remaining time/unix filters not caught by the idiom ──

  flagRemainingTimeFilters(source) {
    const remaining = [];
    if (/\|\s*unixtimestamp\b/.test(source)) remaining.push('unixtimestamp');
    if (/\|\s*minus_time\s*:/.test(source)) remaining.push('minus_time');
    if (/\|\s*plus_time\s*:/.test(source)) remaining.push('plus_time');

    if (remaining.length > 0) {
      this.warnings.push({
        type: 'manual',
        category: 'Time / Unix Timestamp',
        description: `Found Leanplum time filter(s) still in use: ${remaining.map(f => `\`${f}\``).join(', ')}. These have no direct LiqP 0.7.9 equivalent. Replace with \`<expr> | date: "%s"\` to get unix seconds, then \`| plus:\`/\`| minus:\` with the offset converted to seconds (e.g. 24h = 86400).`,
        severity: 'high',
      });
    }

    return source;
  }

  // ─── 9. Flag array literal construction ────────────────────────
  // Leanplum: {% set x = ["a", "b", "c"] %}
  // CleverTap: doesn't support array literals directly

  convertArrayLiterals(source) {
    // Match assign/set with array literal: = [...]
    const regex = /\{%[-\s]*assign\s+(\w+)\s*=\s*\[([^\]]+)\]\s*%\}/g;
    const found = [];

    let match;
    while ((match = regex.exec(source)) !== null) {
      found.push(match[1]);
    }

    if (found.length > 0) {
      this.warnings.push({
        type: 'manual',
        category: 'Array Literals',
        description: `Found ${found.length} array literal assignment(s): \`${found.join('`, `')}\`. CleverTap LiqP does not support array literal syntax \`[...]\` in assign. Consider using \`| split\` to create arrays from strings, or restructure the logic.`,
        severity: 'high',
      });
    }

    return source;
  }

  // ─── 10. Flag array math indexing ──────────────────────────────
  // Leanplum: array[numberOfSeasons-1]
  // CleverTap: doesn't support arithmetic in array indices

  convertArrayMathIndex(source) {
    const regex = /\w+\[(\w+)\s*[-+]\s*\d+\]/g;
    const found = [];

    let match;
    while ((match = regex.exec(source)) !== null) {
      found.push(match[0]);
    }

    if (found.length > 0) {
      this.warnings.push({
        type: 'manual',
        category: 'Array Index Arithmetic',
        description: `Found ${found.length} array access(es) with arithmetic: \`${found.join('`, `')}\`. CleverTap does not support math in array indices. Pre-calculate the index using \`| minus: 1\` and assign to a variable first.`,
        severity: 'medium',
      });
    }

    return source;
  }

  // ─── 11. General manual review flags ───────────────────────────

  flagManualReview(source) {
    // Check for Jinja2 tests like "== true" / "== false" as strings
    const stringBooleans = source.match(/==\s*"(true|false)"/g);
    if (stringBooleans) {
      this.warnings.push({
        type: 'manual',
        category: 'Boolean Comparisons',
        description: `Found ${stringBooleans.length} comparison(s) using string booleans like \`== "true"\`. In CleverTap, boolean values may work differently. Verify whether these should be \`== true\` (without quotes) or remain as strings.`,
        severity: 'low',
      });
    }

    // Check for null comparisons as strings
    const stringNulls = source.match(/==\s*"null"/g);
    if (stringNulls) {
      this.warnings.push({
        type: 'manual',
        category: 'Null Comparisons',
        description: `Found ${stringNulls.length} comparison(s) using \`== "null"\` (string). In CleverTap, use \`== nil\` or \`== none\` to check for null/missing values. Review and update as needed.`,
        severity: 'medium',
      });
    }

    // Check for nested object access depth
    const deepNesting = source.match(/(?:Profile|Event)(?:\.\w+|\["[^"]+"\]){4,}/g);
    if (deepNesting) {
      this.warnings.push({
        type: 'manual',
        category: 'Nesting Depth',
        description: `Found ${deepNesting.length} deeply nested property access(es) exceeding 3 levels. CleverTap supports up to 3 levels of nesting.`,
        severity: 'medium',
      });
    }

    // Check for Jinja2-specific features that have no equivalent
    const macros = source.match(/\{%[-\s]*macro\b/g);
    if (macros) {
      this.warnings.push({
        type: 'manual',
        category: 'Macros',
        description: `Found ${macros.length} \`{% macro %}\` definition(s). CleverTap does not support macros — this logic must be inlined or restructured.`,
        severity: 'high',
      });
    }

    const imports = source.match(/\{%[-\s]*(?:import|from|include|extends)\b/g);
    if (imports) {
      this.warnings.push({
        type: 'manual',
        category: 'Imports/Includes',
        description: `Found ${imports.length} import/include/extends statement(s). CleverTap does not support template imports — inline the referenced content.`,
        severity: 'high',
      });
    }

    return source;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LeanplumConverter;
}
