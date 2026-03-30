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
    result = this.convertFilterSyntax(result);
    result = this.convertLengthFilter(result);
    result = this.convertStringFilter(result);
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

  // ─── 3. Convert userAttribute.X → Profile.X ────────────────────

  convertUserAttributes(source) {
    const regex = /\buserAttribute\.(\w+)/g;
    const found = new Set();
    let count = 0;

    const result = source.replace(regex, (_match, prop) => {
      count++;
      found.add(prop);
      return `Profile.${prop}`;
    });

    if (count > 0) {
      const propList = [...found].join(', ');
      this.changes.push({
        type: 'auto',
        category: 'User Properties',
        description: `Converted ${count} \`userAttribute.X\` reference(s) to \`Profile.X\` — properties: ${propList}`,
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
