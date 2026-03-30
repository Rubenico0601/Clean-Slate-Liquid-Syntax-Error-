/**
 * App — Wires up CodeMirror editor, linter, fix actions, and UI panels.
 */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────
  let editor;
  let linter;
  let lintTimeout;
  let lastDiagnostics = [];
  const DEBOUNCE_MS = 300;

  // ─── DOM refs (set in init) ────────────────────────────────
  let errorsBody;
  let errorCount;
  let warningCount;
  let statusBadge;
  let clearBtn;
  let sampleBtn;
  let copyBtn;
  let refToggle;
  let refPanel;
  let propsBody;
  let propsToggle;
  let propsPanel;

  // ─── Sample template ──────────────────────────────────────
  const SAMPLE_TEMPLATE = `{% if Profile.customer_type == "premium" %}
  Hi {{ Profile.Name | default: "Valued Customer" }},
  Your premium benefits include:
  {% for item in Profile.benefits %}
    - {{ item | capitalize }}
  {% endfor %}
{% elsif Profile.customer_type == "basic" %}
  Hello {{ Profile.Name | default: "there" }},
  Upgrade to premium for more benefits!
{% else %}
  Welcome! Sign up today.
{% endif %}

{%- if Event.purchase_amount > 100 -%}
  You've earned a reward! Use code: {{ Event.reward_code | upcase }}
{% endif %}

{% assign greeting = "now" | date: "%B %d, %Y" %}
Today is {{ greeting }}.

{% case Profile.Language %}
  {% when "en" %}
    Thank you!
  {% when "es" %}
    ¡Gracias!
  {% when "fr" %}
    Merci!
{% endcase %}`;

  const BROKEN_SAMPLE = `{% if Profile.customer_type == "premium" %}
  Hello {{ profile.Name | defalt: "there" }}
  {% for item in Profile.benefits %}
    - {{ item | capitalize }
  {% endfor

{% elsif customer_type == "basic" %}
  Hi {{ Event.Requested Product | upcase }}
{% endif %}

{% iff something %}
  broken
{% endiff %}

{{ | append: "test" }}

{% assign x = "unclosed string %}
{% when "solo" %}`;

  // ─── Init ──────────────────────────────────────────────────
  function init() {
    linter = new LiquidLinter({ clevertapMode: true });

    // Grab DOM refs
    errorsBody = document.getElementById('errors-body');
    errorCount = document.getElementById('error-count');
    warningCount = document.getElementById('warning-count');
    statusBadge = document.getElementById('status-badge');
    clearBtn = document.getElementById('btn-clear');
    sampleBtn = document.getElementById('btn-sample');
    copyBtn = document.getElementById('btn-copy-errors');
    refToggle = document.getElementById('ref-toggle');
    refPanel = document.getElementById('ref-panel');
    propsBody = document.getElementById('props-body');
    propsToggle = document.getElementById('props-toggle');
    propsPanel = document.getElementById('props-panel');

    // Init CodeMirror
    editor = CodeMirror.fromTextArea(document.getElementById('editor-textarea'), {
      mode: 'liquid',
      theme: 'material-darker',
      lineNumbers: true,
      lineWrapping: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      tabSize: 2,
      gutters: ['CodeMirror-lint-markers', 'CodeMirror-linenumbers'],
      styleActiveLine: true,
      placeholder: 'Paste your Liquid template here...',
    });

    editor.setSize('100%', '100%');

    // Live lint on change
    editor.on('change', () => {
      clearTimeout(lintTimeout);
      lintTimeout = setTimeout(runLint, DEBOUNCE_MS);
    });

    // Buttons
    clearBtn.addEventListener('click', () => {
      editor.setValue('');
      editor.focus();
    });

    sampleBtn.addEventListener('click', () => {
      editor.setValue(SAMPLE_TEMPLATE);
      editor.focus();
    });

    document.getElementById('btn-broken-sample').addEventListener('click', () => {
      editor.setValue(BROKEN_SAMPLE);
      editor.focus();
    });

    copyBtn.addEventListener('click', copyErrors);

    refToggle.addEventListener('click', () => {
      refPanel.classList.toggle('collapsed');
      refToggle.textContent = refPanel.classList.contains('collapsed') ? 'Show Reference' : 'Hide Reference';
    });

    propsToggle.addEventListener('click', () => {
      propsPanel.classList.toggle('collapsed');
      propsToggle.textContent = propsPanel.classList.contains('collapsed') ? 'Show Properties' : 'Hide Properties';
    });

    // Initial lint if editor has content
    if (editor.getValue().trim()) {
      runLint();
    }
  }

  // ─── Lint runner ───────────────────────────────────────────
  function runLint() {
    const source = editor.getValue();

    // Clear previous markers
    editor.getAllMarks().forEach(m => m.clear());
    editor.clearGutter('CodeMirror-lint-markers');

    if (!source.trim()) {
      renderResults([]);
      renderProperties({ profile: [], event: [] });
      return;
    }

    const diagnostics = linter.lint(source);
    lastDiagnostics = diagnostics;
    renderResults(diagnostics);
    highlightErrors(diagnostics);

    // Extract and render properties
    const properties = linter.extractProperties(source);
    renderProperties(properties);
  }

  // ─── Render results panel ─────────────────────────────────
  function renderResults(diagnostics) {
    const errors = diagnostics.filter(d => d.severity === 'error');
    const warnings = diagnostics.filter(d => d.severity === 'warning');

    errorCount.textContent = errors.length;
    warningCount.textContent = warnings.length;

    if (diagnostics.length === 0) {
      statusBadge.className = 'status-badge status-ok';
      statusBadge.textContent = 'No Issues';
      errorsBody.innerHTML = `
        <div class="no-errors">
          <div class="no-errors-icon">&#10003;</div>
          <div class="no-errors-text">Template looks good! No errors or warnings found.</div>
        </div>`;
      return;
    }

    statusBadge.className = errors.length > 0
      ? 'status-badge status-error'
      : 'status-badge status-warn';
    statusBadge.textContent = errors.length > 0 ? 'Errors Found' : 'Warnings Only';

    errorsBody.innerHTML = '';
    diagnostics.forEach((d, idx) => {
      const row = document.createElement('div');
      row.className = `error-row severity-${d.severity}`;

      const mainContent = document.createElement('div');
      mainContent.className = 'error-main';
      mainContent.setAttribute('role', 'button');
      mainContent.setAttribute('tabindex', '0');

      mainContent.innerHTML = `
        <span class="error-index">${idx + 1}</span>
        <span class="error-severity-icon">${d.severity === 'error' ? '&#9679;' : '&#9651;'}</span>
        <span class="error-location">Line ${d.line}, Col ${d.col}</span>
        <span class="error-message">${escapeHtml(d.message)}</span>
      `;

      mainContent.addEventListener('click', () => jumpToLine(d.line, d.col));
      mainContent.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') jumpToLine(d.line, d.col);
      });

      row.appendChild(mainContent);

      // Add Fix button if a fix is available
      if (d.fix) {
        const fixBtn = document.createElement('button');
        fixBtn.className = 'btn btn-fix';
        fixBtn.textContent = 'Fix';
        fixBtn.title = 'Apply a fix for this error';
        fixBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          applyFix(d);
        });
        row.appendChild(fixBtn);
      }

      errorsBody.appendChild(row);
    });
  }

  // ─── Fix Application ──────────────────────────────────────
  function applyFix(diagnostic) {
    const fix = diagnostic.fix;
    if (!fix) return;

    switch (fix.fixType) {
      case 'prompt_filter_value':
        promptAndFixFilterValue(diagnostic, fix);
        break;
      case 'prompt_condition_value':
        promptAndFixConditionValue(diagnostic, fix);
        break;
      case 'insert_closing_tag':
        fixInsertClosingTag(diagnostic, fix);
        break;
      default:
        break;
    }
  }

  function promptAndFixFilterValue(diagnostic, fix) {
    const filterName = fix.filterName;
    showInputModal(
      `Enter value for \`${filterName}\` filter`,
      `What value should be used? (e.g., for default: "fallback text")`,
      `"your value here"`,
      (userValue) => {
        if (!userValue) return;
        const line = diagnostic.line - 1;
        const lineContent = editor.getLine(line);

        // Find the filter pattern: filterName: or filterName with no args
        // Case 1: "| filterName:" with empty value after colon
        const regexWithColon = new RegExp(`(\\|\\s*${filterName}\\s*:\\s*)([%}]|\\|)`, 'g');
        // Case 2: "| filterName" with no colon at all
        const regexNoColon = new RegExp(`(\\|\\s*${filterName})(\\s*[%}|])`, 'g');

        let newLine = lineContent;
        if (regexWithColon.test(lineContent)) {
          regexWithColon.lastIndex = 0;
          newLine = lineContent.replace(regexWithColon, `$1${userValue} $2`);
        } else if (regexNoColon.test(lineContent)) {
          regexNoColon.lastIndex = 0;
          newLine = lineContent.replace(regexNoColon, `$1: ${userValue}$2`);
        }

        if (newLine !== lineContent) {
          editor.replaceRange(newLine,
            { line, ch: 0 },
            { line, ch: lineContent.length }
          );
        }
      }
    );
  }

  function promptAndFixConditionValue(diagnostic, fix) {
    const operator = fix.operator;
    showInputModal(
      `Enter comparison value`,
      `The \`${operator}\` operator needs a value on the right side. What should it compare to?`,
      `"your value"`,
      (userValue) => {
        if (!userValue) return;
        const line = diagnostic.line - 1;
        const lineContent = editor.getLine(line);

        // Find the operator at the end of a tag expression and add the value
        const regex = new RegExp(`(${operator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*(%}|-?%})`, 'g');
        let newLine = lineContent;
        if (regex.test(lineContent)) {
          regex.lastIndex = 0;
          newLine = lineContent.replace(regex, `$1 ${userValue} $2`);
        }

        if (newLine !== lineContent) {
          editor.replaceRange(newLine,
            { line, ch: 0 },
            { line, ch: lineContent.length }
          );
        }
      }
    );
  }

  function fixInsertClosingTag(diagnostic, fix) {
    const source = editor.getValue();
    const closingTag = fix.closingTag;
    const tagName = fix.tagName;

    // Find the best place to insert the closing tag
    // Look for the last line that belongs to this block
    const openLine = diagnostic.line - 1;
    const totalLines = editor.lineCount();

    // Simple heuristic: find the last non-empty line at or after the opening tag
    // that seems to belong to this block (before the next block at same or lesser indent)
    const openIndent = editor.getLine(openLine).match(/^(\s*)/)[1];
    let insertLine = totalLines - 1;

    // Try to find a sensible insertion point
    for (let i = openLine + 1; i < totalLines; i++) {
      const line = editor.getLine(i);
      if (line.trim() === '') continue;
      const indent = line.match(/^(\s*)/)[1];
      // If we find a line at the same or lesser indent that's a tag, insert before it
      if (indent.length <= openIndent.length && line.trim().match(/^\{%/)) {
        insertLine = i - 1;
        break;
      }
    }

    const insertIndent = openIndent;
    const insertText = `\n${insertIndent}${closingTag}`;
    const lineContent = editor.getLine(insertLine);
    editor.replaceRange(insertText,
      { line: insertLine, ch: lineContent.length }
    );
  }

  // ─── Input Modal ──────────────────────────────────────────
  function showInputModal(title, description, placeholder, onSubmit) {
    // Remove any existing modal
    const existing = document.getElementById('fix-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'fix-modal';
    overlay.className = 'modal-overlay';

    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-title">${escapeHtml(title)}</div>
        <div class="modal-desc">${escapeHtml(description)}</div>
        <input type="text" class="modal-input" placeholder="${escapeHtml(placeholder)}" autofocus />
        <div class="modal-actions">
          <button class="btn modal-cancel">Cancel</button>
          <button class="btn btn-accent modal-submit">Apply Fix</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('.modal-input');
    const cancelBtn = overlay.querySelector('.modal-cancel');
    const submitBtn = overlay.querySelector('.modal-submit');

    function close() {
      overlay.remove();
      editor.focus();
    }

    function submit() {
      const value = input.value.trim();
      if (value) {
        onSubmit(value);
        close();
      }
    }

    cancelBtn.addEventListener('click', close);
    submitBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') close();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // Focus the input after a tick (for autofocus to work)
    setTimeout(() => input.focus(), 50);
  }

  // ─── Properties Panel ─────────────────────────────────────
  function renderProperties(properties) {
    if (!propsBody) return;

    const hasProfile = properties.profile.length > 0;
    const hasEvent = properties.event.length > 0;

    if (!hasProfile && !hasEvent) {
      propsBody.innerHTML = `
        <div class="props-empty">No Profile or Event properties detected in the template.</div>
      `;
      return;
    }

    let html = '';

    if (hasProfile) {
      html += `<div class="props-group">
        <div class="props-group-title">
          <span class="props-icon props-icon-profile">P</span>
          Profile Properties
          <span class="props-count">${properties.profile.length}</span>
        </div>`;
      properties.profile.forEach(prop => {
        const lineStr = prop.lines.map(l => `Line ${l}`).join(', ');
        html += `
          <div class="props-item" data-line="${prop.lines[0]}">
            <span class="props-name">Profile.${escapeHtml(prop.name)}</span>
            <span class="props-lines">${lineStr}</span>
          </div>`;
      });
      html += '</div>';
    }

    if (hasEvent) {
      html += `<div class="props-group">
        <div class="props-group-title">
          <span class="props-icon props-icon-event">E</span>
          Event Properties
          <span class="props-count">${properties.event.length}</span>
        </div>`;
      properties.event.forEach(prop => {
        const lineStr = prop.lines.map(l => `Line ${l}`).join(', ');
        html += `
          <div class="props-item" data-line="${prop.lines[0]}">
            <span class="props-name">Event.${escapeHtml(prop.name)}</span>
            <span class="props-lines">${lineStr}</span>
          </div>`;
      });
      html += '</div>';
    }

    html += `<div class="props-warning">
      <span class="props-warning-icon">&#9888;</span>
      Verify that these properties exist on the CleverTap dashboard.
      Liquid errors can occur if a property was never created, has been discarded, or was deleted.
    </div>`;

    propsBody.innerHTML = html;

    // Make property items clickable to jump to line
    propsBody.querySelectorAll('.props-item').forEach(item => {
      item.addEventListener('click', () => {
        const line = parseInt(item.dataset.line, 10);
        if (line) jumpToLine(line, 1);
      });
    });
  }

  // ─── Highlight errors in editor ───────────────────────────
  function highlightErrors(diagnostics) {
    const gutterMarkers = {};

    diagnostics.forEach(d => {
      const line = d.line - 1; // CodeMirror is 0-indexed

      // Gutter marker (one per line — prioritize errors)
      if (!gutterMarkers[line] || d.severity === 'error') {
        const marker = document.createElement('div');
        marker.className = `gutter-marker gutter-${d.severity}`;
        marker.textContent = d.severity === 'error' ? '\u25CF' : '\u25B2';
        marker.title = d.message;
        editor.setGutterMarker(line, 'CodeMirror-lint-markers', marker);
        gutterMarkers[line] = d.severity;
      }

      // Underline the tag on that line
      const lineContent = editor.getLine(line);
      if (lineContent) {
        const col = Math.max(0, d.col - 1);
        const tagMatch = lineContent.substring(col).match(/\{[{%].*?[%}]\}/);
        const endCol = tagMatch ? col + tagMatch[0].length : lineContent.length;

        editor.markText(
          { line, ch: col },
          { line, ch: endCol },
          {
            className: `cm-error-underline cm-underline-${d.severity}`,
            title: d.message,
          }
        );
      }
    });
  }

  // ─── Helpers ──────────────────────────────────────────────
  function jumpToLine(line, col) {
    const cmLine = line - 1;
    const cmCol = Math.max(0, col - 1);
    editor.setCursor({ line: cmLine, ch: cmCol });
    editor.scrollIntoView({ line: cmLine, ch: cmCol }, 100);
    editor.focus();

    editor.addLineClass(cmLine, 'background', 'line-flash');
    setTimeout(() => editor.removeLineClass(cmLine, 'background', 'line-flash'), 800);
  }

  function copyErrors() {
    const source = editor.getValue();
    if (!source.trim()) return;
    const diagnostics = linter.lint(source);
    if (diagnostics.length === 0) return;

    const text = diagnostics.map((d, i) =>
      `${i + 1}. [${d.severity.toUpperCase()}] Line ${d.line}, Col ${d.col}: ${d.message}`
    ).join('\n');

    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy Errors'; }, 1500);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Boot ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
