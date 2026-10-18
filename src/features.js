/* Feature texts: reads MPMB's Class Features / Racial Traits text into features for the app's list.
 * MPMB's format, one line each:
 *   **Wizard, level 3:**                                       a group heading
 *   #◆ Name# (source) #[usage]# rest                          a feature; a short feature has its whole description
 *                                                              in `rest`, often in plain brackets ("[Adv on Initiative]")
 *   ##◆ Name##. text                                           a feature with its text on the same line
 *   other lines                                                the description of the feature above
 * parse(text) → [{ group } | { name, src, usage, text: [lines] } | { para }]
 * staleClassText(text): true when the text looks like it was saved before the line-break fix (a normal feature heading
 *   without any description). Not counted: a heading with a usage and nothing else, because MPMB rewrites such a
 *   heading when the usage changes on a level up and drops the short text that followed it, e.g. Wild Shape's
 *   "(see 3rd page)" (Acrobat does the same).
 * Shared by the app and the Node tests. */
(function (root) {
  'use strict';
  const GROUP = /^\*\*(.+?):?\*\*\s*$/;
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
        cur = { name: m[1].trim(), src: (m[2] || '').trim(), usage: (m[3] || '').trim(), text: inline ? [cap(inline)] : [] };
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

  const api = { parse, staleClassText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBFeatures = api;
})(typeof self !== 'undefined' ? self : this);
