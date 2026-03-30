/**
 * Liquid Linter for CleverTap (LiqP 0.7.9 compatible)
 * Parses Liquid templates and reports errors with line numbers and actionable messages.
 */

class LiquidLinter {
  constructor(options = {}) {
    this.clevertapMode = options.clevertapMode !== false;

    // Block tags: opener -> closer
    this.blockTags = {
      if: 'endif',
      unless: 'endunless',
      for: 'endfor',
      case: 'endcase',
      comment: 'endcomment',
      raw: 'endraw',
      tablerow: 'endtablerow',
      capture: 'endcapture',
    };

    // Reverse mapping: closer -> opener
    this.closingTags = {};
    for (const [opener, closer] of Object.entries(this.blockTags)) {
      this.closingTags[closer] = opener;
    }

    // Intermediate tags and which block they belong in
    this.intermediateTags = {
      elsif: 'if',
      else: ['if', 'unless', 'case', 'for'],
      when: 'case',
      break: 'for',
      continue: 'for',
    };

    // Standalone tags (no closing tag needed)
    this.standaloneTags = new Set([
      'assign', 'increment', 'decrement', 'abort',
    ]);

    // All known tags
    this.allKnownTags = new Set([
      ...Object.keys(this.blockTags),
      ...Object.values(this.blockTags),
      ...Object.keys(this.intermediateTags),
      ...this.standaloneTags,
    ]);

    // Known filters
    this.knownFilters = new Set([
      // String filters
      'append', 'capitalize', 'downcase', 'upcase', 'escape', 'escape_once',
      'lstrip', 'rstrip', 'strip', 'newline_to_br', 'prepend', 'remove',
      'remove_first', 'replace', 'replace_first', 'slice', 'split',
      'strip_html', 'strip_newlines', 'truncate', 'truncatewords',
      'url_encode', 'url_decode', 'base64_encode', 'base64_decode',
      // Number filters
      'abs', 'at_most', 'at_least', 'ceil', 'divided_by', 'floor',
      'minus', 'modulo', 'plus', 'round', 'times',
      // Array filters
      'compact', 'concat', 'first', 'join', 'last', 'map', 'reverse',
      'size', 'sort', 'sort_natural', 'uniq', 'where',
      // Date filter
      'date',
      // Other
      'default', 'json',
    ]);

    // Known operators
    this.knownOperators = new Set([
      '==', '!=', '>', '<', '>=', '<=', 'and', 'or', 'contains',
    ]);
  }

  lint(source) {
    this.diagnostics = [];
    this.source = source;
    this.lines = source.split('\n');

    // Step 1: Tokenize
    const tokens = this.tokenize(source);

    // Step 2: Validate individual tags and outputs
    for (const token of tokens) {
      if (token.type === 'tag') this.validateTag(token);
      if (token.type === 'output') this.validateOutput(token);
    }

    // Step 3: Block matching
    this.checkBlockMatching(tokens);

    // Step 4: CleverTap-specific checks
    if (this.clevertapMode) {
      this.checkCleverTapSyntax(tokens);
    }

    // Step 5: Check for stray delimiters in text
    this.checkStrayDelimiters(tokens);

    // Sort by line then column
    this.diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);

