/* Feature texts: reads MPMB's Class Features / Racial Traits text into features for the app's list.
 * MPMB's format, one line each:
 *   **Wizard, level 3:**                                       a group heading
 *   #◆ Name# (source) #[usage]# rest                          a feature; a short feature has its whole description
 *                                                              in `rest`, often in plain brackets ("[Adv on Initiative]")
 *   ##◆ Name##. text                                           a feature with its text on the same line
 *   other lines                                                the description of the feature above
 * parse(text) → [{ group } | { name, src, usage, text: [lines] } | { para }]
 *   usage: the #[…]# text, or else a description in plain brackets (shown both on the line and when unfolded)
 * staleClassText(text): true when the text looks like it was saved before the line-break fix (a normal feature heading
 *   without any description). Not counted: a heading with a usage and nothing else, because MPMB rewrites such a
 *   heading when the usage changes on a level up and drops the short text that followed it, e.g. Wild Shape's
 *   "(see 3rd page)" (Acrobat does the same).
 * Shared by the app and the Node tests. */
(function (root) {
  'use strict';
  const GROUP = /^\*\*((?:(?!\*\*).)+?):?\*\*\s*$/;   // "**d100** **Effect**" (a table head) is not one
  const HEAD = /^#\s*◆\s*(.+?)#\s*(?:\(([^)]*)\))?\s*(?:#\[(.*?)\]#)?\s*(.*)$/;
  const HEAD2 = /^##\s*◆\s*(.+?)##\.?\s*(.*)$/;
  const PLAIN_HEAD = /^#\s*◆\s*[^#]+#\s*(?:\([^)]*\))?\s*$/;
  const lines = (text) => String(text || '').replace(/\r\n?|\n/g, '\n').split('\n');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function parse(text) {
    const out = [];
    let cur = null;
    for (const line of lines(text)) {
      let m;
      if (!line.trim()) continue;
      if ((m = GROUP.exec(line))) { cur = null; out.push({ group: m[1] }); continue; }
      if ((m = /^##\s*◆/.test(line) && HEAD2.exec(line))) { cur = { name: m[1].trim(), src: '', usage: '', text: m[2] ? [m[2]] : [] }; out.push(cur); continue; }
      if ((m = HEAD.exec(line))) {
        const rest = m[4].trim(), b = /^\[(.*)\]$/.exec(rest);
        const inline = b ? b[1].trim() : rest;
        // a description in brackets is short: it also goes in the chip on the line, unless there is a usage there
        const usage = (m[3] || '').trim() || (b ? inline : '');
        cur = { name: m[1].trim(), src: (m[2] || '').trim(), usage, text: inline ? [cap(inline)] : [] };
        out.push(cur);
        continue;
      }
      if (cur) cur.text.push(line); else out.push({ para: line });
    }
    return out;
  }

  function staleClassText(text) {
    let stale = false, open = null;
    for (const line of lines(text).concat(['#◆ end#'])) {
      if (/^#\s*◆/.test(line) || GROUP.test(line)) {
        if (open && open.plain && !open.text) stale = true;
        open = /^#\s*◆/.test(line) ? { plain: PLAIN_HEAD.test(line), text: 0 } : null;
      } else if (open && line.trim()) open.text++;
    }
    return stale;
  }

  // The sheet writes some class features in Notes (the third page's and the Notes pages): its extra choices (Monk's
  // Focus features, Brutal Strike effects, Eldritch Invocations), long texts (Wild Shape rules) and what didn't fit.
  // Their source names where they come from: a kind of choice ("Focus Feature") or a class/subclass and level ("Monk
  // 5"). links: [label, parent feature] from the sheet's class data (classes.js links). merge() puts them back:
  //  - inside the feature they belong to (its children), when that feature is in the class features;
  //  - else in level order in the group of that class or subclass;
  //  - else they stay in Notes.
  // classItems: parse(Class Features); notes: [{ field, items: parse(text) }]; info: { links, names } (classes.js
  // links; names: per class its class and subclass names, long and short).
  // → { items (class items, features with children), claimed: Set of "field|index" taken out of Notes }
  const srcLevel = (src) => { const m = /^(.+?)\s+(\d+)$/.exec(String(src || '').split(',')[0].trim()); return m ? { who: m[1].toLowerCase(), level: Number(m[2]) } : null; };
  const low = (s) => String(s || '').trim().toLowerCase();
  function merge(classItems, notes, info) {
    if (Array.isArray(info)) info = { links: info };
    const links = ((info && info.links) || []).slice().sort((a, b) => b[0].length - a[0].length);
    const names = ((info && info.names) || []).map((n) => n.map(low));
    const pre = [], groups = [];
    let g = null;
    const all = [];
    for (const it of classItems) {
      if (it.group) { g = { head: it, items: [], who: new Set() }; groups.push(g); continue; }
      const c = it.name ? Object.assign({}, it, { text: it.text.slice(), children: [] }) : it;
      if (c.name) all.push(c);
      if (!g) { if (c.name) { g = { head: null, items: [], who: new Set() }; groups.push(g); } else { pre.push(c); continue; } }
      g.items.push(c);
      const l = srcLevel(c.src);
      if (l) g.who.add(l.who);
    }
    const byName = (n) => all.filter((f) => low(f.name) === low(n))[0];
    const labelOf = (src) => { src = String(src || '').trim(); for (const [l] of links) if (src === l || src.indexOf(l + ',') === 0) return l; return src.split(',')[0].trim(); };
    const claimed = new Set();
    const place = (n, key) => {
      const label = labelOf(n.src), name = low(n.name);
      const item = Object.assign({}, n, { text: n.text.slice(), children: [], fromNotes: true });
      // inside the feature the sheet links it to (not the note itself: "Monk 5" → Stunning Strike is its own feature)
      for (const [l, parent] of links) {
        if (l !== label) continue;
        const f = byName(parent);
        if (!f) continue;
        if (low(f.name) === name) {   // the same feature: the class line plus its text from Notes
          if (!f.usage) f.usage = item.usage;
          f.text = f.text.concat(item.text.filter((t) => f.text.indexOf(t) === -1));
          f.children = f.children.concat(item.children);
        } else f.children.push(item);
        claimed.add(key);
        return;
      }
      // in level order in its class's or subclass's group; inside a feature there whose name it starts with
      // ("Wild Shape Rules" in Wild Shape)
      const lv = srcLevel(label);
      // the group with that name in its features' sources, or with another name of the same class
      const same = lv ? [lv.who].concat(...names.filter((n) => n.indexOf(lv.who) !== -1)) : [];
      const grp = lv && (groups.filter((x) => x.who.has(lv.who))[0] || groups.filter((x) => same.some((w) => x.who.has(w)))[0]);
      if (!grp) return;
      const host = grp.items.filter((f) => f.name && name.indexOf(low(f.name)) === 0 && low(f.name) !== name).sort((a, b) => b.name.length - a.name.length)[0];
      if (host) host.children.push(item);
      else {
        all.push(item);
        let at = grp.items.length;
        for (let i = 0; i < grp.items.length; i++) { const x = srcLevel(grp.items[i].src); if (x && x.level > lv.level) { at = i; break; } }
        grp.items.splice(at, 0, item);
      }
      claimed.add(key);
    };
    for (const box of notes || []) box.items.forEach((n, i) => { if (n.name) place(n, box.field + '|' + i); });
    const items = pre.slice();
    for (const x of groups) { if (x.head) items.push(x.head); items.push.apply(items, x.items); }
    return { items, claimed };
  }

  const api = { parse, staleClassText, merge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBFeatures = api;
})(typeof self !== 'undefined' ? self : this);
