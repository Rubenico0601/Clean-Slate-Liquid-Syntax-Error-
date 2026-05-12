/**
 * Variable Inspector — Detects swappable values in a CleverTap template
 * (Profile/Event/Linked references, assigned string literals, image URLs,
 * anchor URLs) and produces edit-and-apply replacements.
 *
 * Pure JS, no DOM dependencies — the UI layer in app.js renders the result.
 */

class VariableInspector {

  inspect(source) {
    const tokens = this._collectTokens(source);
    const assigns = this._collectAssigns(source);
    const images = this._collectUrls(source, /* imagesOnly */ true);
    const links = this._collectLinks(source);
    return {
      categories: [
        { key: 'tokens',  title: 'Personalisation Tokens', hint: 'CleverTap Profile / Event / Linked references. Replace the attribute name to swap which property is used.', items: tokens },
        { key: 'assigns', title: 'Assigned String Literals', hint: 'Values inside {% assign x = "..." %} — typically ID banks or display-name banks. Replace the contents (without quotes).', items: assigns },
        { key: 'images',  title: 'Image URLs', hint: '<img src> values and other image URLs found in the markup.', items: images },
        { key: 'links',   title: 'Anchor URLs', hint: '<a href> values. Includes CTAs and footer links.', items: links },
      ],
      counts: {
        tokens: tokens.length,
        assigns: assigns.length,
        images: images.length,
        links: links.length,
      },
    };
  }

  apply(source, items, edits) {
    let result = source;
    for (const item of items) {
      const newValue = edits[item.id];
      if (newValue === undefined || newValue === null) continue;
      const trimmed = String(newValue);
      if (trimmed === '' || trimmed === item.currentValue) continue;
      for (const occ of item.occurrences) {
        const replacement = occ.renderNew(trimmed);
        result = result.split(occ.original).join(replacement);
      }
    }
    return result;
  }

  flattenItems(inspection) {
    return inspection.categories.flatMap((c) => c.items);
  }

  // ─── Token collection (Profile / Event / Linked) ───────────

