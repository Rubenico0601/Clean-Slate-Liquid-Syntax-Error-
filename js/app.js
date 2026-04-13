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
  let propsBody;
  let propsToggle;
  let propsPanel;

  // Builder state
  let currentPattern = null;
  let builderOutput;

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
    propsBody = document.getElementById('props-body');
    propsToggle = document.getElementById('props-toggle');
    propsPanel = document.getElementById('props-panel');
    builderOutput = document.getElementById('builder-output');

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

    propsToggle.addEventListener('click', () => {
      propsPanel.classList.toggle('collapsed');
      propsToggle.textContent = propsPanel.classList.contains('collapsed') ? 'Show Properties' : 'Hide Properties';
    });

    // Converter button
    document.getElementById('btn-convert').addEventListener('click', runConversion);

    // Tab switching
    initTabs();

    // Builder
    initBuilder();

    // Initial lint if editor has content
    if (editor.getValue().trim()) {
      runLint();
    }
  }

  // ─── Tab Switching ────────────────────────────────────────
  function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const linterStats = document.getElementById('linter-stats');
    const linterActions = document.getElementById('linter-actions');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;

        // Update buttons
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update content
        tabContents.forEach(tc => tc.classList.remove('active'));
        document.getElementById('tab-' + tabId).classList.add('active');

        // Show/hide linter-specific header elements
        const isLinter = tabId === 'linter';
        linterStats.style.display = isLinter ? '' : 'none';
        linterActions.style.display = isLinter ? '' : 'none';

        // CodeMirror needs refresh after becoming visible
        if (isLinter) {
          setTimeout(() => editor.refresh(), 10);
        }
      });
    });
  }

  // ─── Builder ──────────────────────────────────────────────
  function initBuilder() {
    const categoriesEl = document.getElementById('builder-categories');
    const formEl = document.getElementById('builder-form');
    const fieldsEl = document.getElementById('builder-fields');
    const backBtn = document.getElementById('builder-back');
    const generateBtn = document.getElementById('builder-generate');
    const copyBtnB = document.getElementById('builder-copy');
    const sendBtn = document.getElementById('builder-send');
    const patternNameEl = document.getElementById('builder-pattern-name');

    // ── Quick Templates ──
    const categories = LiquidBuilder.getCategories();
    let html = '';
    for (const [catName, patterns] of Object.entries(categories)) {
      html += `<div class="builder-cat-title">${escapeHtml(catName)}</div>`;
      patterns.forEach(p => {
        html += `<div class="builder-card" data-pattern="${p.id}">
          <div class="builder-card-name">${escapeHtml(p.name)}</div>
          <div class="builder-card-desc">${escapeHtml(p.description)}</div>
        </div>`;
      });
    }
    categoriesEl.innerHTML = html;

    categoriesEl.addEventListener('click', (e) => {
      const card = e.target.closest('.builder-card');
      if (!card) return;
      const pattern = LiquidBuilder.getPattern(card.dataset.pattern);
      if (!pattern) return;
      showBuilderForm(pattern, formEl, fieldsEl, categoriesEl, patternNameEl);
    });

    backBtn.addEventListener('click', () => {
      formEl.style.display = 'none';
      categoriesEl.style.display = '';
      currentPattern = null;
    });

    generateBtn.addEventListener('click', () => {
      if (!currentPattern) return;
      const values = collectBuilderValues(fieldsEl, currentPattern);
      const code = currentPattern.generate(values);
      builderOutput.textContent = code;
    });

    copyBtnB.addEventListener('click', () => {
      const code = builderOutput.textContent;
      if (!code || code.startsWith('Describe what') || code.startsWith('Generating')) return;
      navigator.clipboard.writeText(code).then(() => {
        copyBtnB.textContent = 'Copied!';
        setTimeout(() => { copyBtnB.textContent = 'Copy'; }, 1500);
      });
    });

    sendBtn.addEventListener('click', () => {
      const code = builderOutput.textContent;
      if (!code || code.startsWith('Describe what') || code.startsWith('Generating')) return;
      editor.setValue(code);
      document.querySelector('.tab-btn[data-tab="linter"]').click();
    });
  }

  function showBuilderForm(pattern, formEl, fieldsEl, categoriesEl, patternNameEl) {
    currentPattern = pattern;
    patternNameEl.textContent = pattern.name;
    categoriesEl.style.display = 'none';
    formEl.style.display = '';

    // Render fields
    let html = '';
    pattern.fields.forEach(field => {
      html += renderBuilderField(field);
    });
    fieldsEl.innerHTML = html;

    // Wire up repeater add/remove buttons
    wireRepeaterEvents(fieldsEl, pattern);

    // Auto-generate on load
    const values = collectBuilderValues(fieldsEl, pattern);
    builderOutput.textContent = pattern.generate(values);
  }

  function renderBuilderField(field) {
    if (field.type === 'repeater') {
      return renderRepeaterField(field);
    }

    let inputHtml = '';
    const val = field.default || '';

    if (field.type === 'text') {
      inputHtml = `<input class="builder-input" data-field="${field.id}" type="text" value="${escapeAttr(val)}" placeholder="${escapeAttr(field.placeholder || '')}">`;
    } else if (field.type === 'textarea') {
      inputHtml = `<textarea class="builder-textarea" data-field="${field.id}" placeholder="${escapeAttr(field.placeholder || '')}">${escapeHtml(val)}</textarea>`;
    } else if (field.type === 'select') {
      const opts = (field.options || []).map(o =>
        `<option value="${escapeAttr(o)}"${o === val ? ' selected' : ''}>${escapeHtml(o)}</option>`
      ).join('');
      inputHtml = `<select class="builder-select" data-field="${field.id}">${opts}</select>`;
    }

    return `<div class="builder-field">
      <label class="builder-field-label">${escapeHtml(field.label)}</label>
      ${inputHtml}
    </div>`;
  }

  function renderRepeaterField(field) {
    const items = field.defaults || [{}];
    let itemsHtml = '';
    items.forEach((item, idx) => {
      itemsHtml += renderRepeaterItem(field, item, idx);
    });

    return `<div class="builder-field" data-repeater="${field.id}">
      <label class="builder-field-label">${escapeHtml(field.label)}</label>
      <div class="builder-repeater-items" data-repeater-items="${field.id}">
        ${itemsHtml}
      </div>
      <button class="btn builder-repeater-add" data-repeater-add="${field.id}">${escapeHtml(field.addLabel || '+ Add')}</button>
    </div>`;
  }

  function renderRepeaterItem(field, values, idx) {
    let subfieldsHtml = '';
    field.subfields.forEach(sf => {
      const val = (values && values[sf.id]) || '';
      let inputHtml = '';
      if (sf.type === 'text') {
        inputHtml = `<input class="builder-input" data-subfield="${sf.id}" type="text" value="${escapeAttr(val)}" placeholder="${escapeAttr(sf.placeholder || '')}">`;
      } else if (sf.type === 'textarea') {
        inputHtml = `<textarea class="builder-textarea" data-subfield="${sf.id}" placeholder="${escapeAttr(sf.placeholder || '')}">${escapeHtml(val)}</textarea>`;
      } else if (sf.type === 'select') {
        const opts = (sf.options || []).map(o =>
          `<option value="${escapeAttr(o)}"${o === val ? ' selected' : ''}>${escapeHtml(o)}</option>`
        ).join('');
        inputHtml = `<select class="builder-select" data-subfield="${sf.id}">${opts}</select>`;
      }
      subfieldsHtml += `<div class="builder-field">
        <label class="builder-field-label">${escapeHtml(sf.label)}</label>
        ${inputHtml}
      </div>`;
    });

    return `<div class="builder-repeater-item" data-idx="${idx}">
      <button class="builder-repeater-remove" title="Remove">&times;</button>
      ${subfieldsHtml}
    </div>`;
  }

  function wireRepeaterEvents(fieldsEl, pattern) {
    // Add buttons
    fieldsEl.querySelectorAll('.builder-repeater-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const repeaterId = btn.dataset.repeaterAdd;
        const field = pattern.fields.find(f => f.id === repeaterId);
        if (!field) return;
        const container = fieldsEl.querySelector(`[data-repeater-items="${repeaterId}"]`);
        const idx = container.children.length;
        const emptyValues = {};
        field.subfields.forEach(sf => { emptyValues[sf.id] = ''; });
        const temp = document.createElement('div');
        temp.innerHTML = renderRepeaterItem(field, emptyValues, idx);
        const newItem = temp.firstElementChild;
        container.appendChild(newItem);
        wireRemoveButton(newItem);
      });
    });

    // Remove buttons (existing items)
    fieldsEl.querySelectorAll('.builder-repeater-remove').forEach(btn => {
      wireRemoveButton(btn.closest('.builder-repeater-item'));
    });
  }

  function wireRemoveButton(item) {
    const btn = item.querySelector('.builder-repeater-remove');
    btn.addEventListener('click', () => { item.remove(); });
  }

  function collectBuilderValues(fieldsEl, pattern) {
    const values = {};
    pattern.fields.forEach(field => {
      if (field.type === 'repeater') {
        const container = fieldsEl.querySelector(`[data-repeater-items="${field.id}"]`);
        if (!container) return;
        const items = [];
        container.querySelectorAll('.builder-repeater-item').forEach(itemEl => {
          const item = {};
          field.subfields.forEach(sf => {
            const input = itemEl.querySelector(`[data-subfield="${sf.id}"]`);
            item[sf.id] = input ? input.value : '';
          });
          items.push(item);
        });
        values[field.id] = items;
      } else {
        const input = fieldsEl.querySelector(`[data-field="${field.id}"]`);
        values[field.id] = input ? input.value : '';
      }
    });
    return values;
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

    // Show "Fix All Encoding" button if multiple HTML entity errors exist
    const entityErrors = diagnostics.filter(d => d.fix && d.fix.fixType === 'decode_html_entities');
    if (entityErrors.length > 1) {
      const fixAllRow = document.createElement('div');
      fixAllRow.className = 'error-row fix-all-row';
      fixAllRow.innerHTML = `
        <div class="error-main">
          <span class="error-message">Found ${entityErrors.length} HTML entity encoding issues inside Liquid tags.</span>
        </div>
      `;
      const fixAllBtn = document.createElement('button');
      fixAllBtn.className = 'btn btn-fix btn-fix-all';
      fixAllBtn.textContent = 'Fix All Encoding';
      fixAllBtn.title = 'Decode HTML entities in all Liquid tags at once';
      fixAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fixAllHtmlEntities();
      });
      fixAllRow.appendChild(fixAllBtn);
      errorsBody.appendChild(fixAllRow);
    }

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
      case 'decode_html_entities':
        fixDecodeHtmlEntities(diagnostic, fix);
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

  function fixAllHtmlEntities() {
    const entityMap = LiquidLinter.HTML_ENTITY_MAP;
    const source = editor.getValue();

    // Replace HTML entities only inside Liquid delimiters throughout the entire template
    const fixed = source.replace(/(\{\{.*?\}\}|\{%.*?%\})/g, (match) => {
      let decoded = match;
      for (const [entity, char] of Object.entries(entityMap)) {
        const re = new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        decoded = decoded.replace(re, char);
      }
      return decoded;
    });

    if (fixed !== source) {
      editor.setValue(fixed);
    }
  }

  function fixDecodeHtmlEntities(diagnostic, fix) {
    const entityMap = LiquidLinter.HTML_ENTITY_MAP;
    const line = diagnostic.line - 1;
    const lineContent = editor.getLine(line);

    // Replace HTML entities only inside Liquid delimiters on this line
    let newLine = lineContent;
    // Match {{ ... }} and {% ... %} blocks and decode entities within them
    newLine = newLine.replace(/(\{\{.*?\}\}|\{%.*?%\})/g, (match) => {
      let decoded = match;
      for (const [entity, char] of Object.entries(entityMap)) {
        decoded = decoded.split(entity).join(char);
        // Also handle case-insensitive matches (e.g., &#X27; vs &#x27;)
        const re = new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        decoded = decoded.replace(re, char);
      }
      return decoded;
    });

    if (newLine !== lineContent) {
      editor.replaceRange(newLine,
        { line, ch: 0 },
        { line, ch: lineContent.length }
      );
    }
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

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── Leanplum Converter ───────────────────────────────────
  function runConversion() {
    const source = editor.getValue();
    if (!source.trim()) {
      showConversionReport(null, 'Paste a Leanplum template in the editor first.');
      return;
    }

    // Quick detection: does this look like a Leanplum template?
    const hasLeanplumSyntax = /(\{#|{% *set |userAttribute\.|linkedData\.|skipmessage\(\)|\| *length\b|\| *string\b|\|\s*\w+\([^)]*\))/.test(source);

    if (!hasLeanplumSyntax) {
      showConversionReport(null, 'This template doesn\'t appear to contain Leanplum-specific syntax. It may already be CleverTap-compatible. Convert anyway?', () => {
        executeConversion(source);
      });
      return;
    }

    executeConversion(source);
  }

  function executeConversion(source) {
    const converter = new LeanplumConverter();
    const result = converter.convert(source);
    showConversionReport(result);
  }

  function showConversionReport(result, message, onConfirm) {
    const existing = document.getElementById('convert-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'convert-modal';
    overlay.className = 'modal-overlay';

    // No result — just a message
    if (!result) {
      overlay.innerHTML = `
        <div class="modal-box convert-report">
          <div class="modal-title">Leanplum &rarr; CleverTap Converter</div>
          <div class="modal-desc">${escapeHtml(message || '')}</div>
          <div class="modal-actions">
            <button class="btn modal-cancel">Close</button>
            ${onConfirm ? '<button class="btn btn-accent modal-submit">Convert Anyway</button>' : ''}
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      const cancelBtn = overlay.querySelector('.modal-cancel');
      cancelBtn.addEventListener('click', () => { overlay.remove(); editor.focus(); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); editor.focus(); } });

      if (onConfirm) {
        const confirmBtn = overlay.querySelector('.modal-submit');
        confirmBtn.addEventListener('click', () => { overlay.remove(); onConfirm(); });
      }
      return;
    }

    // Build the report
    const totalAutoChanges = result.changes.reduce((sum, c) => sum + (c.count || 1), 0);
    const totalWarnings = result.warnings.length;

    let changesHtml = '';
    if (result.changes.length > 0) {
      changesHtml = result.changes.map(c => `
        <div class="convert-item convert-auto">
          <span class="convert-badge convert-badge-auto">AUTO</span>
          <span class="convert-category">${escapeHtml(c.category)}</span>
          <span class="convert-desc">${escapeHtml(c.description)}</span>
        </div>
      `).join('');
    }

    let warningsHtml = '';
    if (result.warnings.length > 0) {
      warningsHtml = result.warnings.map(w => `
        <div class="convert-item convert-manual">
          <span class="convert-badge convert-badge-${w.severity}">MANUAL${w.severity === 'high' ? ' - HIGH' : w.severity === 'medium' ? ' - MED' : ''}</span>
          <span class="convert-category">${escapeHtml(w.category)}</span>
          <span class="convert-desc">${escapeHtml(w.description)}</span>
        </div>
      `).join('');
    }

    const noChanges = result.changes.length === 0 && result.warnings.length === 0;

    overlay.innerHTML = `
      <div class="modal-box convert-report">
        <div class="modal-title">Leanplum &rarr; CleverTap — Conversion Report</div>

        <div class="convert-summary">
          <div class="convert-stat">
            <span class="convert-stat-value convert-stat-auto">${totalAutoChanges}</span>
            <span class="convert-stat-label">Auto-converted</span>
          </div>
          <div class="convert-stat">
            <span class="convert-stat-value convert-stat-manual">${totalWarnings}</span>
            <span class="convert-stat-label">Needs manual review</span>
          </div>
        </div>

        ${noChanges ? '<div class="convert-empty">No Leanplum-specific syntax detected. Template may already be compatible.</div>' : ''}

        <div class="convert-list">
          ${changesHtml}
          ${warningsHtml}
        </div>

        <div class="modal-actions">
          <button class="btn modal-cancel">Cancel</button>
          <button class="btn btn-accent modal-submit">${noChanges ? 'Close' : 'Apply Conversion'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cancelBtn = overlay.querySelector('.modal-cancel');
    const applyBtn = overlay.querySelector('.modal-submit');

    function close() {
      overlay.remove();
      editor.focus();
    }

    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    applyBtn.addEventListener('click', () => {
      if (!noChanges) {
        editor.setValue(result.output);
      }
      close();
    });
  }

  // ─── Boot ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