    // Deduplicate
    return this.dedup(this.diagnostics);
  }

  // ─── Tokenizer ──────────────────────────────────────────────

  tokenize(source) {
    const tokens = [];
    let pos = 0;
    let line = 1;
    let col = 1;
    let textStart = 0;
    let textStartLine = 1;
    let textStartCol = 1;

    const advance = (count) => {
      for (let i = 0; i < count; i++) {
        if (source[pos] === '\n') {
          line++;
          col = 1;
        } else {
          col++;
        }
        pos++;
      }
    };

    while (pos < source.length) {
      if (pos + 1 < source.length) {
        const two = source[pos] + source[pos + 1];

        if (two === '{{' || two === '{%') {
          // Save preceding text
          if (pos > textStart) {
            tokens.push({
              type: 'text',
              value: source.substring(textStart, pos),
              line: textStartLine,
              col: textStartCol,
            });
          }

          const tagStartLine = line;
          const tagStartCol = col;
          const closer = two === '{{' ? '}}' : '%}';
          const tokenType = two === '{{' ? 'output' : 'tag';

          // Handle whitespace-trimming variants: {{- -}} {%- -%}
          const startLen = 2;
          const searchFrom = pos + startLen;

          const end = this.findClosingDelimiter(source, searchFrom, closer);

          if (end === -1) {
            this.addDiagnostic(
              tagStartLine,
              tagStartCol,
              'error',
              `Unclosed \`${two}\` delimiter — expected a matching \`${closer}\` but reached end of template.`
            );
            // Consume rest as broken token
            tokens.push({
              type: tokenType,
              value: source.substring(pos),
              inner: source.substring(pos + startLen).trim(),
              line: tagStartLine,
              col: tagStartCol,
              broken: true,
            });
            pos = source.length;
            break;
          }

          const fullTag = source.substring(pos, end + closer.length);
          let inner = source.substring(pos + startLen, end).trim();

          // Strip whitespace-control hyphens
          if (inner.startsWith('-')) inner = inner.substring(1).trimStart();
          if (inner.endsWith('-')) inner = inner.substring(0, inner.length - 1).trimEnd();

          tokens.push({
            type: tokenType,
            value: fullTag,
            inner: inner,
            line: tagStartLine,
            col: tagStartCol,
          });

          advance(fullTag.length);
          textStart = pos;
          textStartLine = line;
          textStartCol = col;
          continue;
        }
      }

      // Regular character
      if (source[pos] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      pos++;
    }

    // Remaining text
    if (textStart < pos) {
      tokens.push({
        type: 'text',
        value: source.substring(textStart),
        line: textStartLine,
        col: textStartCol,
      });
    }

    return tokens;
  }

  findClosingDelimiter(source, startPos, closer) {
    let pos = startPos;
    let inString = false;
    let stringChar = null;

    while (pos < source.length) {
      const ch = source[pos];

      if (inString) {
        if (ch === '\\') {
          pos += 2;
          continue;
        }
        if (ch === stringChar) {
          inString = false;
        }
      } else {
        if (ch === '"' || ch === "'") {
          inString = true;
          stringChar = ch;
        } else if (pos + closer.length <= source.length &&
                   source.substring(pos, pos + closer.length) === closer) {
          return pos;
        }
      }
      pos++;
    }
    return -1;
  }

  // ─── Tag Validation ──────────────────────────────────────────

  validateTag(token) {
    if (token.broken) return;
    const inner = token.inner;

    if (!inner) {
      this.addDiagnostic(token.line, token.col, 'error',
        'Empty tag `{% %}` — expected a tag name like `if`, `for`, `assign`, etc.');
      return;
    }

    // Extract tag name
    const tagName = this.extractTagName(inner);

    if (!tagName) {
      this.addDiagnostic(token.line, token.col, 'error',
        `Invalid tag syntax: \`{% ${inner} %}\` — could not identify a valid tag name.`);
      return;
    }

    token.tagName = tagName;

    // Check if tag is known
    if (!this.allKnownTags.has(tagName)) {
      const suggestion = this.suggestTag(tagName);
      let msg = `Unknown tag \`${tagName}\`.`;
      if (suggestion) msg += ` Did you mean \`${suggestion}\`?`;
      this.addDiagnostic(token.line, token.col, 'error', msg);
      return;
    }

    // Validate specific tags
    if (tagName === 'assign') this.validateAssign(token, inner);
    if (tagName === 'if' || tagName === 'elsif' || tagName === 'unless') {
      this.validateCondition(token, inner, tagName);
    }
    if (tagName === 'for') this.validateFor(token, inner);
    if (tagName === 'case') this.validateCase(token, inner);
    if (tagName === 'when') this.validateWhen(token, inner);

    // Check for closing tags that have content after tag name
    if (this.closingTags[tagName]) {
      const afterTag = inner.substring(tagName.length).trim();
      if (afterTag) {
        this.addDiagnostic(token.line, token.col, 'warning',
          `Closing tag \`{% ${tagName} %}\` should not have extra content: \`${afterTag}\`.`);
      }
    }
  }

  extractTagName(inner) {
    // Match first word
    const match = inner.match(/^(\w+)/);
    return match ? match[1] : null;
  }

  validateAssign(token, inner) {
    // assign var = value
    const match = inner.match(/^assign\s+(\w+)\s*=\s*(.+)/s);
    if (!match) {
      this.addDiagnostic(token.line, token.col, 'error',
        'Invalid `assign` syntax. Expected: `{% assign variable_name = value %}`.');
      return;
    }
    // Validate the value expression (check filters)
    this.validateExpression(match[2].trim(), token);
  }

  validateCondition(token, inner, tagName) {
    const condition = inner.substring(tagName.length).trim();
    if (!condition) {
      this.addDiagnostic(token.line, token.col, 'error',
        `\`{% ${tagName} %}\` requires a condition. Example: \`{% ${tagName} variable == "value" %}\`.`);
      return;
    }

    // Check for common mistakes
    // Single = instead of ==
    // But be careful: we should only flag = that's not inside == != >= <=
    const singleEquals = condition.match(/(?<![!><=])=(?!=)/);
    if (singleEquals) {
      this.addDiagnostic(token.line, token.col, 'error',
        `Found \`=\` in condition — use \`==\` for comparison. Assignment is not allowed inside \`${tagName}\`.`);
    }

    // Check for incomplete comparisons — operator at end with no right-hand value
    // Matches: == , != , > , < , >= , <= at the end of the condition (with optional trailing whitespace)
    const incompleteOp = condition.match(/(==|!=|>=|<=|>|<)\s*$/);
    if (incompleteOp) {
      this.addDiagnostic(token.line, token.col, 'error',
        `Incomplete comparison — \`${incompleteOp[1]}\` is missing a value on the right side. ` +
        `Example: \`variable ${incompleteOp[1]} "value"\`.`);
    }

    // Check for operator with no left-hand value (operator at start)
    const noLeftOp = condition.match(/^\s*(==|!=|>=|<=|>|<|contains)\s/);
    if (noLeftOp) {
      this.addDiagnostic(token.line, token.col, 'error',
        `Comparison operator \`${noLeftOp[1]}\` is missing a value on the left side.`);
    }

    // Check for consecutive operators like "== ==" or "!= !="
    const doubleOp = condition.match(/(==|!=|>=|<=|>|<|contains)\s+(==|!=|>=|<=|>|<|contains)/);
    if (doubleOp) {
      this.addDiagnostic(token.line, token.col, 'error',
        `Consecutive operators \`${doubleOp[1]}\` and \`${doubleOp[2]}\` — missing a value between them.`);
    }

    // Check for 'and'/'or' with missing operands
    // e.g., "x == 1 and" or "and x == 1" or "x == 1 or"
    const trailingLogical = condition.match(/\b(and|or)\s*$/);
    if (trailingLogical) {
      this.addDiagnostic(token.line, token.col, 'error',
        `\`${trailingLogical[1]}\` at end of condition — missing a second condition after it. ` +
        `Example: \`condition1 ${trailingLogical[1]} condition2\`.`);
    }
    const leadingLogical = condition.match(/^\s*(and|or)\b/);
    if (leadingLogical) {
      this.addDiagnostic(token.line, token.col, 'error',
        `\`${leadingLogical[1]}\` at start of condition — missing a condition before it.`);
    }

    // Check for unclosed strings
    this.checkUnclosedStrings(condition, token);
  }

  validateFor(token, inner) {
    // for item in collection [limit:N] [offset:N]
    const match = inner.match(/^for\s+(\w+)\s+in\s+(.+)/s);
    if (!match) {
      this.addDiagnostic(token.line, token.col, 'error',
        'Invalid `for` loop syntax. Expected: `{% for item in collection %}`.');
      return;
    }

    const loopVar = match[1];
    const rest = match[2].trim();

    if (!rest) {
      this.addDiagnostic(token.line, token.col, 'error',
        '`for` loop is missing a collection to iterate over.');
    }

    // Check for reversed keyword or limit/offset
    // These are valid: reversed, limit:N, offset:N
  }

  validateCase(token, inner) {
    const variable = inner.substring('case'.length).trim();
    if (!variable) {
      this.addDiagnostic(token.line, token.col, 'error',
        '`{% case %}` requires a variable. Example: `{% case variable %}`.');
    }
  }

  validateWhen(token, inner) {
    const value = inner.substring('when'.length).trim();
    if (!value) {
      this.addDiagnostic(token.line, token.col, 'error',
        '`{% when %}` requires a value. Example: `{% when "value" %}`.');
    }
  }

  // ─── Output Validation ───────────────────────────────────────

  validateOutput(token) {
    if (token.broken) return;
    const inner = token.inner;

    if (!inner) {
      this.addDiagnostic(token.line, token.col, 'error',
        'Empty output tag `{{ }}` — expected a variable or expression.');
      return;
    }

    this.validateExpression(inner, token);
  }

  validateExpression(expr, token) {
    // Split by pipes (but not inside strings)
    const parts = this.splitByPipes(expr);

    if (parts.length === 0 || !parts[0].trim()) {
      this.addDiagnostic(token.line, token.col, 'error',
        'Empty expression — expected a variable or value.');
      return;
    }

    // Validate variable part (first segment)
    const varPart = parts[0].trim();
    this.validateVariable(varPart, token);

    // Validate each filter
    for (let i = 1; i < parts.length; i++) {
      this.validateFilter(parts[i].trim(), token, i);
    }

    // Check for unclosed strings in the entire expression
    this.checkUnclosedStrings(expr, token);
  }

  validateVariable(varPart, token) {
    // Basic validation — should not be empty
    if (!varPart) {
      this.addDiagnostic(token.line, token.col, 'error',
        'Missing variable name.');
    }
  }

  validateFilter(filterExpr, token, _index) {
    if (!filterExpr) {
      this.addDiagnostic(token.line, token.col, 'error',
        'Empty filter after `|` — expected a filter name like `default`, `upcase`, etc.');
      return;
    }

    // Extract filter name
    const match = filterExpr.match(/^(\w+)/);
    if (!match) {
      this.addDiagnostic(token.line, token.col, 'error',
        `Invalid filter syntax: \`${filterExpr}\`. Expected a filter name.`);
      return;
    }

    const filterName = match[1];

    if (!this.knownFilters.has(filterName)) {
      const suggestion = this.suggestFilter(filterName);
      let msg = `Unknown filter \`${filterName}\`.`;
      if (suggestion) msg += ` Did you mean \`${suggestion}\`?`;
      this.addDiagnostic(token.line, token.col, 'warning', msg);
    }

    // Check filter argument syntax
    const afterName = filterExpr.substring(filterName.length).trim();
    if (afterName && !afterName.startsWith(':')) {
      this.addDiagnostic(token.line, token.col, 'error',
        `Filter \`${filterName}\` arguments must follow a colon. ` +
        `Expected: \`${filterName}: argument\`.`);
    }
  }

  splitByPipes(expr) {
    const parts = [];
    let current = '';
    let inString = false;
    let stringChar = null;
    let bracketDepth = 0;

    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];

      if (inString) {
        current += ch;
        if (ch === '\\' && i + 1 < expr.length) {
          current += expr[++i];
          continue;
        }
        if (ch === stringChar) inString = false;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        current += ch;
      } else if (ch === '[') {
        bracketDepth++;
        current += ch;
      } else if (ch === ']') {
        bracketDepth--;
        current += ch;
      } else if (ch === '|' && bracketDepth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    parts.push(current);
    return parts;
  }

  // ─── Block Matching ──────────────────────────────────────────

  checkBlockMatching(tokens) {
    const stack = []; // { tagName, token }

    for (const token of tokens) {
      if (token.type !== 'tag' || token.broken) continue;

      const tagName = token.tagName;
      if (!tagName) continue;

      // Opening block tag
      if (this.blockTags[tagName]) {
        // Special handling for raw and comment blocks
        if (tagName === 'raw' || tagName === 'comment') {
          stack.push({ tagName, token });
          continue;
        }
        stack.push({ tagName, token });
        continue;
      }

      // Closing block tag
      if (this.closingTags[tagName]) {
        const expectedOpener = this.closingTags[tagName];

        if (stack.length === 0) {
          this.addDiagnostic(token.line, token.col, 'error',
            `\`{% ${tagName} %}\` found without a matching \`{% ${expectedOpener} %}\`.`);
          continue;
        }

        const top = stack[stack.length - 1];

        if (top.tagName === expectedOpener) {
          stack.pop();
        } else {
          // Mismatch
          const expectedCloser = this.blockTags[top.tagName];
          this.addDiagnostic(token.line, token.col, 'error',
            `Expected \`{% ${expectedCloser} %}\` to close \`{% ${top.tagName} %}\` ` +
            `(opened on line ${top.token.line}), but found \`{% ${tagName} %}\` instead.`);

          // Try to recover: if this closer matches something further down the stack
          const matchIdx = this.findInStack(stack, expectedOpener);
          if (matchIdx !== -1) {
            // Report all unclosed tags between
            for (let i = stack.length - 1; i > matchIdx; i--) {
              const unclosed = stack[i];
              this.addDiagnostic(unclosed.token.line, unclosed.token.col, 'error',
                `\`{% ${unclosed.tagName} %}\` on line ${unclosed.token.line} is never closed — ` +
                `missing \`{% ${this.blockTags[unclosed.tagName]} %}\`.`);
            }
            stack.splice(matchIdx);
          }
        }
        continue;
      }

      // Intermediate tags
      if (this.intermediateTags[tagName]) {
        const allowedParents = this.intermediateTags[tagName];
        const parents = Array.isArray(allowedParents) ? allowedParents : [allowedParents];

        if (stack.length === 0) {
          this.addDiagnostic(token.line, token.col, 'error',
            `\`{% ${tagName} %}\` must be inside a \`{% ${parents.join(' %}\` or \`{% ')} %}\` block.`);
          continue;
        }

        const top = stack[stack.length - 1];
        if (!parents.includes(top.tagName)) {
          this.addDiagnostic(token.line, token.col, 'error',
            `\`{% ${tagName} %}\` is not valid inside \`{% ${top.tagName} %}\` — ` +
            `it belongs inside a \`{% ${parents.join(' %}\` or \`{% ')} %}\` block.`);
        }
        continue;
      }
    }

    // Anything left on the stack is unclosed
    for (const unclosed of stack) {
      const closer = this.blockTags[unclosed.tagName];
      this.addDiagnostic(unclosed.token.line, unclosed.token.col, 'error',
        `\`{% ${unclosed.tagName} %}\` on line ${unclosed.token.line} is never closed — ` +
        `add \`{% ${closer} %}\` to close it.`);
    }
  }

  findInStack(stack, tagName) {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].tagName === tagName) return i;
    }
    return -1;
  }

  // ─── CleverTap-Specific Checks ──────────────────────────────

  checkCleverTapSyntax(tokens) {
    for (const token of tokens) {
      if (token.broken) continue;
      const inner = token.inner;
      if (!inner) continue;

      // Check for lowercase profile/event references
      const profileLower = inner.match(/\bprofile\./i);
      if (profileLower && !inner.match(/\bProfile\./)) {
        this.addDiagnostic(token.line, token.col, 'error',
          'CleverTap requires `Profile` to be capitalized. ' +
          `Change \`${profileLower[0]}\` to \`Profile.\`.`);
      }

      const eventLower = inner.match(/\bevent\./i);
      if (eventLower && !inner.match(/\bEvent\./)) {
        this.addDiagnostic(token.line, token.col, 'error',
          'CleverTap requires `Event` to be capitalized. ' +
          `Change \`${eventLower[0]}\` to \`Event.\`.`);
      }

      // Check for Event/Profile properties with spaces not using bracket notation
      const dotPropWithSpace = inner.match(/(?:Profile|Event)\.([A-Za-z_]\w*\s+\w+)/);
      if (dotPropWithSpace) {
        this.addDiagnostic(token.line, token.col, 'error',
          `Property name \`${dotPropWithSpace[1]}\` contains spaces — ` +
          `use bracket notation: \`["${dotPropWithSpace[1]}"]\`.`);
      }

      // Check nested object depth (max 3 levels)
      const nestedMatch = inner.match(/((?:Profile|Event)(?:\.\w+|\["[^"]+"\])+)/);
      if (nestedMatch) {
        const path = nestedMatch[1];
        const levels = (path.match(/\./g) || []).length + (path.match(/\[/g) || []).length - 1;
        if (levels > 4) {
          this.addDiagnostic(token.line, token.col, 'warning',
            `Nested object depth exceeds 3 levels in \`${path}\`. ` +
            'CleverTap supports up to 3 levels of nesting.');
        }
      }

      // Warn about @ personalization inside liquid tags
      if (inner.includes('@{') || inner.match(/@\w+/)) {
        this.addDiagnostic(token.line, token.col, 'warning',
          '`@` personalization syntax should be used outside Liquid tags. ' +
          'Inside tags, use `Profile.property` or `Event.property` instead.');
      }
    }
  }

  // ─── Stray Delimiter Detection ──────────────────────────────

  checkStrayDelimiters(tokens) {
    for (const token of tokens) {
      if (token.type !== 'text') continue;
      const text = token.value;

      // Check for stray }} or %} in text
      let searchPos = 0;
      while (searchPos < text.length) {
        const closeBrace = text.indexOf('}}', searchPos);
        const closeTag = text.indexOf('%}', searchPos);

        let found = -1;
        let which = '';

        if (closeBrace !== -1 && (closeTag === -1 || closeBrace <= closeTag)) {
          found = closeBrace;
          which = '}}';
        } else if (closeTag !== -1) {
          found = closeTag;
          which = '%}';
        }

        if (found === -1) break;

        // Calculate line/col of the stray delimiter
        const beforeStray = text.substring(0, found);
        const newlines = (beforeStray.match(/\n/g) || []).length;
        const strayLine = token.line + newlines;
        const lastNewline = beforeStray.lastIndexOf('\n');
        const strayCol = lastNewline === -1
          ? token.col + found
          : found - lastNewline;

        this.addDiagnostic(strayLine, strayCol, 'warning',
          `Stray \`${which}\` found — possibly a missing opening \`${which === '}}' ? '{{' : '{%'}\` delimiter.`);

        searchPos = found + 2;
      }

      // Check for {{ or {% that weren't captured as tokens
      // (This shouldn't happen normally since tokenizer is greedy, but check anyway)
    }
  }

  // ─── Unclosed Strings ──────────────────────────────────────

  checkUnclosedStrings(text, token) {
    let inString = false;
    let stringChar = null;
    let stringStart = -1;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === '\\') {
          i++;
          continue;
        }
        if (ch === stringChar) {
          inString = false;
        }
      } else {
        if (ch === '"' || ch === "'") {
          inString = true;
          stringChar = ch;
          stringStart = i;
        }
      }
    }

    if (inString) {
      this.addDiagnostic(token.line, token.col, 'error',
        `Unclosed string literal starting with \`${stringChar}\` — add a matching \`${stringChar}\` to close it.`);
    }
  }

  // ─── Suggestion Helpers ─────────────────────────────────────

  suggestTag(unknown) {
    return this.findClosest(unknown, [...this.allKnownTags]);
  }

  suggestFilter(unknown) {
    return this.findClosest(unknown, [...this.knownFilters]);
  }

  findClosest(word, candidates) {
    let best = null;
    let bestDist = Infinity;
    const threshold = Math.max(2, Math.floor(word.length * 0.4));

    for (const candidate of candidates) {
      const dist = this.levenshtein(word.toLowerCase(), candidate.toLowerCase());
      if (dist < bestDist && dist <= threshold) {
        bestDist = dist;
        best = candidate;
      }
    }
    return best;
  }

  levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  // ─── Diagnostic Helpers ─────────────────────────────────────

  addDiagnostic(line, col, severity, message) {
    this.diagnostics.push({ line, col, severity, message });
  }

  dedup(diagnostics) {
    const seen = new Set();
    return diagnostics.filter(d => {
      const key = `${d.line}:${d.col}:${d.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LiquidLinter;
}
