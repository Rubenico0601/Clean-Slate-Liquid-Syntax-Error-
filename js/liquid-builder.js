/**
 * Liquid Builder — Pattern-based Liquid code generator for CleverTap.
 */

const LiquidBuilder = (function () {
  'use strict';

  const PATTERNS = [
    // ─── Conditional Content ──────────────────────────────
    {
      id: 'language-switch',
      name: 'Language Switch',
      category: 'Conditional Content',
      description: 'Show different content based on the user\'s language.',
      fields: [
        {
          id: 'languages',
          label: 'Languages',
          type: 'repeater',
          addLabel: '+ Add Language',
          subfields: [
            { id: 'code', label: 'Language Code', type: 'text', placeholder: 'e.g., en, fr, es, de' },
            { id: 'content', label: 'Content', type: 'textarea', placeholder: 'Content for this language...' },
          ],
          defaults: [
            { code: 'en', content: 'Hello! Check out our latest offers.' },
            { code: 'es', content: '¡Hola! Descubre nuestras últimas ofertas.' },
          ],
        },
        { id: 'fallback', label: 'Default / Fallback Content', type: 'textarea', placeholder: 'Content if no language matches...', default: 'Hello! Check out our latest offers.' },
        { id: 'property', label: 'Language Property', type: 'text', placeholder: 'Profile.language', default: 'Profile.language' },
      ],
      generate(values) {
        const langs = values.languages || [];
        const prop = values.property || 'Profile.language';
        const fallback = values.fallback || '';
        if (langs.length === 0) return '{% comment %} No languages configured {% endcomment %}';

        let code = `{% if ${prop} == "${langs[0].code}" %}\n  ${langs[0].content}`;
        for (let i = 1; i < langs.length; i++) {
          code += `\n{% elsif ${prop} == "${langs[i].code}" %}\n  ${langs[i].content}`;
        }
        code += `\n{% else %}\n  ${fallback}\n{% endif %}`;
        return code;
      },
    },
    {
      id: 'if-else',
      name: 'If / Else',
      category: 'Conditional Content',
      description: 'Show content based on a single condition.',
      fields: [
        { id: 'property', label: 'Property', type: 'text', placeholder: 'e.g., Profile.plan', default: 'Profile.plan' },
        { id: 'operator', label: 'Operator', type: 'select', options: ['==', '!=', '>', '<', '>=', '<=', 'contains'], default: '==' },
        { id: 'value', label: 'Comparison Value', type: 'text', placeholder: 'e.g., "premium"', default: '"premium"' },
        { id: 'if_content', label: 'If True — Content', type: 'textarea', placeholder: 'Content when condition is true...', default: 'Welcome, premium member!' },
        { id: 'else_content', label: 'Else — Content', type: 'textarea', placeholder: 'Content when condition is false...', default: 'Upgrade to premium today!' },
      ],
      generate(values) {
        return `{% if ${values.property} ${values.operator} ${values.value} %}\n  ${values.if_content}\n{% else %}\n  ${values.else_content}\n{% endif %}`;
      },
    },
    {
      id: 'if-elsif-chain',
      name: 'If / Elsif / Else Chain',
      category: 'Conditional Content',
      description: 'Multiple conditions checked in order with a fallback.',
      fields: [
        {
          id: 'branches',
          label: 'Condition Branches',
          type: 'repeater',
          addLabel: '+ Add Branch',
          subfields: [
            { id: 'condition', label: 'Condition', type: 'text', placeholder: 'e.g., Profile.plan == "premium"' },
            { id: 'content', label: 'Content', type: 'textarea', placeholder: 'Content for this branch...' },
          ],
          defaults: [
            { condition: 'Profile.plan == "premium"', content: 'Welcome, VIP!' },
            { condition: 'Profile.plan == "basic"', content: 'Upgrade for more features.' },
          ],
        },
        { id: 'fallback', label: 'Else — Fallback Content', type: 'textarea', placeholder: 'Content if nothing matches...', default: 'Sign up today!' },
      ],
      generate(values) {
        const branches = values.branches || [];
        if (branches.length === 0) return '';
        let code = `{% if ${branches[0].condition} %}\n  ${branches[0].content}`;
        for (let i = 1; i < branches.length; i++) {
          code += `\n{% elsif ${branches[i].condition} %}\n  ${branches[i].content}`;
        }
        code += `\n{% else %}\n  ${values.fallback}\n{% endif %}`;
        return code;
      },
    },
    {
      id: 'conditional-abort',
      name: 'Conditional Abort',
      category: 'Conditional Content',
      description: 'Suppress a message if a condition is met (e.g., skip users who already purchased).',
      fields: [
        { id: 'property', label: 'Property', type: 'text', placeholder: 'e.g., Profile.has_purchased', default: 'Profile.has_purchased' },
        { id: 'operator', label: 'Operator', type: 'select', options: ['==', '!=', '>', '<', '>=', '<=', 'contains'], default: '==' },
        { id: 'value', label: 'Value', type: 'text', placeholder: 'e.g., true', default: 'true' },
      ],
      generate(values) {
        return `{% if ${values.property} ${values.operator} ${values.value} %}\n  {% abort %}\n{% endif %}`;
      },
    },

    // ─── Personalization ──────────────────────────────────
    {
      id: 'greeting-fallback',
      name: 'Greeting with Fallback',
      category: 'Personalization',
      description: 'Greet the user by name with a fallback if the name is missing.',
      fields: [
        { id: 'property', label: 'Name Property', type: 'text', placeholder: 'e.g., Profile.Name', default: 'Profile.Name' },
        { id: 'fallback', label: 'Fallback Value', type: 'text', placeholder: 'e.g., Valued Customer', default: 'Valued Customer' },
        { id: 'greeting', label: 'Greeting Prefix', type: 'text', placeholder: 'e.g., Hi, Hello, Hey', default: 'Hi' },
      ],
      generate(values) {
        return `${values.greeting} {{ ${values.property} | default: "${values.fallback}" }},`;
      },
    },
    {
      id: 'property-with-filters',
      name: 'Property with Filters',
      category: 'Personalization',
      description: 'Output a profile or event property with a chain of filters.',
      fields: [
        { id: 'property', label: 'Property', type: 'text', placeholder: 'e.g., Profile.city', default: 'Profile.city' },
        {
          id: 'filters',
          label: 'Filter Chain',
          type: 'repeater',
          addLabel: '+ Add Filter',
          subfields: [
            { id: 'name', label: 'Filter', type: 'select', options: ['default', 'upcase', 'downcase', 'capitalize', 'strip', 'truncate', 'url_encode', 'escape', 'split', 'first', 'last', 'size', 'date', 'append', 'prepend', 'replace', 'remove'] },
            { id: 'arg', label: 'Argument (if needed)', type: 'text', placeholder: 'e.g., "fallback" or 20' },
          ],
          defaults: [
            { name: 'default', arg: '"there"' },
            { name: 'capitalize', arg: '' },
          ],
        },
      ],
      generate(values) {
        const filters = (values.filters || [])
          .map(f => f.arg ? `${f.name}: ${f.arg}` : f.name)
          .join(' | ');
        return filters
          ? `{{ ${values.property} | ${filters} }}`
          : `{{ ${values.property} }}`;
      },
    },
    {
      id: 'default-chain',
      name: 'Fallback Chain',
      category: 'Personalization',
      description: 'Try multiple properties in order, falling back to the next if blank.',
      fields: [
        {
          id: 'properties',
          label: 'Properties (checked in order)',
          type: 'repeater',
          addLabel: '+ Add Property',
          subfields: [
            { id: 'prop', label: 'Property / Value', type: 'text', placeholder: 'e.g., Profile.Nickname or "Friend"' },
          ],
          defaults: [
            { prop: 'Profile.first_name' },
            { prop: 'Profile.Name' },
          ],
        },
        { id: 'final_fallback', label: 'Final Static Fallback', type: 'text', placeholder: 'e.g., "Customer"', default: '"Customer"' },
      ],
      generate(values) {
        const props = (values.properties || []).map(p => p.prop);
        if (props.length === 0) return `{{ ${values.final_fallback} }}`;
        // Build nested defaults
        let code = props[0];
        for (let i = 1; i < props.length; i++) {
          code += ` | default: ${props[i]}`;
        }
        code += ` | default: ${values.final_fallback}`;
        return `{{ ${code} }}`;
      },
    },
    {
      id: 'date-format',
      name: 'Date Formatting',
      category: 'Personalization',
      description: 'Display the current date or a date property in a specific format.',
      // Timezone offsets from UTC in seconds: [standard, DST]
      _timezones: {
        'IST — India (UTC+5:30)':            [19800, 19800],       // No DST
        'UTC (UTC+0)':                        [0, 0],
        'EST — US Eastern (UTC-5)':           [-18000, -14400],     // DST = EDT (UTC-4)
        'CST — US Central (UTC-6)':           [-21600, -18000],     // DST = CDT (UTC-5)
        'MST — US Mountain (UTC-7)':          [-25200, -21600],     // DST = MDT (UTC-6)
        'PST — US Pacific (UTC-8)':           [-28800, -25200],     // DST = PDT (UTC-7)
        'GMT — UK (UTC+0)':                   [0, 3600],            // DST = BST (UTC+1)
        'CET — Central Europe (UTC+1)':       [3600, 7200],         // DST = CEST (UTC+2)
        'EET — Eastern Europe (UTC+2)':       [7200, 10800],        // DST = EEST (UTC+3)
        'JST — Japan (UTC+9)':                [32400, 32400],       // No DST
        'AEST — Australia Eastern (UTC+10)':  [36000, 39600],       // DST = AEDT (UTC+11)
        'NZST — New Zealand (UTC+12)':        [43200, 46800],       // DST = NZDT (UTC+13)
        'GST — Gulf / UAE (UTC+4)':           [14400, 14400],       // No DST
        'SGT — Singapore (UTC+8)':            [28800, 28800],       // No DST
        'CST — China (UTC+8)':                [28800, 28800],       // No DST
        'WIB — Indonesia Western (UTC+7)':    [25200, 25200],       // No DST
        'BRT — Brazil (UTC-3)':               [-10800, -10800],     // No DST
      },
      fields: [
        { id: 'source', label: 'Date Source', type: 'select', options: ['now (current date)', 'Event property', 'Profile property'], default: 'now (current date)' },
        { id: 'property', label: 'Property (if not now)', type: 'text', placeholder: 'e.g., Event.purchase_date', default: '' },
        { id: 'format', label: 'Date Format', type: 'select', options: ['%B %d, %Y (March 31, 2026)', '%m/%d/%Y (03/31/2026)', '%d/%m/%Y (31/03/2026)', '%Y-%m-%d (2026-03-31)', '%b %d (Mar 31)', '%A, %B %d (%A full weekday)', '%H:%M (24h time)', '%I:%M %p (12h time)'], default: '%B %d, %Y (March 31, 2026)' },
        { id: 'timezone', label: 'Recipient Timezone', type: 'select', options: ['IST — India (UTC+5:30)', 'UTC (UTC+0)', 'EST — US Eastern (UTC-5)', 'CST — US Central (UTC-6)', 'MST — US Mountain (UTC-7)', 'PST — US Pacific (UTC-8)', 'GMT — UK (UTC+0)', 'CET — Central Europe (UTC+1)', 'EET — Eastern Europe (UTC+2)', 'JST — Japan (UTC+9)', 'AEST — Australia Eastern (UTC+10)', 'NZST — New Zealand (UTC+12)', 'GST — Gulf / UAE (UTC+4)', 'SGT — Singapore (UTC+8)', 'CST — China (UTC+8)', 'WIB — Indonesia Western (UTC+7)', 'BRT — Brazil (UTC-3)'], default: 'IST — India (UTC+5:30)' },
        { id: 'dst', label: 'Daylight Saving Time active?', type: 'select', options: ['No', 'Yes'], default: 'No' },
      ],
      generate(values) {
        const fmt = values.format.split(' (')[0];
        let source = 'now';
        if (values.source.startsWith('Event') && values.property) source = values.property;
        else if (values.source.startsWith('Profile') && values.property) source = values.property;

        const tz = this._timezones[values.timezone];
        if (!tz) return `{{ ${source} | date: "${fmt}" }}`;

        const IST_OFFSET = 19800; // IST is UTC+5:30 = 19800 seconds
        const dstIndex = values.dst === 'Yes' ? 1 : 0;
        const targetOffset = tz[dstIndex];
        const diff = targetOffset - IST_OFFSET; // difference from IST in seconds

        if (diff === 0) {
          return `{{ ${source} | date: "${fmt}" }}`;
        }
        // Use plus for positive offset, minus for negative
        if (diff > 0) {
          return `{{ ${source} | date: "${fmt}" | plus: ${diff} }}`;
        }
        return `{{ ${source} | date: "${fmt}" | minus: ${Math.abs(diff)} }}`;
      },
    },

    // ─── Loops ────────────────────────────────────────────
    {
      id: 'for-loop',
      name: 'For Loop',
      category: 'Loops',
      description: 'Iterate over items in a collection (array property).',
      fields: [
        { id: 'item_var', label: 'Item Variable Name', type: 'text', placeholder: 'e.g., item, product', default: 'item' },
        { id: 'collection', label: 'Collection Property', type: 'text', placeholder: 'e.g., Event.items', default: 'Event.items' },
        { id: 'body', label: 'Loop Body', type: 'textarea', placeholder: 'Content for each item...', default: '{{ item.name }} - {{ item.price }}' },
        { id: 'limit', label: 'Limit (optional)', type: 'text', placeholder: 'e.g., 5', default: '' },
      ],
      generate(values) {
        const limitStr = values.limit ? ` limit:${values.limit}` : '';
        return `{% for ${values.item_var} in ${values.collection}${limitStr} %}\n  ${values.body}\n{% endfor %}`;
      },
    },

    // ─── Data Handling ────────────────────────────────────
    {
      id: 'assign-variable',
      name: 'Assign Variable',
      category: 'Data Handling',
      description: 'Store a value in a variable for reuse.',
      fields: [
        { id: 'var_name', label: 'Variable Name', type: 'text', placeholder: 'e.g., greeting, discount', default: 'greeting' },
        { id: 'value', label: 'Value / Expression', type: 'text', placeholder: 'e.g., Profile.Name | default: "Friend"', default: 'Profile.Name | default: "Friend"' },
      ],
      generate(values) {
        return `{% assign ${values.var_name} = ${values.value} %}`;
      },
    },
    {
      id: 'product-fallback',
      name: 'Product Recommendation Fallback',
      category: 'Data Handling',
      description: 'Show a dynamic product if available, otherwise show a static fallback.',
      fields: [
        { id: 'dynamic_prop', label: 'Dynamic Property', type: 'text', placeholder: 'e.g., Event.recommended_product', default: 'Event.recommended_product' },
        { id: 'dynamic_content', label: 'Dynamic Content', type: 'textarea', placeholder: 'Template when product exists...', default: 'Check out {{ Event.recommended_product }}!' },
        { id: 'fallback_content', label: 'Fallback Content', type: 'textarea', placeholder: 'Static fallback content...', default: 'Check out our latest arrivals!' },
      ],
      generate(values) {
        return `{% if ${values.dynamic_prop} != blank %}\n  ${values.dynamic_content}\n{% else %}\n  ${values.fallback_content}\n{% endif %}`;
      },
    },
  ];

  // Group patterns by category
  function getCategories() {
    const map = {};
    PATTERNS.forEach(p => {
      if (!map[p.category]) map[p.category] = [];
      map[p.category].push(p);
    });
    return map;
  }

  function getPattern(id) {
    return PATTERNS.find(p => p.id === id);
  }

  return { PATTERNS, getCategories, getPattern };
})();
