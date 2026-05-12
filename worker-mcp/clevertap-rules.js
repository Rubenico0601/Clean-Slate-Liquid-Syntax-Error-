export const CLEVERTAP_RULES = `# CleverTap LiqP 0.7.9 — Liquid Syntax Rules

CleverTap personalises messages using a Liquid implementation called **LiqP 0.7.9** (nl.big-o:liqp). It diverges from standard Shopify Liquid and from Leanplum/Jinja2 in several important ways. Follow these rules when authoring or reviewing templates.

## Personalisation tokens

- Profile attributes: \`Profile.<AttributeName>\` — note the capital P.
- Event properties: \`Event.<EventName>.<PropertyName>\` — capital E.
- Attribute or event names containing spaces, dots, or special chars MUST use bracket notation with quoted string keys:
  - Correct: \`Profile["First Name"]\`, \`Profile['user.country']\`
  - Wrong: \`Profile.First Name\`, \`Profile.user.country\` (the second collapses two levels)
- Nesting is capped at **3 levels deep**. \`a.b.c.d\` will not resolve. Re-shape upstream data if needed.

## Tags

- Supported block tags: \`if / elsif / else / endif\`, \`unless / endunless\`, \`for / endfor\`, \`case / when / endcase\`, \`capture / endcapture\`, \`comment / endcomment\`, \`raw / endraw\`, \`tablerow / endtablerow\`.
- Standalone tags: \`assign\`, \`increment\`, \`decrement\`, \`abort\`.
- \`abort\` is CleverTap-specific — it stops message delivery entirely. Use it to gate sends on conditions (e.g. \`{% if Profile.optedOut %}{% abort %}{% endif %}\`).
- \`break\` and \`continue\` only inside \`for\`.

## Filters

- The \`date\` filter takes the **bare keyword** \`now\`, NOT a string. Correct: \`{{ "now" | date: "%Y-%m-%d" }}\` is WRONG in LiqP 0.7.9 — use \`{{ now | date: "%Y-%m-%d" }}\`.
- Common filters supported: \`default\`, \`upcase\`, \`downcase\`, \`capitalize\`, \`strip\`, \`lstrip\`, \`rstrip\`, \`replace\`, \`replace_first\`, \`remove\`, \`remove_first\`, \`append\`, \`prepend\`, \`split\`, \`size\`, \`first\`, \`last\`, \`slice\`, \`join\`, \`sort\`, \`reverse\`, \`uniq\`, \`map\`, \`where\`, \`plus\`, \`minus\`, \`times\`, \`divided_by\`, \`modulo\`, \`round\`, \`ceil\`, \`floor\`, \`abs\`, \`date\`, \`escape\`, \`url_encode\`, \`url_decode\`, \`json\`, \`newline_to_br\`, \`strip_html\`, \`strip_newlines\`, \`truncate\`, \`truncatewords\`.
- NOT supported (Jinja/Leanplum-only): \`length\` (use \`size\`), \`int\`, \`float\`, \`string\`, \`list\`, \`tojson\` (use \`json\`), \`safe\`, \`e\`, \`format\`, \`title\`, \`trim\` (use \`strip\`).

## Migration gotchas (from Leanplum / Jinja2)

- \`{% set x = ... %}\` → \`{% assign x = ... %}\`.
- \`{{ user.attribute('X') }}\` → \`{{ Profile.X }}\` or \`{{ Profile["X"] }}\`.
- Leanplum's \`{% skip_message %}\` → CleverTap's \`{% abort %}\`.
- Jinja's \`{{ now() }}\` → \`{{ now | date: "..." }}\`.
- Array literal \`{% assign xs = [1,2,3] %}\` is invalid — split a string instead: \`{% assign xs = "1,2,3" | split: "," %}\`.
- Jinja \`loop.index\` → \`forloop.index\` (and \`loop.index0\` → \`forloop.index0\`, etc.).

## Common errors and what they mean

- "liquid tag error" usually means an unclosed block, a misspelled tag, or a tag used outside its parent context.
- "syntax error" usually means a malformed expression inside \`{{ ... }}\` or \`{% ... %}\` (mismatched quotes, dangling operator, unknown filter).
- Silent failures (template renders but token is blank) usually mean a typo in \`Profile.X\` capitalisation, an unsupported filter chain, or nesting deeper than 3 levels.
`;
