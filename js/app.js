/**
 * App — Wires up CodeMirror editor, linter, fix actions, and UI panels.
 */

(function () {
  'use strict';

  // ─── Panel mode (Chrome side-panel embed) ─────────────────
  // Detect ?panel=1 immediately so CSS hides redundant UI from the first
  // paint — scripts are at the end of <body>, so document.body exists.
  const panelModeActive = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('panel') === '1') {
        document.body.classList.add('panel-mode');
        return true;
      }
    } catch (e) {}
    return false;
  })();

  // ─── Analytics shim ───────────────────────────────────────
  // Thin wrapper over window.CleanSlateAnalytics so app.js can call
  // track('Event Name', {...}) without null-checking everywhere.
  // Silently no-ops if analytics isn't loaded or configured.
  const track = (eventName, props) => {
    try {
      if (window.CleanSlateAnalytics && window.CleanSlateAnalytics.track) {
        window.CleanSlateAnalytics.track(eventName, props || {});
      }
    } catch (e) {}
  };

  // ─── State ─────────────────────────────────────────────────
  let editor;
  let linter;
  let lintTimeout;
  let lastDiagnostics = [];
  const DEBOUNCE_MS = 300;

  // AMP tab state. Editor is lazy-initialised the first time the tab is
  // activated (or when an AMP4Email import auto-routes into it) — avoids
  // CodeMirror's hidden-container rendering quirks.
  let ampEditor;
  let ampLintTimeout;
  let ampErrorsBody;
  let ampStatusBadge;
  const AMP_DEBOUNCE_MS = 500;

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