  _collectTokens(source) {
    const map = new Map();

    const add = (key, item) => {
      if (!map.has(key)) {
        map.set(key, item);
      } else {
        const existing = map.get(key);
        existing.occurrences.push(...item.occurrences);
        existing.count += item.count;
      }
    };

    // Profile.X (dot)
    for (const m of source.matchAll(/\bProfile\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      const attr = m[1];
      add(`Profile|${attr}`, {
        id: `token_profile_${attr}`,
        subtype: 'Profile',
        label: `Profile.${attr}`,
        currentValue: attr,
        editableHint: 'attribute name',
        count: 1,
        occurrences: [{
          original: m[0],
          renderNew: (val) => `Profile.${val}`,
        }],
      });
    }

    // Profile["X"] / Profile['X'] (bracket)
    for (const m of source.matchAll(/\bProfile\[(['"])([^'"\]]+)\1\]/g)) {
      const quote = m[1];
      const attr = m[2];
      const key = `Profile|${attr}`;
      if (map.has(key)) {
        // Same attribute already seen via dot syntax — merge the occurrence
        const existing = map.get(key);
        existing.occurrences.push({ original: m[0], renderNew: (val) => `Profile[${quote}${val}${quote}]` });
        existing.count += 1;
        existing.label = `Profile["${attr}"] / Profile.${attr}`;
      } else {
        add(key, {
          id: `token_profile_${attr.replace(/[^A-Za-z0-9]/g, '_')}`,
          subtype: 'Profile',
          label: `Profile["${attr}"]`,
          currentValue: attr,
          editableHint: 'attribute name',
          count: 1,
          occurrences: [{
            original: m[0],
            renderNew: (val) => `Profile[${quote}${val}${quote}]`,
          }],
        });
      }
    }

    // Event.X or Event.X.Y
    for (const m of source.matchAll(/\bEvent\.([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\b/g)) {
      const eventName = m[1];
      const propName = m[2];
      const label = propName ? `Event.${eventName}.${propName}` : `Event.${eventName}`;
      const key = `Event|${eventName}|${propName || ''}`;
      add(key, {
        id: `token_event_${eventName}${propName ? '_' + propName : ''}`.replace(/[^A-Za-z0-9_]/g, '_'),
        subtype: 'Event',
        label,
        currentValue: propName ? `${eventName}.${propName}` : eventName,
        editableHint: propName ? 'event.property' : 'event name',
        count: 1,
        occurrences: [{
          original: m[0],
          renderNew: (val) => `Event.${val}`,
        }],
      });
    }

    // Linked.X
    for (const m of source.matchAll(/\bLinked\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      const key = m[1];
      add(`Linked|${key}`, {
        id: `token_linked_${key}`,
        subtype: 'Linked',
        label: `Linked.${key}`,
        currentValue: key,
        editableHint: 'linked content key',
        count: 1,
        occurrences: [{
          original: m[0],
          renderNew: (val) => `Linked.${val}`,
        }],
      });
    }

    // Sort by subtype then label so output is stable and readable
    return [...map.values()].sort((a, b) => {
      if (a.subtype !== b.subtype) return a.subtype.localeCompare(b.subtype);
      return a.label.localeCompare(b.label);
    });
  }

  // ─── Assigned string literals ──────────────────────────────

  _collectAssigns(source) {
    // {% assign <name> = "..." [| filter ...] %} — value is the FIRST quoted literal.
    // The tail (filters, whitespace, optional '-') is allowed but ignored.
    const re = /\{%-?\s*assign\s+([A-Za-z_]\w*)\s*=\s*(["'])((?:(?!\2).)*)\2[^%]*?-?%\}/g;
    const items = [];
    const seen = new Map();

    for (const m of source.matchAll(re)) {
      const varName = m[1];
      const quote = m[2];
      const value = m[3];
      const original = m[0];
      const key = `${varName}|${value}`;

      if (seen.has(key)) {
        const existing = seen.get(key);
        existing.occurrences.push({
          original,
          renderNew: (val) => original.replace(`${quote}${value}${quote}`, `${quote}${val}${quote}`),
        });
        existing.count += 1;
        continue;
      }

      const item = {
        id: `assign_${varName}_${items.length}`.replace(/[^A-Za-z0-9_]/g, '_'),
        subtype: 'assign',
        label: varName,
        currentValue: value,
        editableHint: 'string value (without quotes)',
        count: 1,
        occurrences: [{
          original,
          renderNew: (val) => original.replace(`${quote}${value}${quote}`, `${quote}${val}${quote}`),
        }],
      };
      items.push(item);
      seen.set(key, item);
    }

    return items;
  }

  // ─── Image URLs ────────────────────────────────────────────

  _collectUrls(source) {
    const seen = new Map();

    const addUrl = (url, occOriginal, renderNew, kind) => {
      if (!url || url.includes('{{') || url.includes('{%')) {
        // Templated URLs — still track but don't treat as simple swap target.
        // Keep them in for visibility; the user can paste a fully new templated URL too.
      }
      const key = url;
      if (seen.has(key)) {
        seen.get(key).occurrences.push({ original: occOriginal, renderNew });
        seen.get(key).count += 1;
        return;
      }
      seen.set(key, {
        id: `image_${seen.size}_${url.replace(/[^A-Za-z0-9]/g, '_').slice(0, 40)}`,
        subtype: kind,
        label: this._shortenUrl(url),
        currentValue: url,
        editableHint: 'full URL',
        count: 1,
        occurrences: [{ original: occOriginal, renderNew }],
      });
    };

    // <img src="...">
    for (const m of source.matchAll(/<img\b[^>]*?\bsrc=(["'])([^"']+)\1/gi)) {
      const url = m[2];
      const quote = m[1];
      const original = m[0];
      addUrl(url, original, (val) => original.replace(`src=${quote}${url}${quote}`, `src=${quote}${val}${quote}`), 'img');
    }

    // CSS background: url(...) and background-image: url(...)
    for (const m of source.matchAll(/background(?:-image)?\s*:\s*url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
      const url = m[2];
      const quote = m[1];
      const original = m[0];
      addUrl(url, original, (val) => original.replace(`${quote}${url}${quote}`, `${quote}${val}${quote}`), 'bg');
    }

    return [...seen.values()].sort((a, b) => a.currentValue.localeCompare(b.currentValue));
  }

  // ─── Anchor URLs ───────────────────────────────────────────

  _collectLinks(source) {
    const seen = new Map();

    for (const m of source.matchAll(/<a\b[^>]*?\bhref=(["'])([^"']+)\1/gi)) {
      const url = m[2];
      const quote = m[1];
      const original = m[0];
      const renderNew = (val) => original.replace(`href=${quote}${url}${quote}`, `href=${quote}${val}${quote}`);
      if (seen.has(url)) {
        seen.get(url).occurrences.push({ original, renderNew });
        seen.get(url).count += 1;
        continue;
      }
      seen.set(url, {
        id: `link_${seen.size}_${url.replace(/[^A-Za-z0-9]/g, '_').slice(0, 40)}`,
        subtype: 'link',
        label: this._shortenUrl(url),
        currentValue: url,
        editableHint: 'full URL',
        count: 1,
        occurrences: [{ original, renderNew }],
      });
    }

    return [...seen.values()].sort((a, b) => a.currentValue.localeCompare(b.currentValue));
  }

  // ─── Helpers ───────────────────────────────────────────────

  _shortenUrl(url, max = 70) {
    if (url.length <= max) return url;
    const head = url.slice(0, max - 24);
    const tail = url.slice(-20);
    return `${head}…${tail}`;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VariableInspector;
}
