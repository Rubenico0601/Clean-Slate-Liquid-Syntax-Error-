/**
 * App — Wires up CodeMirror editor, linter, and UI panels.
 */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────
  let editor;
  let linter;
  let lintTimeout;
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
      return;
    }

    const diagnostics = linter.lint(source);
    renderResults(diagnostics);
    highlightErrors(diagnostics);
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
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');

      row.innerHTML = `
        <span class="error-index">${idx + 1}</span>
        <span class="error-severity-icon">${d.severity === 'error' ? '&#9679;' : '&#9651;'}</span>
        <span class="error-location">Line ${d.line}, Col ${d.col}</span>
        <span class="error-message">${escapeHtml(d.message)}</span>
      `;

      row.addEventListener('click', () => jumpToLine(d.line, d.col));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') jumpToLine(d.line, d.col);
      });

      errorsBody.appendChild(row);
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
        // Try to find a tag on this line to underline
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

    // Flash the line
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