{% assign greeting = now | date: "%B %d, %Y" %}
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
    initPanelModeUI();
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
      track('Sample Loaded', { kind: 'valid' });
    });

    document.getElementById('btn-broken-sample').addEventListener('click', () => {
      editor.setValue(BROKEN_SAMPLE);
      editor.focus();
      track('Sample Loaded', { kind: 'broken' });
    });

    copyBtn.addEventListener('click', copyErrors);

    propsToggle.addEventListener('click', () => {
      propsPanel.classList.toggle('collapsed');
      propsToggle.textContent = propsPanel.classList.contains('collapsed') ? 'Show Properties' : 'Hide Properties';
    });

    // Converter button
    document.getElementById('btn-convert').addEventListener('click', () => {
      track('LP To CT Conversion Clicked');
      runConversion();
    });

    // Format button — formats only, NEVER strips content. (Unwrap is
    // dangerous when applied to content the user pasted manually; it
    // can delete everything outside the innermost <html> pair. It only
    // runs on extension import, where we know the source is BEE.)
    document.getElementById('btn-format').addEventListener('click', () => {
      const current = editor.getValue();
      if (!current.trim()) return;
      track('Format Clicked', { size_kb: +(current.length / 1024).toFixed(1) });
      const formatted = formatHtml(current);
      if (formatted !== current) {
        editor.setValue(formatted);
        runLint();
      }
    });

    // Tab switching
    initTabs();

    // Builder
    initBuilder();

    // Tools
    initTools();

    // Variables
    initVariables();

    // Preview
    initPreview();

    // Pre-fill from URL hash (used by the CleanSlate Chrome extension
    // to hand off a template extracted from the CleverTap dashboard).
    importTemplateFromUrlHash();

    // Initial lint if editor has content
    if (editor.getValue().trim()) {
      runLint();
    }
  }

  // ─── URL-hash template import ─────────────────────────────
  // Format: #template=<urlencoded-base64-utf8>
  //         #err=<reason>   (e.g. err=toobig)
  function importTemplateFromUrlHash() {
    const hash = window.location.hash || '';
    if (!hash || hash.length <= 1) return;
    const params = new URLSearchParams(hash.substring(1));

    const err = params.get('err');
    if (err) {
      showImportToast(
        err === 'toobig'
          ? 'Template was too large to import via URL. Please paste it manually below.'
          : 'Could not import template (' + err + '). Please paste it manually.',
        'warn'
      );
      // Scrub hash so refresh doesn't repeat
      history.replaceState(null, '', location.pathname + location.search);
      return;
    }

    // Extension opened us without a template — show a one-click paste prompt.
    if (params.get('paste') === '1') {
      history.replaceState(null, '', location.pathname + location.search);
      showPasteFromClipboardPrompt();
      return;
    }

    const encoded = params.get('template');
    if (!encoded) return;

    const reportedSize = parseInt(params.get('size') || '0', 10);
    const reportedSource = params.get('src') || 'unknown';

    try {
      const text = decodeBase64Utf8(encoded);
      // Scrub hash before setting value so a refresh starts clean
      history.replaceState(null, '', location.pathname + location.search);

      // Auto-route AMP4Email templates into the AMP tab. The Liquid linter
      // would flag every <amp-*> tag as unknown, which isn't useful when
      // the template is genuinely AMP.
      if (window.CleanSlateAmp && window.CleanSlateAmp.looksLikeAmp4Email(text)) {
        ensureAmpTab();
        if (ampEditor) {
          ampEditor.setValue(text);
          // Switch to AMP tab so the user lands directly on the result.
          const ampTabBtn = document.querySelector('.tab-btn[data-tab="amp"]');
          if (ampTabBtn) ampTabBtn.click();
          const sizeKb = (text.length / 1024).toFixed(1);
          track('Template Imported', {
            source: reportedSource,
            size_kb: +sizeKb,
            was_unwrapped: false,
            format: 'amp4email',
          });
          showImportToast(
            `Imported ${sizeKb} KB via <strong>${escapeHtml(reportedSource)}</strong>. Detected AMP4Email — routed to the AMP tab.`,
            'ok'
          );
          return;
        }
      }

      // Strip BEE Plugin (or any other) outer wrapper if present, then
      // auto-format. Imported content from the extension often comes
      // from a contenteditable preview that collapses whitespace.
      const unwrapped = unwrapNestedHtml(text);
      const wasUnwrapped = unwrapped.length !== text.length;
      const formatted = formatHtml(unwrapped);
      editor.setValue(formatted);
      runLint();
      const sizeKb = (formatted.length / 1024).toFixed(1);
      const expectedKb = reportedSize ? ` (extension reported ${(reportedSize / 1024).toFixed(1)} KB)` : '';
      const unwrapNote = wasUnwrapped ? ' (BEE wrapper trimmed)' : '';
      track('Template Imported', {
        source: reportedSource,
        size_kb: +sizeKb,
        was_unwrapped: wasUnwrapped,
        format: 'liquid',
      });
      showImportToast(
        `Imported ${sizeKb} KB via <strong>${escapeHtml(reportedSource)}</strong>${expectedKb}. Auto-formatted${unwrapNote}.`,
        'ok'
      );
    } catch (e) {
      console.warn('CleanSlate: failed to decode template hash:', e);
      showImportToast('Imported template was corrupted. Please paste it manually.', 'warn');
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function showPasteFromClipboardPrompt() {
    // Big centred overlay with a button. User click counts as a user
    // gesture so navigator.clipboard.readText() is allowed.
    const overlay = document.createElement('div');
    overlay.className = 'paste-prompt-overlay';
    overlay.innerHTML = `
      <div class="paste-prompt">
        <div class="paste-prompt-title">Paste your template</div>
        <div class="paste-prompt-body">
          The extension couldn't read the clipboard automatically.<br/>
          You already copied the template — click below to paste it.
        </div>
        <button class="btn btn-accent paste-prompt-btn" id="paste-prompt-go">
          Paste from clipboard
        </button>
        <button class="btn paste-prompt-skip" id="paste-prompt-skip">Skip</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#paste-prompt-go').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        overlay.remove();
        if (text && text.trim()) {
          const unwrapped = unwrapNestedHtml(text);
          editor.setValue(formatHtml(unwrapped));
          runLint();
          showImportToast(
            `Imported ${(text.length / 1024).toFixed(1)} KB from clipboard. Auto-formatted.`,
            'ok'
          );
        } else {
          showImportToast('Clipboard was empty. Copy your template first, then try again.', 'warn');
        }
      } catch (e) {
        overlay.remove();
        showImportToast('Clipboard access denied. Paste manually with Cmd+V into the editor.', 'warn');
      }
    });
    overlay.querySelector('#paste-prompt-skip').addEventListener('click', () => overlay.remove());
  }

  function decodeBase64Utf8(urlEncoded) {
    const b64 = decodeURIComponent(urlEncoded);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function showImportToast(message, kind) {
    const el = document.createElement('div');
    el.className = 'import-toast' + (kind === 'warn' ? ' warn' : '');
    el.innerHTML = message + ' <span class="import-toast-close">Dismiss</span>';
    document.body.appendChild(el);
    el.querySelector('.import-toast-close').addEventListener('click', () => el.remove());
    if (kind !== 'warn') {
      setTimeout(() => { el.classList.add('fade'); }, 4500);
      setTimeout(() => { el.remove(); }, 5500);
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
        track('Tab Switched', { tab: tabId });

        // Lazy-init the AMP tab on first activation. CodeMirror renders
        // best when its container is visible, so we wait until now.
        if (tabId === 'amp' && !ampEditor) {
          ensureAmpTab();
        } else if (tabId === 'amp' && ampEditor) {
          // Editor exists but might have been laid out while hidden —
          // force a refresh so line numbers etc. paint correctly.
          setTimeout(() => ampEditor.refresh(), 0);
        }

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

  // ─── Tools ────────────────────────────────────────────────
  function initTools() {
    const minutesInput = document.getElementById('minutes-input');
    const convertBtn = document.getElementById('btn-convert-minutes');
    const resultEl = document.getElementById('minutes-result');
    const resultTime = document.getElementById('minutes-result-time');
    const resultDetail = document.getElementById('minutes-result-detail');

    function convertMinutes(totalMinutes) {
      totalMinutes = Math.floor(Number(totalMinutes));
      if (isNaN(totalMinutes) || totalMinutes < 0 || totalMinutes > 1439) return null;

      const hours24 = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      const period = hours24 < 12 ? 'AM' : 'PM';
      let hours12 = hours24 % 12;
      if (hours12 === 0) hours12 = 12;

      const timeStr = hours12 + ':' + String(mins).padStart(2, '0') + ' ' + period;
      const time24 = String(hours24).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
      return { timeStr, time24, hours24, mins, totalMinutes };
    }

    function showResult(totalMinutes) {
      const result = convertMinutes(totalMinutes);
      if (!result) {
        resultEl.style.display = 'none';
        return;
      }
      resultTime.textContent = result.timeStr;
      resultDetail.textContent = result.totalMinutes + ' minutes since midnight = ' + result.time24 + ' (24h format)';
      resultEl.style.display = '';
    }

    convertBtn.addEventListener('click', () => showResult(minutesInput.value));

    minutesInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') showResult(minutesInput.value);
    });

    // Clicking example chips
    document.querySelectorAll('.tool-example-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const mins = chip.dataset.minutes;
        minutesInput.value = mins;
        showResult(mins);
      });
    });

    // ── Epoch Timestamp Converter ──
    const epochInput = document.getElementById('epoch-input');
    const epochToDateBtn = document.getElementById('btn-epoch-to-date');
    const epochToDateResult = document.getElementById('epoch-to-date-result');
    const epochGmtTime = document.getElementById('epoch-gmt-time');
    const epochLocalTime = document.getElementById('epoch-local-time');
    const epochLocalDetail = document.getElementById('epoch-local-detail');

    function formatDateParts(date, timeZone) {
      var opts = {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZone: timeZone
      };
      return date.toLocaleString('en-GB', opts);
    }

    function getLocalTzLabel() {
      try {
        var offset = new Date().getTimezoneOffset();
        var sign = offset <= 0 ? '+' : '-';
        var absOff = Math.abs(offset);
        var h = String(Math.floor(absOff / 60)).padStart(2, '0');
        var m = String(absOff % 60).padStart(2, '0');
        return 'GMT' + sign + h + ':' + m;
      } catch (e) {
        return 'Local';
      }
    }

    function showEpochToDate(value) {
      var ts = Number(value);
      if (isNaN(ts) || value === '') {
        epochToDateResult.style.display = 'none';
        return;
      }
      // Auto-detect seconds vs milliseconds: if > 10 digits, treat as ms
      var ms = String(Math.abs(ts)).length > 10 ? ts : ts * 1000;
      var date = new Date(ms);
      if (isNaN(date.getTime())) {
        epochToDateResult.style.display = 'none';
        return;
      }

      epochGmtTime.textContent = formatDateParts(date, 'UTC');

      var tzLabel = getLocalTzLabel();
      epochLocalTime.textContent = formatDateParts(date, undefined);
      epochLocalDetail.textContent = 'Your TZ (' + tzLabel + ')';

      epochToDateResult.style.display = '';
    }

    epochToDateBtn.addEventListener('click', function () { showEpochToDate(epochInput.value); });
    epochInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') showEpochToDate(epochInput.value);
    });

    // ── Date → Epoch ──
    var dtYear = document.getElementById('dt-year');
    var dtMonth = document.getElementById('dt-month');
    var dtDay = document.getElementById('dt-day');
    var dtHour = document.getElementById('dt-hour');
    var dtMinute = document.getElementById('dt-minute');
    var dtSecond = document.getElementById('dt-second');
    var dtTz = document.getElementById('dt-tz');
    var dateToEpochBtn = document.getElementById('btn-date-to-epoch');
    var dateNowBtn = document.getElementById('btn-date-now');
    var dateToEpochResult = document.getElementById('date-to-epoch-result');
    var dateEpochValue = document.getElementById('date-epoch-value');
    var dateEpochMs = document.getElementById('date-epoch-ms');

    function showDateToEpoch() {
      var y = parseInt(dtYear.value, 10);
      var mo = parseInt(dtMonth.value, 10);
      var d = parseInt(dtDay.value, 10);
      var h = parseInt(dtHour.value, 10) || 0;
      var mi = parseInt(dtMinute.value, 10) || 0;
      var s = parseInt(dtSecond.value, 10) || 0;

      if (isNaN(y) || isNaN(mo) || isNaN(d)) {
        dateToEpochResult.style.display = 'none';
        return;
      }

      var date;
      if (dtTz.value === 'gmt') {
        date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
      } else {
        date = new Date(y, mo - 1, d, h, mi, s);
      }

      if (isNaN(date.getTime())) {
        dateToEpochResult.style.display = 'none';
        return;
      }

      var epoch = Math.floor(date.getTime() / 1000);
      dateEpochValue.textContent = epoch;
      dateEpochMs.textContent = date.getTime();
      dateToEpochResult.style.display = '';
    }

    dateToEpochBtn.addEventListener('click', showDateToEpoch);
    dateNowBtn.addEventListener('click', function () {
      var now = new Date();
      dtYear.value = now.getFullYear();
      dtMonth.value = now.getMonth() + 1;
      dtDay.value = now.getDate();
      dtHour.value = now.getHours();
      dtMinute.value = now.getMinutes();
      dtSecond.value = now.getSeconds();
      dtTz.value = 'local';
      showDateToEpoch();
    });
  }

  // ─── Variable Inspector ────────────────────────────────────
  function initVariables() {
    const inspector = new VariableInspector();
    const sourceEl = document.getElementById('vars-source');
    const listEl = document.getElementById('vars-list');
    const summaryEl = document.getElementById('vars-summary');
    const applyBar = document.getElementById('vars-apply-bar');
    const outputCard = document.getElementById('vars-output-card');
    const outputEl = document.getElementById('vars-output');
    const analyzeBtn = document.getElementById('vars-analyze');
    const clearBtn = document.getElementById('vars-clear');
    const sampleBtn = document.getElementById('vars-sample');
    const applyBtn = document.getElementById('vars-apply');
    const resetBtn = document.getElementById('vars-reset-edits');
    const copyBtn = document.getElementById('vars-copy-output');
    const sendBtn = document.getElementById('vars-send-linter');

    let lastInspection = null;
    let lastSource = '';

    const SAMPLE = `{% assign playlistObject = Profile["Array-Test"] %}
{% if playlistObject == "null" %}{% abort %}{% endif %}
{% assign playData = Linked.playlist_data_TEST %}
{% assign series_id_bank = "21796,73706,72002" | split: "," %}
{% assign series_name_bank = "Outlander,The Nowhere Man,Spartacus: House of Ashur" | split: "," %}

<a href="https://www.starz.com/us/en/?utm_campaign=lcm-playlist-2-b">
  <img src="https://stz1.imgix.net/web/contentId/{{ Content_Id }}/type/KEY/dimension/2560x1440" alt="Hero" />
</a>
<a href="https://www.starz.com/us/en/privacy">Privacy</a>
Welcome {{ Profile.first_name }} — your playlist starts with {{ playData.playContents[0].title }}.`;

    function render(inspection) {
      const totalItems = inspection.categories.reduce((n, c) => n + c.items.length, 0);

      if (totalItems === 0) {
        listEl.innerHTML = `<div class="vars-empty">No swappable variables detected. The template may be plain HTML or use unsupported patterns.</div>`;
        summaryEl.textContent = '0 variables';
        applyBar.style.display = 'none';
        return;
      }

      let html = '';
      for (const cat of inspection.categories) {
        if (cat.items.length === 0) continue;
        html += `<div class="vars-group">
          <div class="vars-group-header">
            <span class="vars-group-title">${escapeHtml(cat.title)}</span>
            <span class="vars-group-count">${cat.items.length}</span>
          </div>
          <div class="vars-group-hint">${escapeHtml(cat.hint)}</div>`;
        for (const item of cat.items) {
          const subtypeLabel = item.subtype || cat.key;
          html += `<div class="vars-item" data-item-id="${escapeAttr(item.id)}">
            <div class="vars-item-row">
              <div class="vars-item-label">
                <span class="vars-item-subtype ${escapeAttr(subtypeLabel)}">${escapeHtml(subtypeLabel)}</span>
                <span>${escapeHtml(item.label)}</span>
              </div>
              <span class="vars-item-count">${item.count}&times;</span>
            </div>
            <input
              type="text"
              class="vars-item-input"
              data-item-id="${escapeAttr(item.id)}"
              data-current="${escapeAttr(item.currentValue)}"
              placeholder="${escapeAttr('New ' + (item.editableHint || 'value'))}"
            />
            <div class="vars-item-current">current: ${escapeHtml(item.currentValue)}</div>
          </div>`;
        }
        html += `</div>`;
      }
      listEl.innerHTML = html;
      summaryEl.textContent = `${totalItems} variable${totalItems === 1 ? '' : 's'} across ${inspection.categories.filter(c => c.items.length > 0).length} categories`;
      applyBar.style.display = '';

      // Dirty-state highlighting
      listEl.querySelectorAll('.vars-item-input').forEach(inp => {
        inp.addEventListener('input', () => {
          const current = inp.dataset.current;
          if (inp.value.trim() !== '' && inp.value !== current) {
            inp.classList.add('dirty');
          } else {
            inp.classList.remove('dirty');
          }
        });
      });
    }

    function collectEdits() {
      const edits = {};
      listEl.querySelectorAll('.vars-item-input').forEach(inp => {
        const v = inp.value.trim();
        if (v !== '' && v !== inp.dataset.current) {
          edits[inp.dataset.itemId] = v;
        }
      });
      return edits;
    }

    analyzeBtn.addEventListener('click', () => {
      const src = sourceEl.value;
      if (!src.trim()) {
        listEl.innerHTML = `<div class="vars-empty">Paste a template first, then click Analyze.</div>`;
        summaryEl.textContent = 'No analysis yet';
        applyBar.style.display = 'none';
        outputCard.style.display = 'none';
        return;
      }
      lastSource = src;
      lastInspection = inspector.inspect(src);
      render(lastInspection);
      outputCard.style.display = 'none';
    });

    applyBtn.addEventListener('click', () => {
      if (!lastInspection) return;
      const edits = collectEdits();
      const items = inspector.flattenItems(lastInspection);
      const modified = inspector.apply(lastSource, items, edits);
      outputEl.value = modified;
      outputCard.style.display = '';
      // Scroll output into view
      outputEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    resetBtn.addEventListener('click', () => {
      listEl.querySelectorAll('.vars-item-input').forEach(inp => {
        inp.value = '';
        inp.classList.remove('dirty');
      });
      outputCard.style.display = 'none';
    });

    clearBtn.addEventListener('click', () => {
      sourceEl.value = '';
      listEl.innerHTML = `<div class="vars-empty">Paste a template on the left and click <strong>Analyze</strong>.<br/>Detected swappable values will appear here grouped by category.</div>`;
      summaryEl.textContent = 'No analysis yet';
      applyBar.style.display = 'none';
      outputCard.style.display = 'none';
      lastInspection = null;
      lastSource = '';
    });

    sampleBtn.addEventListener('click', () => {
      sourceEl.value = SAMPLE;
      analyzeBtn.click();
    });

    copyBtn.addEventListener('click', () => {
      const text = outputEl.value;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
    });

    sendBtn.addEventListener('click', () => {
      const text = outputEl.value;
      if (!text) return;
      editor.setValue(text);
      document.querySelector('.tab-btn[data-tab="linter"]').click();
    });
  }

  // ─── Preview (Live Renderer) ───────────────────────────────
  function initPreview() {
    const inspector = new VariableInspector();
    let renderer;
    try {
      renderer = new TemplateRenderer();
    } catch (e) {
      // LiquidJS not loaded — degrade gracefully
      console.error(e);
    }

    const sourceEl = document.getElementById('preview-source');
    const mockCard = document.getElementById('preview-mock-card');
    const mockListEl = document.getElementById('preview-mock-list');
    const summaryEl = document.getElementById('preview-summary');
    const statusEl = document.getElementById('preview-output-status');
    const iframeEl = document.getElementById('preview-iframe');
    const sourceOutEl = document.getElementById('preview-output-source');
    const detectBtn = document.getElementById('preview-detect');
    const sampleBtn = document.getElementById('preview-sample');
    const clearBtn = document.getElementById('preview-clear');
    const renderBtn = document.getElementById('preview-render');
    const resetBtn = document.getElementById('preview-reset-mock');
    const copyBtn = document.getElementById('preview-copy-output');
    const viewBtns = document.querySelectorAll('.preview-view-btn');

    let lastInspection = null;
    let lastFlatItems = [];
    let lastOutput = '';

    const SAMPLE = `<!doctype html>
<html><body style="font-family: sans-serif; padding: 24px; max-width: 600px; margin: 0 auto;">
  <h1 style="color: #163b50;">Hi {{ Profile.first_name | default: "there" }} 👋</h1>

  {% if Profile.country == "IN" %}
    <p>Special launch offer for India: enjoy 30% off your next purchase.</p>
  {% elsif Profile.country == "US" %}
    <p>US members get free shipping this weekend only.</p>
  {% else %}
    <p>Welcome back! Check out what's new on STARZ.</p>
  {% endif %}

  {% if Profile.last_watched %}
    <p>Pick up where you left off: <strong>{{ Profile.last_watched }}</strong></p>
  {% endif %}

  <p style="margin-top: 24px;">
    <a href="https://www.starz.com/?utm_campaign={{ Event.send.campaign_id | default: 'default' }}"
       style="background: #163b50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">
      Open the app
    </a>
  </p>

  <p style="color: #999; font-size: 12px; margin-top: 32px;">
    Sent on {{ now | date: "%B %d, %Y" }}.
  </p>
</body></html>`;

    function setStatus(html, className) {
      statusEl.style.display = '';
      iframeEl.style.display = 'none';
      sourceOutEl.style.display = 'none';
      statusEl.className = 'preview-output-status' + (className ? ' ' + className : '');
      statusEl.innerHTML = html;
    }

    function showOutput(html, view) {
      lastOutput = html;
      statusEl.style.display = 'none';
      if (view === 'source') {
        sourceOutEl.style.display = '';
        iframeEl.style.display = 'none';
        sourceOutEl.textContent = html;
      } else {
        iframeEl.style.display = '';
        sourceOutEl.style.display = 'none';
        iframeEl.srcdoc = html;
      }
    }

    function renderMockForm(inspection) {
      const profile = [], event = [], linked = [];
      for (const cat of inspection.categories) {
        for (const item of cat.items) {
          if (item.subtype === 'Profile') profile.push(item);
          else if (item.subtype === 'Event') event.push(item);
          else if (item.subtype === 'Linked') linked.push(item);
        }
      }

      const total = profile.length + event.length + linked.length;
      if (total === 0) {
        mockListEl.innerHTML = `<div class="vars-empty">No Profile / Event / Linked references detected. The template will render with no personalisation data.</div>`;
        summaryEl.textContent = '0 variables';
        return;
      }

      let html = '';
      const renderGroup = (label, subtype, items) => {
        if (items.length === 0) return '';
        let g = `<div class="preview-mock-group"><div class="preview-mock-group-title">${escapeHtml(label)}</div>`;
        for (const item of items) {
          const isLinked = subtype === 'Linked';
          g += `<div class="preview-mock-item">
            <div class="preview-mock-label">
              <span class="vars-item-subtype ${escapeAttr(subtype)}">${escapeHtml(subtype)}</span>
              <span>${escapeHtml(item.label)}</span>
            </div>`;
          if (isLinked) {
            g += `<textarea
              class="preview-mock-input preview-mock-textarea"
              data-item-id="${escapeAttr(item.id)}"
              placeholder='{"playContents": [{"title": "Example", "logLine": "..."}]}'
            ></textarea>
            <div class="preview-mock-hint">JSON. Leave blank to set this linked content to null.</div>`;
          } else {
            g += `<input
              type="text"
              class="preview-mock-input"
              data-item-id="${escapeAttr(item.id)}"
              placeholder="${escapeAttr('Value for ' + item.label)}"
            />
            <div class="preview-mock-hint">Plain text by default. Numbers auto-detect. Wrap in <code>[ ]</code> or <code>{ }</code> for JSON.</div>`;
          }
          g += `</div>`;
        }
        g += `</div>`;
        return g;
      };

      html += renderGroup('Profile', 'Profile', profile);
      html += renderGroup('Event', 'Event', event);
      html += renderGroup('Linked Content', 'Linked', linked);

      mockListEl.innerHTML = html;
      summaryEl.textContent = `${total} input${total === 1 ? '' : 's'}`;
    }

    function collectFormValues() {
      const values = {};
      mockListEl.querySelectorAll('[data-item-id]').forEach(el => {
        values[el.dataset.itemId] = el.value;
      });
      return values;
    }

    detectBtn.addEventListener('click', () => {
      const src = sourceEl.value;
      if (!src.trim()) {
        setStatus('Paste a template first, then click Detect Variables.', 'error');
        mockCard.style.display = 'none';
        return;
      }
      lastInspection = inspector.inspect(src);
      lastFlatItems = inspector.flattenItems(lastInspection);
      renderMockForm(lastInspection);
      mockCard.style.display = '';
      setStatus('Fill in the mock data above and click <strong>Render</strong>.');
    });

    renderBtn.addEventListener('click', async () => {
      if (!renderer) {
        setStatus('LiquidJS failed to load. Check your network or CDN access.', 'error');
        return;
      }
      const src = sourceEl.value;
      if (!src.trim()) {
        setStatus('Paste a template first.', 'error');
        return;
      }
      // Run with whatever inspection state we have; re-inspect if user changed source
      if (!lastInspection) {
        lastInspection = inspector.inspect(src);
        lastFlatItems = inspector.flattenItems(lastInspection);
      }
      const values = collectFormValues();
      const context = TemplateRenderer.buildContextFromInspection(lastInspection, values);

      const result = await renderer.render(src, context);
      if (!result.ok) {
        const e = result.error;
        const where = e.line ? ` (line ${e.line}${e.col ? ', col ' + e.col : ''})` : '';
        setStatus(`<strong>${escapeHtml(e.name)}</strong>${escapeHtml(where)}<br/>${escapeHtml(e.message)}`, 'error');
        return;
      }
      if (result.aborted) {
        setStatus('Template hit <code>{% abort %}</code>. CleverTap would skip sending this message.', 'aborted');
        return;
      }
      const activeView = document.querySelector('.preview-view-btn.active')?.dataset.view || 'html';
      showOutput(result.output, activeView);
    });

    resetBtn.addEventListener('click', () => {
      mockListEl.querySelectorAll('[data-item-id]').forEach(el => { el.value = ''; });
    });

    sampleBtn.addEventListener('click', () => {
      sourceEl.value = SAMPLE;
      detectBtn.click();
      // Pre-fill the sample form with sensible defaults
      mockListEl.querySelectorAll('[data-item-id]').forEach(el => {
        const label = el.previousElementSibling?.textContent || '';
        if (label.includes('first_name')) el.value = 'Ruben';
        else if (label.includes('country')) el.value = 'IN';
        else if (label.includes('last_watched')) el.value = 'Outlander S07E14';
        else if (label.includes('campaign_id')) el.value = 'spring-launch';
      });
    });

    clearBtn.addEventListener('click', () => {
      sourceEl.value = '';
      mockListEl.innerHTML = '';
      mockCard.style.display = 'none';
      lastInspection = null;
      lastFlatItems = [];
      setStatus('Click <strong>Render</strong> to see the output here.');
    });

    copyBtn.addEventListener('click', () => {
      if (!lastOutput) return;
      navigator.clipboard.writeText(lastOutput).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
    });

    viewBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        viewBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (lastOutput) showOutput(lastOutput, btn.dataset.view);
      });
    });
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
    updatePanelSummary(diagnostics);

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
          track('Fix Applied', {
            severity: d.severity,
            fix_type: (d.fix && d.fix.fixType) || 'unknown',
          });
          applyFix(d);
        });
        row.appendChild(fixBtn);
      }

      errorsBody.appendChild(row);
      enhanceRowForPanelMode(row, d);
    });
  }

  // ─── Panel mode helpers ───────────────────────────────────
  // Injects a summary strip and converts each error row into an expandable
  // detail card with line context and an inline editable line. On Apply,
  // patches CodeMirror in place, re-lints, and postMessages the full new
  // template to the parent extension so it can write back to BEE.

  function initPanelModeUI() {
    if (!panelModeActive) return;
    const linterTab = document.getElementById('tab-linter');
    if (!linterTab) return;
    const summary = document.createElement('div');
    summary.className = 'panel-summary';
    summary.innerHTML = `
      <span class="pill ok" id="panel-status">Waiting for template…</span>
      <span class="spacer"></span>
      <a class="reimport-btn" id="panel-open-full" target="_blank" rel="noopener">Open full ↗</a>
    `;
    linterTab.insertBefore(summary, linterTab.firstChild);
    const openFull = document.getElementById('panel-open-full');
    if (openFull) {
      const u = new URL(window.location.href);
      u.searchParams.delete('panel');
      u.searchParams.delete('t');
      openFull.href = u.toString();
    }
  }

  function updatePanelSummary(diagnostics) {
    if (!panelModeActive) return;
    const badge = document.getElementById('panel-status');
    if (!badge) return;
    const errors = diagnostics.filter(d => d.severity === 'error').length;
    const warnings = diagnostics.filter(d => d.severity === 'warning').length;
    if (errors > 0) {
      badge.className = 'pill err';
      badge.textContent = errors + (errors === 1 ? ' error' : ' errors');
    } else if (warnings > 0) {
      badge.className = 'pill warn';
      badge.textContent = warnings + (warnings === 1 ? ' warning' : ' warnings');
    } else {
      badge.className = 'pill ok';
      badge.textContent = 'No issues';
    }
  }

  function enhanceRowForPanelMode(row, diag) {
    if (!panelModeActive) return;
    const main = row.querySelector('.error-main');
    if (!main) return;
    // Replace the jumpToLine click with expand-in-place.
    const fresh = main.cloneNode(true);
    main.parentNode.replaceChild(fresh, main);

    const expandBtn = document.createElement('button');
    expandBtn.className = 'panel-expand-btn';
    expandBtn.type = 'button';
    expandBtn.textContent = 'Edit';
    expandBtn.setAttribute('aria-expanded', 'false');
    fresh.appendChild(expandBtn);

    let detail = null;
    const toggle = () => {
      if (detail) {
        detail.remove();
        detail = null;
        expandBtn.textContent = 'Edit';
        expandBtn.setAttribute('aria-expanded', 'false');
        return;
      }
      detail = buildPanelDetail(diag);
      row.appendChild(detail);
      expandBtn.textContent = 'Close';
      expandBtn.setAttribute('aria-expanded', 'true');
      const ta = detail.querySelector('textarea');
      if (ta) ta.focus();
    };
    fresh.addEventListener('click', toggle);
    expandBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  }

  function buildPanelDetail(diag) {
    const wrap = document.createElement('div');
    wrap.className = 'panel-detail';
    const lineIdx = Math.max(0, (diag.line || 1) - 1);
    const totalLines = editor.lineCount();
    const startLine = Math.max(0, lineIdx - 1);
    const endLine = Math.min(totalLines - 1, lineIdx + 1);

    for (let i = startLine; i <= endLine; i++) {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'ctx-line' + (i === lineIdx ? ' bad' : '');
      const num = document.createElement('span');
      num.className = 'ln';
      num.textContent = String(i + 1);
      const src = document.createElement('span');
      src.className = 'src';
      src.textContent = editor.getLine(i) || '';
      lineDiv.appendChild(num);
      lineDiv.appendChild(src);
      wrap.appendChild(lineDiv);
    }

    const label = document.createElement('div');
    label.className = 'panel-edit-label';
    label.textContent = 'Edit line ' + (lineIdx + 1) + ':';
    wrap.appendChild(label);

    const originalLine = editor.getLine(lineIdx) || '';
    const textarea = document.createElement('textarea');
    textarea.className = 'panel-edit-input';
    textarea.value = originalLine;
    textarea.spellcheck = false;
    wrap.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'panel-detail-actions';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'panel-apply-btn';
    applyBtn.type = 'button';
    applyBtn.textContent = 'Apply to dashboard';
    applyBtn.disabled = true; // enabled only after the user edits the line
    applyBtn.title = 'Edit the line below to enable';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'panel-cancel-btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    actions.appendChild(applyBtn);
    actions.appendChild(cancelBtn);
    wrap.appendChild(actions);

    // Toggle Apply on every keystroke based on whether the textarea diverges
    // from the original line.
    textarea.addEventListener('input', () => {
      const dirty = textarea.value !== originalLine;
      applyBtn.disabled = !dirty;
      applyBtn.title = dirty ? 'Write this change back to the dashboard editor' : 'Edit the line below to enable';
    });

    applyBtn.addEventListener('click', () => {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying…';
      const newLineContent = textarea.value;
      const oldLineLen = (editor.getLine(lineIdx) || '').length;
      track('Side Panel Apply Clicked', { severity: diag.severity });
      editor.replaceRange(
        newLineContent,
        { line: lineIdx, ch: 0 },
        { line: lineIdx, ch: oldLineLen }
      );
      // Re-lint synchronously, then ship the new template upstream.
      runLint();
      requestWriteToDashboard(editor.getValue());
      // Note: runLint() will re-render results, which removes this row
      // and detail block. No need to reset button state.
    });
    cancelBtn.addEventListener('click', () => { wrap.remove(); });
    return wrap;
  }

  function requestWriteToDashboard(template) {
    try {
      window.parent.postMessage(
        { type: 'CLEANSLATE_APPLY_FIX', template: template },
        '*'
      );
      showPanelToast('Applying fix to dashboard…', 'ok');
    } catch (e) {
      showPanelToast('Could not send fix: ' + e.message, 'err');
    }
  }

  function showPanelToast(msg, kind) {
    const existing = document.querySelector('.panel-toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = 'panel-toast ' + (kind || '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  // Listen for write-back acknowledgements from the extension.
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'CLEANSLATE_APPLY_FIX_RESULT') {
      if (msg.ok) {
        showPanelToast('Dashboard updated.', 'ok');
      } else {
        showPanelToast('Write to dashboard failed: ' + (msg.error || 'unknown'), 'err');
      }
    }
  });

  // ─── AMP4Email tab ────────────────────────────────────────
  // Lazy CodeMirror init + debounced live validation against the official
  // AMP validator (loaded from cdn.ampproject.org on first use).

  function ensureAmpTab() {
    if (ampEditor) return;
    ampErrorsBody = document.getElementById('amp-errors-body');
    ampStatusBadge = document.getElementById('amp-status-badge');
    const ta = document.getElementById('amp-editor-textarea');
    if (!ta) return;
    ampEditor = CodeMirror.fromTextArea(ta, {
      mode: 'htmlmixed',
      theme: 'material-darker',
      lineNumbers: true,
      lineWrapping: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      tabSize: 2,
      gutters: ['CodeMirror-linenumbers'],
      styleActiveLine: true,
      placeholder: 'Paste your AMP4Email template here...',
    });
    ampEditor.setSize('100%', '100%');
    ampEditor.on('change', () => {
      clearTimeout(ampLintTimeout);
      ampLintTimeout = setTimeout(runAmpValidation, AMP_DEBOUNCE_MS);
    });
    // If something already populated the editor before init (auto-route),
    // kick off validation now.
    if (ampEditor.getValue().trim()) {
      runAmpValidation();
    }
    setTimeout(() => ampEditor.refresh(), 0);
  }

  async function runAmpValidation() {
    if (!ampEditor) return;
    const source = ampEditor.getValue();
    if (!source.trim()) {
      ampStatusBadge.className = 'status-badge status-ok';
      ampStatusBadge.textContent = 'Awaiting template';
      ampErrorsBody.innerHTML =
        '<div class="no-errors"><div class="no-errors-icon">&#9889;</div>' +
        '<div class="no-errors-text">Paste an AMP4Email template above. ' +
        'The official AMP validator runs in your browser — no server, no upload.</div></div>';
      return;
    }

    ampStatusBadge.className = 'status-badge';
    ampStatusBadge.textContent = 'Validating…';
    ampErrorsBody.innerHTML =
      '<div class="no-errors"><div class="no-errors-text">Loading AMP validator…</div></div>';

    try {
      const result = await window.CleanSlateAmp.validate(source, 'AMP4EMAIL');
      renderAmpResults(result);
    } catch (e) {
      ampStatusBadge.className = 'status-badge status-error';
      ampStatusBadge.textContent = 'Validator failed';
      ampErrorsBody.innerHTML =
        '<div class="no-errors"><div class="no-errors-text">Could not load AMP validator: ' +
        escapeHtml(e.message || String(e)) +
        '</div></div>';
    }
  }

  function renderAmpResults(result) {
    const allErrors = result.errors || [];
    const errors = allErrors.filter(e => e.severity === 'ERROR');
    const warnings = allErrors.filter(e => e.severity === 'WARNING');

    if (result.status === 'PASS' && allErrors.length === 0) {
      ampStatusBadge.className = 'status-badge status-ok';
      ampStatusBadge.textContent = 'Valid AMP4Email';
      ampErrorsBody.innerHTML =
        '<div class="no-errors"><div class="no-errors-icon">&#10003;</div>' +
        '<div class="no-errors-text">Template passes AMP4Email validation.</div></div>';
      track('AMP Validated', { status: 'PASS', errors: 0, warnings: 0 });
      return;
    }

    ampStatusBadge.className = errors.length > 0
      ? 'status-badge status-error'
      : 'status-badge status-warn';
    ampStatusBadge.textContent = errors.length > 0
      ? errors.length + (errors.length === 1 ? ' error' : ' errors')
      : warnings.length + (warnings.length === 1 ? ' warning' : ' warnings');

    ampErrorsBody.innerHTML = '';
    allErrors.forEach((err, idx) => {
      const row = document.createElement('div');
      const sev = err.severity === 'ERROR' ? 'error' : 'warning';
      row.className = 'error-row severity-' + sev;

      const main = document.createElement('div');
      main.className = 'error-main';
      main.setAttribute('role', 'button');
      main.setAttribute('tabindex', '0');
      const dot = err.severity === 'ERROR' ? '&#9679;' : '&#9651;';
      main.innerHTML =
        '<span class="error-index">' + (idx + 1) + '</span>' +
        '<span class="error-severity-icon">' + dot + '</span>' +
        '<span class="error-location">Line ' + (err.line || 1) + ', Col ' + (err.col || 1) + '</span>' +
        '<span class="error-message">' + escapeHtml(err.message || err.code || 'AMP validation error') + '</span>';

      main.addEventListener('click', () => {
        if (ampEditor && err.line) {
          ampEditor.setCursor({ line: err.line - 1, ch: Math.max(0, (err.col || 1) - 1) });
          ampEditor.focus();
        }
      });

      row.appendChild(main);

      // One-click auto-fix when the error is deterministic enough that
      // we can patch it without guessing user intent (e.g. strip a
      // disallowed attr, change http→https, insert a missing extension
      // script). Errors that need user judgment skip this button and
      // rely on the Suggested-fix hint below.
      if (window.CleanSlateAmp && window.CleanSlateAmp.canAutoFix && window.CleanSlateAmp.canAutoFix(err)) {
        const fixBtn = document.createElement('button');
        fixBtn.className = 'btn btn-fix';
        fixBtn.textContent = 'Fix';
        fixBtn.title = 'Apply this fix automatically';
        fixBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const current = ampEditor.getValue();
          const fixed = window.CleanSlateAmp.autoFix(err, current);
          if (fixed && fixed !== current) {
            ampEditor.setValue(fixed);
            track('AMP Fix Applied', { code: err.code, severity: err.severity });
          } else {
            track('AMP Fix Failed', { code: err.code });
          }
        });
        row.appendChild(fixBtn);
      }

      if (err.specUrl) {
        const learn = document.createElement('a');
        learn.href = err.specUrl;
        learn.target = '_blank';
        learn.rel = 'noopener';
        learn.className = 'btn';
        learn.textContent = 'Spec';
        learn.title = 'Open the AMP spec page for this rule';
        row.appendChild(learn);
      }

      // Fix suggestion (when we have a mapping for this error code).
      // Falls back silently to just the validator's own message when no
      // suggestion is available — the Spec link is the second line of help.
      const suggestion = window.CleanSlateAmp && window.CleanSlateAmp.suggestFix
        ? window.CleanSlateAmp.suggestFix(err)
        : null;
      if (suggestion) {
        const hint = document.createElement('div');
        hint.className = 'amp-fix-hint';
        hint.innerHTML =
          '<span class="amp-fix-label">Suggested fix:</span> ' + escapeHtml(suggestion);
        row.appendChild(hint);
      }

      ampErrorsBody.appendChild(row);
    });

    track('AMP Validated', {
      status: result.status,
      errors: errors.length,
      warnings: warnings.length,
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

  // ─── HTML + Liquid formatter ──────────────────────────────
  //
  // Pretty-prints HTML, puts each block-level Liquid tag on its own
  // line, and re-expands collapsed CSS inside <style> blocks. Inline
  // {{ output }} stays inline; <script>, <pre>, <textarea>, and HTML
  // comments are preserved verbatim.

  // Detects BEE Plugin (or any other) outer wrapper around the user's
  // template — finds the innermost <html>...</html> and returns just
  // that. Returns the source unchanged if there's only one <html>.
  function unwrapNestedHtml(source) {
    if (!source || typeof source !== 'string') return source;
    const opens = [...source.matchAll(/<html\b[^>]*>/gi)];
    if (opens.length <= 1) return source;
    const lastOpen = opens[opens.length - 1];
    const after = source.substring(lastOpen.index + lastOpen[0].length);
    const closeMatch = after.match(/<\/html\s*>/i);
    if (!closeMatch) return source;
    const closeStart = lastOpen.index + lastOpen[0].length + closeMatch.index;
    const closeEnd = closeStart + closeMatch[0].length;
    return source.substring(lastOpen.index, closeEnd);
  }

  // Re-format collapsed CSS into multi-line, indented form.
  function expandCssBlock(cssContent) {
    if (!cssContent || !cssContent.trim()) return cssContent;
    let s = cssContent
      .replace(/\{/g, '{\n')
      .replace(/\}/g, '\n}\n')
      .replace(/;/g, ';\n')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    let depth = 0;
    return s.split('\n').map((line) => {
      const t = line.trim();
      if (!t) return null;
      if (t.startsWith('}')) depth = Math.max(0, depth - 1);
      const out = '  '.repeat(depth) + t;
      if (t.endsWith('{')) depth++;
      return out;
    }).filter(Boolean).join('\n');
  }

  // Find each <style>...</style> in the formatted output and rewrite
  // it as a multi-line block with the parent's indent preserved.
  function expandStyleBlocksInPlace(formatted) {
    return formatted.replace(/^([ \t]*)(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gim,
      (m, indent, open, content, close) => {
        if (!content.trim()) return m;
        const expanded = expandCssBlock(content);
        const base = indent + '  ';
        const lines = expanded.split('\n').map((l) => l ? base + l : l).join('\n');
        return indent + open + '\n' + lines + '\n' + indent + close;
      });
  }

  function formatHtml(source) {
    if (!source || typeof source !== 'string') return source;

    const LIQ = '\x00';
    const PRES = '\x01';

    // 1. Mask Liquid tags so HTML formatting doesn't disturb them.
    const liquid = [];
    let s = source.replace(/\{%-?[\s\S]*?-?%\}|\{\{-?[\s\S]*?-?\}\}/g, (m) => {
      const i = liquid.length;
      liquid.push(m);
      return LIQ + i + LIQ;
    });

    // 2. Mask comments + bodies of <style>/<script>/<pre>/<textarea>.
    const preserved = [];
    s = s.replace(/<!--[\s\S]*?-->/g, (m) => {
      const i = preserved.length;
      preserved.push(m);
      return PRES + i + PRES;
    });
    s = s.replace(/<(style|script|pre|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (m) => {
      const i = preserved.length;
      preserved.push(m);
      return PRES + i + PRES;
    });

    // 3. Break tag boundaries onto their own lines.
    s = s.replace(/>\s*</g, '>\n<');

    // 4. Split block-level Liquid tokens onto their own lines.
    const LIQ_BLOCK = 'if|elsif|else|endif|unless|endunless|for|endfor|case|when|endcase|capture|endcapture|comment|endcomment|raw|endraw|assign|increment|decrement|abort|tablerow|endtablerow';
    s = s.replace(new RegExp(LIQ + '(\\d+)' + LIQ, 'g'), (_m, i) => {
      const original = liquid[+i];
      const isBlock = new RegExp('^\\{%-?\\s*(?:' + LIQ_BLOCK + ')\\b').test(original);
      return isBlock ? '\n' + LIQ + i + LIQ + '\n' : LIQ + i + LIQ;
    });
    // Break around preserved blocks too so they don't fuse with tags.
    s = s.replace(new RegExp('>' + PRES, 'g'), '>\n' + PRES);
    s = s.replace(new RegExp(PRES + '<', 'g'), PRES + '\n<');
    // Adjacent preserved tokens (back-to-back <style>) — split them.
    s = s.replace(new RegExp(PRES + PRES, 'g'), PRES + '\n' + PRES);
    s = s.replace(/\n+/g, '\n').trim();

    // 5. Re-indent based on HTML tag depth.
    const VOID = new Set(['br','hr','img','input','meta','link','area','base','col','embed','param','source','track','wbr']);
    const INDENT = '  ';
    const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
    const out = [];
    let depth = 0;

    for (const line of lines) {
      const isPreservedLine = new RegExp('^' + PRES + '\\d+' + PRES + '$').test(line);
      const isLiquidLine = new RegExp('^' + LIQ + '\\d+' + LIQ + '$').test(line);
      const isClosing = /^<\/[a-zA-Z]/.test(line);
      const isOpening = /^<[a-zA-Z!]/.test(line);
      const isDoctype = /^<!DOCTYPE\b/i.test(line);
      const isSelfClosing = /\/\s*>$/.test(line);
      const tagMatch = line.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
      const tagName = tagMatch ? tagMatch[1].toLowerCase() : null;
      const isVoid = !isClosing && tagName && VOID.has(tagName);
      const isInlineClosed =
        isOpening && tagName &&
        new RegExp('</' + tagName + '\\s*>\\s*$', 'i').test(line);

      if (isClosing) depth = Math.max(0, depth - 1);
      out.push(INDENT.repeat(depth) + line);
      if (isOpening && !isClosing && !isSelfClosing && !isVoid &&
          !isDoctype && !isPreservedLine && !isLiquidLine && !isInlineClosed) {
        depth++;
      }
    }

    let result = out.join('\n');

    // 6. Restore preserved + Liquid tokens.
    result = result.replace(new RegExp(PRES + '(\\d+)' + PRES, 'g'), (_m, i) => preserved[+i]);
    result = result.replace(new RegExp(LIQ + '(\\d+)' + LIQ, 'g'), (_m, i) => liquid[+i]);

    // 7. Re-expand collapsed CSS inside <style> blocks so multi-rule
    // CSS isn't on one long line.
    result = expandStyleBlocksInPlace(result);

    return result;
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
