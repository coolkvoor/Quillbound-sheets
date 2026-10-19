/* MPMB engine: a stand-in for Adobe Acrobat's scripting environment, just big enough to run
 * MPMB's own character-sheet code unchanged.
 *
 * It lives in the same JavaScript realm as MPMB's code (a Web Worker in the app, a vm context in tests).
 * MPMB changes built-in prototypes (for example Array.prototype.find returns an index and takes a regex,
 * and Array.prototype gains enumerable methods), so this file never uses Array#find and never iterates
 * arrays with for...in.
 *
 * host = { global, evalGlobal(code, name) }   global: the object MPMB's globals live on
 */
(function (root) {
  'use strict';

  // ---- PDF flag bits --------------------------------------------------------------------------
  const FF = {
    readonly: 1 << 0, required: 1 << 1,
    multiline: 1 << 12, password: 1 << 13, noToggleToOff: 1 << 14, radio: 1 << 15, pushbutton: 1 << 16,
    combo: 1 << 17, edit: 1 << 18, sort: 1 << 19, fileSelect: 1 << 20, multiSelect: 1 << 21,
    doNotSpellCheck: 1 << 22, doNotScroll: 1 << 23, comb: 1 << 24, richText: 1 << 25, radiosInUnison: 1 << 25, commitOnSelChange: 1 << 26,
  };
  const AF = { invisible: 1, hidden: 2, print: 4, noView: 32 };
  const DISPLAY = { visible: 0, hidden: 1, noPrint: 2, noView: 3 };
  const WIDGET_TRIGGERS = { MouseUp: 'A', MouseDown: 'D', MouseEnter: 'E', MouseExit: 'X', OnFocus: 'Fo', OnBlur: 'Bl' };
  const FIELD_TRIGGERS = { Keystroke: 'K', Validate: 'V', Calculate: 'C', Format: 'F' };

  function createEngine(model, host, opts) {
    opts = opts || {};
    const g = host.global;
    const evalGlobal = host.evalGlobal;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // ---- logs (shown in the app's Sheet tab) ----------------------------------------------------
    const log = { alerts: [], dialogs: [], menus: [], errors: [], urls: [], console: [], unsupported: {} };
    const MAXLOG = 200;
    let logSeq = 0;   // every log entry gets a number, so callers can ask "what happened since n"
    const push = (arr, item) => { if (item && typeof item === 'object') item.seq = ++logSeq; arr.push(item); if (arr.length > MAXLOG) arr.shift(); };
    // thrown out of MPMB's code when the run stops for the user (stopForUser); not an error
    const STOP = new Error('MPMB stopped for the user');
    STOP.mpmbStop = true;
    function logError(where, e) {
      if (e === STOP) return;
      const msg = e && e.message ? e.message : String(e);
      let at = '';
      if (e && e.stack) {
        const lines = String(e.stack).split('\n');
        for (let i = 0; i < lines.length; i++) { if (/mpmb:|field:|doc:/.test(lines[i])) { at = lines[i].trim(); break; } }
      }
      push(log.errors, { where, msg, at });
      if (opts.onError) opts.onError(where, msg, at);
    }
    const unsupported = (what) => { log.unsupported[what] = (log.unsupported[what] || 0) + 1; };

    // ---- pages --------------------------------------------------------------------------------
    // Page records: index = position in `pages`. Visible pages come from the PDF; template spawns add more.
    const pages = [];
    for (let i = 0; i < model.pageCount; i++) pages.push({ template: null, size: model.pageSizes[i] });

    // ---- field records --------------------------------------------------------------------------
    const recs = new Map();         // full name -> record
    const dirty = new Set();        // names changed since last drain
    let calcOrder = model.calcOrder.slice();

    function initialValue(def) {
      if (def.value !== null && def.value !== undefined) return Array.isArray(def.value) ? def.value.slice() : String(def.value);
      if (def.type === 'Btn' && !(def.ff & FF.pushbutton)) return 'Off';
      return '';
    }
    function makeRec(name, def, pageOverride) {
      const rec = {
        name, def,
        value: initialValue(def),
        props: {},
        scripts: Object.assign({}, def.scripts),
        items: null,
        widgets: def.widgets.map((w) => ({
          page: pageOverride !== undefined ? pageOverride : (w.page !== null && w.page !== undefined ? pages[w.page] : null),
          template: w.template, rect: w.rect ? w.rect.slice() : null, flags: w.flags || 0,
          scripts: Object.assign({}, w.scripts), props: {}, caption: w.caption, states: w.states, bg: w.bg,
        })),
        obj: null, widgetObjs: [],
      };
      // the PDF's picked index (/I), kept only where it tells more than the value: a later item sharing its export value
      if (Array.isArray(def.index) && def.index.length === 1) {
        const it = itemsOf(rec), k = Number(def.index[0]);
        if (it[k] && it[k][1] === rec.value && it.findIndex((x) => x[1] === it[k][1]) !== k) rec.props.valueIndex = k;
      }
      return markBaseline(rec);
    }
    // What a field looked like when it was created, so a saved state only holds what changed since
    function markBaseline(rec) {
      rec.init = Array.isArray(rec.value) ? rec.value.slice() : rec.value;
      rec.initScripts = Object.assign({}, rec.scripts);
      for (let i = 0; i < rec.widgets.length; i++) rec.widgets[i].initScripts = Object.assign({}, rec.widgets[i].scripts);
      return rec;
    }
    // Page changes in order (spawn, delete, remove field); a saved state replays them to get the same field names back
    const pageOps = [];
    for (let i = 0; i < model.fieldOrder.length; i++) {
      const n = model.fieldOrder[i];
      recs.set(n, makeRec(n, model.fields[n]));
    }

    const kind = (rec) => {
      const t = rec.def.type, ff = rec.def.ff;
      if (t === 'Tx') return 'text';
      if (t === 'Ch') return (ff & FF.combo) ? 'combobox' : 'listbox';
      if (t === 'Btn') return (ff & FF.pushbutton) ? 'button' : (ff & FF.radio) ? 'radiobutton' : 'checkbox';
      if (t === 'Sig') return 'signature';
      return 'text';
    };
    const isToggle = (rec) => { const k = kind(rec); return k === 'checkbox' || k === 'radiobutton'; };

    function itemsOf(rec) {
      if (rec.items) return rec.items;
      const o = rec.def.opts;
      const out = [];
      if (Array.isArray(o)) for (let i = 0; i < o.length; i++) { const it = o[i]; if (Array.isArray(it)) out.push([String(it[1] ?? it[0]), String(it[0])]); else out.push([String(it), String(it)]); }
      rec.items = out;   // [display, export]
      return out;
    }
    function exportsOf(rec) {
      const out = [];
      for (let i = 0; i < rec.widgets.length; i++) {
        const st = rec.widgets[i].states || [];
        let ex = 'Yes';
        for (let j = 0; j < st.length; j++) if (st[j] !== 'Off') { ex = st[j]; break; }
        out.push(ex);
      }
      return out;
    }
    const NUMERIC = /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/;
    function typedValue(rec) {
      const v = rec.value;
      if (Array.isArray(v)) return v.slice();
      const k = kind(rec);
      if ((k === 'text' || k === 'combobox' || k === 'listbox') && typeof v === 'string' && NUMERIC.test(v)) return Number(v);
      return v;
    }
    function normalize(rec, v) {
      if (v === null || v === undefined) return isToggle(rec) ? 'Off' : '';
      // only a list box keeps several values; any other field stores an array as text, as Acrobat does ("a,b"; [""] is "").
      // MPMB writes arrays into text fields (Template.extras.* after removing pages) and reads them back with split().
      if (Array.isArray(v)) { if (kind(rec) === 'listbox') return v.map(String); v = v.join(','); }
      if (typeof v === 'number') return isFinite(v) ? String(v) : String(v);
      // Acrobat stores line breaks in text fields as \r, whatever the script wrote. MPMB depends on it: it finds a
      // class feature's section by its \r lines, and with \n left in, new features went in under the wrong heading.
      if (kind(rec) === 'text') return String(v).replace(/\r\n|\n/g, '\r');
      return String(v);
    }
    function setRaw(rec, v) {
      const nv = normalize(rec, v);
      const same = Array.isArray(nv) ? JSON.stringify(nv) === JSON.stringify(rec.value) : nv === rec.value;
      if (!same) { rec.value = nv; dirty.add(rec.name); docState.dirty = true; }
      if (rec.props.richValue) { delete rec.props.richValue; dirty.add(rec.name); }
    }
    const markDirty = (rec) => dirty.add(rec.name);

    function displayOf(w) {
      if (w.props.display !== undefined) return w.props.display;
      const f = w.flags;
      if (f & AF.hidden) return DISPLAY.hidden;
      if (f & AF.noView) return DISPLAY.noView;
      if (f & AF.print) return DISPLAY.visible;
      return DISPLAY.noPrint;
    }
    const pageIndexOf = (w) => (w.page ? pages.indexOf(w.page) : -1);

    // ---- events ----------------------------------------------------------------------------------
    let inCalc = false;
    const compiled = new Map();
    function compile(code, label) {
      let fn = compiled.get(code);
      if (fn) return fn;
      fn = evalGlobal('(function(){' + code + '\n})\n//# sourceURL=' + label.replace(/[^\w.:-]/g, '_'), label);
      compiled.set(code, fn);
      return fn;
    }
    function mkEvent(name, target, extra) {
      const ev = {
        name, type: 'Field', target, targetName: target ? target.name : '', value: '', rc: true,
        change: '', changeEx: '', willCommit: false, modifier: false, shift: false, selStart: 0, selEnd: 0,
        keyDown: false, commitKey: 0, fieldFull: false, richValue: undefined, richChange: [], source: target,
      };
      if (extra) for (const k in extra) ev[k] = extra[k];
      return ev;
    }
    // Runs a script with `event` set; returns false if it threw
    function runScript(code, ev, label) {
      const saved = g.event;
      g.event = ev;
      try { compile(code, label).call(g); return true; }
      catch (e) { logError(label, e); return false; }
      finally { g.event = saved; }
    }
    function calcEnabled() { return docState.calculate !== false && appState.calculate !== false; }

    function runCalcs(sourceRec) {
      if (inCalc || !calcEnabled()) return;
      inCalc = true;
      try {
        const order = calcOrder.slice();
        for (let i = 0; i < order.length; i++) {
          const rec = recs.get(order[i]);
          if (!rec || !rec.scripts.C) continue;
          const fld = fieldObj(rec);
          const ev = mkEvent('Calculate', fld, { value: typedValue(rec), source: sourceRec ? fieldObj(sourceRec) : fld });
          if (!runScript(rec.scripts.C, ev, 'field:' + rec.name + ':calculate') || ev.rc === false) continue;
          let v = ev.value;
          // As in Acrobat, a value a calculation changes is validated before it is stored. MPMB relies on this:
          // it parks a field's new text in field.setVal, the field's Calculate puts it in, and its Validate clears
          // setVal (doDropDownValCalcWithChoices). Left there, setVal made the next typed species, feat or magic
          // item be ignored (Human after picking Infernal Tiefling).
          if (rec.scripts.V && String(v) !== String(rec.value)) {
            const vev = mkEvent('Validate', fld, { value: v });
            runScript(rec.scripts.V, vev, 'field:' + rec.name + ':validate');
            if (vev.rc === false) continue;
            v = vev.value;
          }
          setRaw(rec, v);
        }
      } finally { inCalc = false; }
      stats.calcPasses++;
    }

    // value assignment from script: Validate (before storing), store, then recalculate (Acrobat order)
    function scriptSetValue(rec, v) {
      delete rec.props.valueIndex;   // a value set directly: no picked index (currentValueIndices sets it again)
      if (inCalc) { setRaw(rec, v); return; }
      if (rec.scripts.V) {
        const ev = mkEvent('Validate', fieldObj(rec), { value: v });
        runScript(rec.scripts.V, ev, 'field:' + rec.name + ':validate');
        if (ev.rc === false) return;
        v = ev.value;
      }
      setRaw(rec, v);
      runCalcs(rec);
    }

    // ---- Field objects ------------------------------------------------------------------------------
    const R = Symbol('rec'), W = Symbol('widget'), G = Symbol('group');
    function Field() {}
    function fieldObj(rec) {
      if (!rec.obj) { const f = new Field(); f[R] = rec; f[W] = -1; rec.obj = f; }
      return rec.obj;
    }
    function widgetObj(rec, i) {
      if (!rec.widgetObjs[i]) { const f = new Field(); f[R] = rec; f[W] = i; rec.widgetObjs[i] = f; }
      return rec.widgetObjs[i];
    }
    const widgetsOf = (f) => { const rec = f[R]; return f[W] >= 0 ? [rec.widgets[f[W]]] : rec.widgets; };
    const FP = Field.prototype;
    function accessor(name, get, set) { Object.defineProperty(FP, name, { get, set: set || function (v) { this[R].props[name] = v; markDirty(this[R]); }, configurable: true }); }
    // widget-level visual property: set on all widgets (field object) or one (widget object)
    function widgetProp(name, dflt) {
      accessor(name, function () { const w = widgetsOf(this)[0]; return w && w.props[name] !== undefined ? w.props[name] : dflt(this[R], w); },
        function (v) { const ws = widgetsOf(this); for (let i = 0; i < ws.length; i++) ws[i].props[name] = v; markDirty(this[R]); });
    }
    const fieldProp = (name, dflt) => accessor(name, function () { const p = this[R].props; return p[name] !== undefined ? p[name] : dflt(this[R]); });
    const flagProp = (name, bit) => fieldProp(name, (rec) => !!(rec.def.ff & bit));

    accessor('name', function () { return this[R].name; }, function () {});
    accessor('type', function () { return kind(this[R]); }, function () {});
    accessor('doc', function () { return g; }, function () {});
    accessor('value', function () { return typedValue(this[R]); }, function (v) { scriptSetValue(this[R], v); });
    accessor('valueAsString', function () { const v = this[R].value; return Array.isArray(v) ? v.join(',') : String(v); }, function () {});
    fieldProp('defaultValue', (rec) => (rec.def.defaultValue !== null && rec.def.defaultValue !== undefined ? rec.def.defaultValue : ''));
    fieldProp('userName', (rec) => rec.def.tu || '');
    fieldProp('submitName', (rec) => rec.def.tm || '');
    flagProp('readonly', FF.readonly); flagProp('required', FF.required); flagProp('multiline', FF.multiline);
    flagProp('password', FF.password); flagProp('fileSelect', FF.fileSelect); flagProp('doNotSpellCheck', FF.doNotSpellCheck);
    flagProp('doNotScroll', FF.doNotScroll); flagProp('comb', FF.comb); flagProp('editable', FF.edit);
    flagProp('multipleSelection', FF.multiSelect); flagProp('commitOnSelChange', FF.commitOnSelChange);
    flagProp('radiosInUnison', FF.radiosInUnison);
    fieldProp('richText', (rec) => kind(rec) === 'text' && !!(rec.def.ff & FF.richText));
    fieldProp('charLimit', (rec) => rec.def.maxLen || 0);
    fieldProp('alignment', (rec) => ['left', 'center', 'right'][rec.def.q || 0] || 'left');
    fieldProp('textSize', (rec) => { const m = /([\d.]+)\s+Tf/.exec(rec.def.da || ''); return m ? Number(m[1]) : 0; });
    fieldProp('textFont', (rec) => { const m = /\/([^\s]+)\s+[\d.]+\s+Tf/.exec(rec.def.da || ''); return m ? m[1] : 'Helv'; });
    fieldProp('textColor', () => ['G', 0]);
    fieldProp('delay', () => false);
    fieldProp('defaultStyle', () => ({}));
    widgetProp('display', (rec, w) => (w ? displayOf(w) : 0));
    accessor('hidden', function () { const d = this.display; return d === DISPLAY.hidden || d === DISPLAY.noView; }, function (v) { this.display = v ? DISPLAY.hidden : DISPLAY.visible; });
    accessor('print', function () { const d = this.display; return d === DISPLAY.visible || d === DISPLAY.noView; }, function (v) { const d = this.display; const shown = d === DISPLAY.visible || d === DISPLAY.noPrint; this.display = shown ? (v ? DISPLAY.visible : DISPLAY.noPrint) : (v ? DISPLAY.noView : DISPLAY.hidden); });
    widgetProp('fillColor', (rec, w) => (w && w.bg ? (w.bg.length === 1 ? ['G', w.bg[0]] : w.bg.length === 3 ? ['RGB'].concat(w.bg) : ['CMYK'].concat(w.bg)) : ['T']));
    widgetProp('strokeColor', () => ['T']);
    widgetProp('borderStyle', () => 'solid');
    widgetProp('lineWidth', () => 0);
    widgetProp('highlight', () => 'none');
    widgetProp('rotation', () => 0);
    widgetProp('style', () => 'check');
    widgetProp('buttonPosition', () => 0);
    widgetProp('buttonScaleHow', () => 0);
    widgetProp('buttonScaleWhen', () => 0);
    widgetProp('buttonAlignX', () => 50);
    widgetProp('buttonAlignY', () => 50);
    widgetProp('buttonFitBounds', () => false);
    accessor('rect', function () { const w = widgetsOf(this)[0]; return w && w.rect ? w.rect.slice() : [0, 0, 0, 0]; },
      function (v) { const ws = widgetsOf(this); for (let i = 0; i < ws.length; i++) ws[i].rect = v.slice(); markDirty(this[R]); });
    accessor('page', function () {
      const ws = widgetsOf(this);
      if (ws.length === 1) return pageIndexOf(ws[0]);
      return ws.map(pageIndexOf);
    }, function () {});
    accessor('numItems', function () { return itemsOf(this[R]).length; }, function () {});
    accessor('currentValueIndices', function () {
      const rec = this[R], it = itemsOf(rec), v = rec.value;
      if (Array.isArray(v)) { const out = []; for (let i = 0; i < it.length; i++) if (v.indexOf(it[i][1]) !== -1) out.push(i); return out; }
      // two items can share an export value (Medium and Small are both "1"): the one picked by index, as Acrobat keeps it
      const k = rec.props.valueIndex;
      if (k !== undefined && it[k] && it[k][1] === v) return k;
      for (let i = 0; i < it.length; i++) if (it[i][1] === v) return i;
      for (let i = 0; i < it.length; i++) if (it[i][0] === v) return i;
      return -1;
    }, function (v) {
      const rec = this[R], it = itemsOf(rec);
      if (Array.isArray(v) && rec.def.ff & FF.multiSelect) { scriptSetValue(rec, v.map((i) => (it[i] ? it[i][1] : '')).filter(Boolean)); return; }
      const idx = Number(Array.isArray(v) ? v[0] : v);
      scriptSetValue(rec, it[idx] ? it[idx][1] : '');
      // remembered only where the export value alone doesn't tell which item it is: an item after the first one
      // with the same export value (reading back finds the first one by itself)
      const first = it[idx] ? it.findIndex((x) => x[1] === it[idx][1]) : -1;
      if (first !== -1 && first !== idx && rec.value === it[idx][1]) rec.props.valueIndex = idx; else delete rec.props.valueIndex;
      markDirty(rec);
    });
    accessor('exportValues', function () { return exportsOf(this[R]); }, function (v) { this[R].props.exportValues = v; });
    accessor('calcOrderIndex', function () { return calcOrder.indexOf(this[R].name); }, function (v) {
      const n = this[R].name; const i = calcOrder.indexOf(n); if (i >= 0) calcOrder.splice(i, 1);
      calcOrder.splice(Math.max(0, Math.min(v, calcOrder.length)), 0, n);
    });
    accessor('richValue', function () {
      const rec = this[R];
      if (rec.props.richValue) return rec.props.richValue.map((s) => Object.assign({}, s));
      return [{ text: String(rec.value) }];
    }, function (spans) {
      const rec = this[R];
      const arr = Array.isArray(spans) ? spans : [];
      let text = '';
      for (let i = 0; i < arr.length; i++) text += arr[i] && arr[i].text !== undefined ? String(arr[i].text) : '';
      scriptSetValue(rec, text);
      rec.props.richValue = arr.map((s) => Object.assign({}, s));
      markDirty(rec);
    });

    FP.isBoxChecked = function (n) {
      const rec = this[R]; const ex = exportsOf(rec); const i = n || 0;
      if (rec.value === "Off" || rec.value === "") return 0;
      return (ex.length <= 1 || ex[i] === rec.value || (rec.props.exportValues ? rec.props.exportValues[i] === rec.value : false)) ? 1 : 0;
    };
    FP.checkThisBox = function (n, b) {
      const rec = this[R]; const ex = exportsOf(rec); const i = n || 0;
      scriptSetValue(rec, b === false ? 'Off' : (ex[i] || 'Yes'));
    };
    FP.defaultIsChecked = function (n, b) { this[R].props.defaultValue = b === false ? 'Off' : (exportsOf(this[R])[n || 0] || 'Yes'); return true; };
    FP.setItems = function (arr) {
      const rec = this[R]; const out = [];
      const a = Array.isArray(arr) ? arr : [];
      for (let i = 0; i < a.length; i++) { const it = a[i]; if (Array.isArray(it)) out.push([String(it[0]), String(it.length > 1 ? it[1] : it[0])]); else out.push([String(it), String(it)]); }
      rec.items = out; markDirty(rec);
    };
    FP.getItemAt = function (n, bExport) { const it = itemsOf(this[R])[n]; if (!it) return ''; return bExport === false ? it[0] : it[1]; };
    FP.insertItemAt = function (cName, cExport, nIdx) {
      const rec = this[R]; const it = itemsOf(rec).slice(); const i = nIdx === undefined ? 0 : (nIdx < 0 ? it.length : nIdx);
      it.splice(i, 0, [String(cName), String(cExport === undefined ? cName : cExport)]); rec.items = it; markDirty(rec);
    };
    FP.deleteItemAt = function (nIdx) { const rec = this[R]; const it = itemsOf(rec).slice(); it.splice(nIdx === undefined ? this.currentValueIndices : nIdx, 1); rec.items = it; markDirty(rec); };
    FP.clearItems = function () { const rec = this[R]; rec.items = []; markDirty(rec); };
    FP.setAction = function (trigger, code) {
      const rec = this[R];
      if (FIELD_TRIGGERS[trigger]) {
        const k = FIELD_TRIGGERS[trigger];
        if (code) rec.scripts[k] = String(code); else delete rec.scripts[k];
        if (k === 'C' && code && calcOrder.indexOf(rec.name) === -1) calcOrder.push(rec.name);
      } else if (WIDGET_TRIGGERS[trigger]) {
        const k = WIDGET_TRIGGERS[trigger]; const ws = widgetsOf(this);
        for (let i = 0; i < ws.length; i++) { if (code) ws[i].scripts[k] = String(code); else delete ws[i].scripts[k]; }
      } else unsupported('setAction:' + trigger);
    };
    FP.buttonSetIcon = function (icon) { const ws = widgetsOf(this); for (let i = 0; i < ws.length; i++) ws[i].props.icon = icon; markDirty(this[R]); };
    FP.buttonGetIcon = function () { const w = widgetsOf(this)[0]; return (w && w.props.icon) || { name: this[R].name, __icon: true }; };
    // Acrobat asks the user for an image or PDF file here. The app picks the image (queueIcon) and taps again; without
    // one this is the user cancelling (1), and takeIconWanted() tells the app which button wanted a picture.
    // An imported picture is { __icon, img: { id, mime, data (base64), w, h } }; writer.js puts it in the PDF.
    FP.buttonImportIcon = function () {
      if (!iconQueue.length) { iconWanted = this[R].name; return 1; }
      const icon = iconQueue.shift(), ws = widgetsOf(this);
      for (let i = 0; i < ws.length; i++) ws[i].props.icon = icon;
      markDirty(this[R]);
      return 0;
    };
    FP.buttonSetCaption = function (c) { const ws = widgetsOf(this); for (let i = 0; i < ws.length; i++) ws[i].props.caption = String(c); markDirty(this[R]); };
    FP.buttonGetCaption = function () { const w = widgetsOf(this)[0]; return w ? (w.props.caption !== undefined ? w.props.caption : (w.caption || '')) : ''; };
    FP.setFocus = function () { if (opts.onFocus) opts.onFocus(this[R].name); };
    FP.getArray = function () { return [this]; };
    FP.getLock = function () { return null; };
    FP.setLock = function () { return true; };
    FP.browseForFileToSubmit = function () { unsupported('browseForFileToSubmit'); };
    FP.signatureInfo = function () { return {}; };

    // A non-terminal field: reads come from its first descendant, writes go to all of them
    function groupObj(prefix, names) {
      const kids = names.map((n) => fieldObj(recs.get(n)));
      const target = {};
      target[G] = true;
      return new Proxy(target, {
        get(t, p) {
          if (p === 'getArray') return () => kids.slice();
          if (p === 'name') return prefix;
          if (p === 'type') return kids.length ? kids[0].type : 'text';
          if (typeof p === 'symbol') return t[p];
          if (p in t) return t[p];
          const v = kids.length ? kids[0][p] : undefined;
          if (typeof v === 'function') return function () { let r; for (let i = 0; i < kids.length; i++) r = kids[i][p].apply(kids[i], arguments); return r; };
          return v;
        },
        set(t, p, v) {
          if (p === 'value') { for (let i = 0; i < kids.length; i++) kids[i].value = v; return true; }
          if (p in FP || p === 'display' || p === 'readonly') { for (let i = 0; i < kids.length; i++) kids[i][p] = v; return true; }
          t[p] = v; return true;
        },
      });
    }
    const groupCache = new Map();
    function getField(name) {
      if (name === undefined || name === null) return null;
      name = String(name);
      const rec = recs.get(name);
      if (rec) return fieldObj(rec);
      const m = /^(.*)\.(\d+)$/.exec(name);
      if (m && recs.has(m[1])) { const r = recs.get(m[1]); const i = Number(m[2]); return i < r.widgets.length ? widgetObj(r, i) : null; }
      const pre = name + '.';
      const kids = [];
      for (const n of recs.keys()) if (n.lastIndexOf(pre, 0) === 0) kids.push(n);
      if (!kids.length) return null;
      const key = name + '|' + kids.length;
      if (!groupCache.has(key)) groupCache.set(key, groupObj(name, kids));
      return groupCache.get(key);
    }

    // ---- templates and pages ----------------------------------------------------------------
    function spawnTemplate(tName, nPage, bRename, bOverlay) {
      pageOps.push(['spawn', tName, nPage === undefined ? null : nPage, bRename === undefined ? null : bRename, !!bOverlay]);
      const at = nPage === undefined || nPage === null || nPage > pages.length ? pages.length : Math.max(0, nPage);
      let page;
      if (bOverlay && pages[at]) page = pages[at];
      else { page = { template: tName, size: pages.length ? pages[0].size : [595, 842] }; pages.splice(at, 0, page); }
      const prefix = 'P' + at + '.' + tName + '.';
      for (const [n, rec] of Array.from(recs.entries())) {
        const tw = rec.widgets.filter((w) => w.template === tName && !w.page);
        if (!tw.length) continue;
        if (bRename !== false) {
          const nn = prefix + n;
          if (recs.has(nn)) continue;
          const def = Object.assign({}, rec.def, { widgets: tw.map((w) => ({ page: null, template: null, rect: w.rect, flags: w.flags, scripts: w.scripts, caption: w.caption, states: w.states, bg: w.bg })), value: rec.def.defaultValue !== null && rec.def.defaultValue !== undefined ? rec.def.defaultValue : rec.def.value });
          const nr = makeRec(nn, def, page);
          nr.scripts = Object.assign({}, rec.scripts);
          markBaseline(nr);
          recs.set(nn, nr);
          if (rec.scripts.C && calcOrder.indexOf(nn) === -1) calcOrder.push(nn);
          dirty.add(nn);
        } else {
          for (let i = 0; i < tw.length; i++) rec.widgets.push(Object.assign({}, tw[i], { page, template: null, props: {}, scripts: Object.assign({}, tw[i].scripts), initScripts: Object.assign({}, tw[i].scripts) }));
          dirty.add(n);
        }
      }
      groupCache.clear();
      stats.spawns.push(tName);
      return null;
    }
    function deletePages(nStart, nEnd) {
      const s = nStart === undefined ? 0 : nStart, e = nEnd === undefined ? s : nEnd;
      pageOps.push(['delete', s, e]);
      const removed = pages.splice(s, e - s + 1);
      for (const [n, rec] of Array.from(recs.entries())) {
        const keep = rec.widgets.filter((w) => !(w.page && removed.indexOf(w.page) !== -1));
        if (keep.length === rec.widgets.length) continue;
        if (!keep.length) { recs.delete(n); const i = calcOrder.indexOf(n); if (i >= 0) calcOrder.splice(i, 1); } else rec.widgets = keep;
        dirty.add(n);
      }
      groupCache.clear();
    }
    function removeField(name) {
      pageOps.push(['remove', String(name)]);
      const pre = name + '.';
      for (const n of Array.from(recs.keys())) if (n === name || n.lastIndexOf(pre, 0) === 0) { recs.delete(n); const i = calcOrder.indexOf(n); if (i >= 0) calcOrder.splice(i, 1); dirty.add(n); }
      groupCache.clear();
    }

    // ---- Acrobat globals --------------------------------------------------------------------------
    const timeouts = [];
    let timeoutId = 0;
    const fileQueue = [];       // texts for util.readFileIntoStream, picked by the user in the app
    const iconQueue = [];       // pictures for button.buttonImportIcon, picked by the user in the app
    let iconWanted = null;      // the button that asked for a picture when none was queued
    const dialogAnswers = [];   // { name, steps: [{ set: {item_id: value} } | { pick } | { press: item_id } | { end }], capture }, used in order
    const standingAnswers = {}; // dialog name -> answer used every time it opens (unless one is queued)
    const menuAnswers = [];     // cReturn values for the next app.popUpMenuEx calls, in order (null = nothing chosen)
    let lastMenu = null;        // the last menu nobody answered: [{ name, ret, marked, enabled, items }]
    // Yes/No questions (app.alert with nType 2 or 3). Normally answered Yes. While asking is on (a tap from the app), a
    // question without a queued answer is answered No and kept (lastQuestion) for the app to ask; the tap then runs
    // again with the user's answer queued. MPMB asks such questions ("This can't be undone! Are you sure?") before it
    // changes anything, so the No run has no effect.
    const alertAnswers = [];    // 4 (Yes) / 3 (No) / 2 (Cancel), used in order
    let askQuestions = false, lastQuestion = null;
    // A user at the screen (engine.interactive(fn)): dialogs and questions without a queued answer are shown to the user.
    // fn(request) is synchronous (the worker waits for the app with Atomics.wait) and returns the user's reply, or null.
    let interact = null, dialogSeq = 0;
    const dialogIdBase = Math.random().toString(36).slice(2, 8);
    // Stopping for the user (replay.js): with stopForUser on, the first dialog or yes/no question that nobody can answer
    // stops the run (STOP is thrown out of MPMB's code; it isn't logged as an error) and is kept in `stopped`. The
    // user's answers then go to a fresh copy as a replay queue (setReplay): { kind: 'dialog', name, replies } and
    // { kind: 'question', yes }, used in order as MPMB asks again. engine.clearQueues() leaves that queue alone.
    let stopForUser = false, stopped = null, replayQueue = [];
    function replayTake(kind, name) {
      for (let i = 0; i < replayQueue.length; i++) {
        const a = replayQueue[i];
        if (a.kind === kind && (kind !== 'dialog' || a.name === name)) return replayQueue.splice(i, 1)[0];
      }
      return null;
    }
    function menuTree(arr) {
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        const m = arr[i];
        if (!m || typeof m !== 'object') continue;
        const name = String(m.cName === undefined ? '' : m.cName);
        const node = { name, ret: m.cReturn !== undefined ? String(m.cReturn) : name, marked: !!m.bMarked, enabled: m.bEnabled !== false };
        if (Array.isArray(m.oSubMenu)) node.items = menuTree(m.oSubMenu);
        else if (m.oSubMenu && typeof m.oSubMenu === 'object') node.items = menuTree([m.oSubMenu]);
        out.push(node);
      }
      return out;
    }
    function menuHas(items, ret) {
      for (let i = 0; i < items.length; i++) { const n = items[i]; if (n.items ? menuHas(n.items, ret) : (n.ret === ret && n.enabled && n.name !== '-')) return true; }
      return false;
    }
    const appState = { calculate: true };
    const docState = { calculate: true, delay: false, dirty: false, pageNum: 0, disclosed: false };
    const pad = (n, w) => String(n).padStart(w || 2, '0');
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    function printd(fmt, d) {
      if (!(d instanceof Date)) d = new Date(d);
      if (typeof fmt === 'number') return fmt === 0 ? 'D:' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) : d.toISOString();
      return String(fmt).replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|HH|H|hh|h|MM|M|ss|s|tt/g, (t) => {
        switch (t) {
          case 'yyyy': return d.getFullYear(); case 'yy': return pad(d.getFullYear() % 100);
          case 'mmmm': return MONTHS[d.getMonth()]; case 'mmm': return MONTHS[d.getMonth()].slice(0, 3);
          case 'mm': return pad(d.getMonth() + 1); case 'm': return d.getMonth() + 1;
          case 'dddd': return DAYS[d.getDay()]; case 'ddd': return DAYS[d.getDay()].slice(0, 3);
          case 'dd': return pad(d.getDate()); case 'd': return d.getDate();
          case 'HH': return pad(d.getHours()); case 'H': return d.getHours();
          case 'hh': return pad(d.getHours() % 12 || 12); case 'h': return d.getHours() % 12 || 12;
          case 'MM': return pad(d.getMinutes()); case 'M': return d.getMinutes();
          case 'ss': return pad(d.getSeconds()); case 's': return d.getSeconds();
          case 'tt': return d.getHours() < 12 ? 'am' : 'pm';
        }
        return t;
      });
    }
    function scand(fmt, s) {
      if (s === undefined || s === null || s === '') return null;
      const toks = String(fmt).match(/yyyy|yy|mmmm|mmm|mm|m|dd|d|HH|H|MM|M|ss|s/g) || [];
      const nums = String(s).match(/\d+|[A-Za-z]+/g) || [];
      const d = { y: 1970, mo: 0, d: 1, h: 0, mi: 0, s: 0 };
      for (let i = 0; i < toks.length && i < nums.length; i++) {
        const t = toks[i], v = nums[i];
        if (t === 'yyyy') d.y = +v; else if (t === 'yy') d.y = 2000 + (+v);
        else if (t === 'mmmm' || t === 'mmm') { const ix = MONTHS.findIndex((m) => m.toLowerCase().indexOf(String(v).toLowerCase().slice(0, 3)) === 0); d.mo = ix < 0 ? 0 : ix; }
        else if (t === 'mm' || t === 'm') d.mo = +v - 1; else if (t === 'dd' || t === 'd') d.d = +v;
        else if (t === 'HH' || t === 'H') d.h = +v; else if (t === 'MM' || t === 'M') d.mi = +v; else if (t === 'ss' || t === 's') d.s = +v;
      }
      const out = new Date(d.y, d.mo, d.d, d.h, d.mi, d.s);
      return isNaN(out.getTime()) ? null : out;
    }
    function printf(fmt) {
      const args = Array.prototype.slice.call(arguments, 1); let i = 0;
      return String(fmt).replace(/%([,\d]*)(\.(\d+))?([dfsx%])/g, (m, flags, _p, prec, conv) => {
        if (conv === '%') return '%';
        const v = args[i++];
        if (conv === 's') return String(v);
        if (conv === 'x') return Number(v).toString(16);
        if (conv === 'd') return String(Math.trunc(Number(v)));
        let s = Number(v).toFixed(prec !== undefined ? Number(prec) : 6);
        const sep = flags && flags[0] === ',' ? flags[1] : null;
        if (sep === '0' || sep === undefined && flags === ',') s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return s;
      });
    }

    const app = {
      viewerVersion: opts.viewerVersion || 24.001, viewerType: 'Reader', viewerVariation: 'Reader', platform: 'WIN', language: 'ENU',
      formsVersion: 24, toolbar: true, focusRect: true, runtimeHighlight: true, runtimeHighlightColor: ['RGB', 0.8, 0.85, 1],
      monitors: [{ rect: [0, 0, 1920, 1080], workRect: [0, 0, 1920, 1040], colorDepth: 24, isPrimary: true }],
      fs: { isFullScreen: false }, printerNames: [], fromPDFConverters: [], media: {},
      get calculate() { return appState.calculate; }, set calculate(v) { appState.calculate = v; },
      alert(a, nIcon, nType, cTitle, oDoc, oCheckbox) {
        const o = typeof a === 'object' && a !== null ? a : { cMsg: a, nIcon, nType, cTitle, oCheckbox };
        const type = o.nType || 0;
        const question = type === 2 || type === 3;
        let answer = question ? 4 : 1;   // Yes / OK
        let replayed = null, stopNow = false;
        if (question && alertAnswers.length) answer = alertAnswers.shift();
        else if (question && (replayed = replayTake('question'))) answer = replayed.yes ? 4 : replayed.cancel && type === 3 ? 2 : 3;
        else if (question && stopped) answer = 3;   // after a stop nothing more is asked
        else if (question && stopForUser && !interact && !askQuestions) { stopped = { kind: 'question', title: o.cTitle ? String(o.cTitle) : '', msg: String(o.cMsg === undefined ? '' : o.cMsg), type }; stopNow = true; }
        else if (question && interact && !askQuestions) { const r = interact({ kind: 'question', title: o.cTitle ? String(o.cTitle) : '', msg: String(o.cMsg === undefined ? '' : o.cMsg), type }); answer = r && r.yes ? 4 : r && r.cancel && type === 3 ? 2 : 3; }
        else if (question && askQuestions) { answer = 3; if (!lastQuestion) lastQuestion = { title: o.cTitle ? String(o.cTitle) : '', msg: String(o.cMsg === undefined ? '' : o.cMsg), type }; }
        push(log.alerts, { title: o.cTitle ? String(o.cTitle) : '', msg: String(o.cMsg === undefined ? '' : o.cMsg), type, question, t: Date.now() });
        if (o.oCheckbox) o.oCheckbox.bAfterValue = false;
        if (opts.onAlert) opts.onAlert(log.alerts[log.alerts.length - 1]);
        if (stopNow) throw STOP;
        return answer;
      },
      execDialog(d) {
        // Without a queued answer: the defaults the dialog loads itself (as if the user pressed OK), or, with a user at
        // the screen (interact), the dialog itself, shown by the app and run the way Acrobat runs it.
        // A queued answer for this dialog name replays what a user would do: set values, press buttons, then OK.
        const desc = (d && d.description) || {};
        const entry = { name: String(desc.name || 'Dialog'), title: firstText(desc), answered: 'defaults', t: Date.now() };
        push(log.dialogs, entry);
        let plan = null;
        for (let i = 0; i < dialogAnswers.length; i++) if (dialogAnswers[i].name === entry.name) { plan = dialogAnswers.splice(i, 1)[0]; break; }
        if (!plan && standingAnswers[entry.name]) plan = standingAnswers[entry.name];
        if (plan) entry.answered = 'app';
        // Who answers: a queued plan (steps from an app screen), the replies a user gave this dialog before (a replay,
        // see engine.setReplay: same name, in order), a user at the screen (interact), or nobody (its defaults). With
        // stopping on (engine.stopForUser), a dialog nobody can answer stops the run here: it stays open (stopped()),
        // the user answers it, and the change is made again in a fresh copy with the replies (replay.js).
        let user = !plan && interact ? interact : null;
        if (user) entry.answered = 'user';
        if (!plan && !user) {
          const r = replayTake('dialog', entry.name);
          if (r) { const q = (r.replies || []).slice(); user = () => (q.length ? q.shift() : null); entry.answered = 'replay'; }
        }
        // after a stop, MPMB's code may go on (it can catch the stop): every further dialog is cancelled
        if (!plan && !user && stopped) { entry.answered = 'cancel (stopped)'; return 'cancel'; }
        const stopHere = !plan && !user && stopForUser;
        // Acrobat's rules per element type: a text box loaded with a list ({name: -1, chosen: 1}) becomes a drop-down
        // whose store() gives the chosen name as text; list boxes give their list object back (a fresh copy each time)
        const els = elementTypes(desc);
        const types = {};
        for (const k of Object.keys(els)) types[k] = els[k].type;
        // every input reads back something in Acrobat, even if nothing was loaded: a text box "", a check box false
        const values = {};
        for (const k of Object.keys(els)) {
          const ty = els[k].type;
          if (ty === 'edit_text') values[k] = '';
          else if (ty === 'check_box' || ty === 'radio') values[k] = false;
        }
        const lists = {};   // a drop-down text box's items, for the app to show
        const setValue = (k, v) => {
          if (types[k] === 'edit_text' && v && typeof v === 'object') { let chosen = ''; for (const n of Object.keys(v)) if (Number(v[n]) > 0) chosen = n; values[k] = chosen; lists[k] = copyPlain(v); }
          else values[k] = v;
        };
        // what the dialog's handlers change besides values, for the app: enabled, shown, red text, focus
        const enabled = {}, shown = {}, red = {};
        let focus = null;
        let ended = null;
        const el = new Proxy({}, {
          get(_, p) {
            if (p === 'load') return (o) => { if (o) for (const k of Object.keys(o)) setValue(k, o[k]); };
            if (p === 'store') return () => { const out = {}; for (const k of Object.keys(values)) out[k] = copyPlain(values[k]); return out; };
            if (p === 'insertEntryInList') return (o) => { if (o) for (const k of Object.keys(o)) values[k] = Object.assign(values[k] && typeof values[k] === 'object' ? values[k] : {}, o[k]); };
            if (p === 'removeAllEntriesFromList') return (k) => { values[k] = {}; };
            if (p === 'end') return (r) => { ended = r === undefined ? 'ok' : r; };
            if (p === 'enable') return (o) => { if (o) for (const k of Object.keys(o)) enabled[k] = !!o[k]; };
            if (p === 'visible') return (o) => { if (o) for (const k of Object.keys(o)) shown[k] = !!o[k]; };
            if (p === 'setForeColorRed') return (k) => { red[k] = true; };
            if (p === 'setForeColorBlack') return (k) => { delete red[k]; };
            if (p === 'focus') return (k) => { focus = k; };
            if (typeof p === 'symbol') return undefined;
            return function () { return undefined; };
          },
        });
        // one of the dialog's handlers; an error in it is logged and the dialog stays open
        const handler = (name) => {
          if (typeof d[name] !== 'function') return false;
          try { d[name](el); } catch (e) { logError('dialog:' + entry.name + ':' + name, e); }
          return true;
        };
        try {
          if (typeof d.initialize === 'function') d.initialize(el);
          if (plan && plan.capture) entry.data = dialogData(d);
          // A dialog that only shows text (a read-only, multi-line box, like MPMB's ShowDialog): keep the text for the app
          const text = [];
          for (const k of Object.keys(els)) if (els[k].type === 'edit_text' && els[k].readonly && els[k].multiline && typeof values[k] === 'string' && values[k].trim()) text.push(values[k]);
          if (text.length && !user) entry.text = text.join('\n\n').slice(0, 20000);
          // One round with the user: the dialog as it is now (request), then their reply (step). Acrobat's buttons: OK runs
          // the "ok" handler, then validate (false keeps the dialog open), commit, and ends with "ok"; Cancel ends with
          // "cancel"; Other runs the "other" handler, which ends the dialog itself (without one it ends with "other").
          // Any other element runs its handler after the user changed it.
          // unique across copies of MPMB (replay.js starts fresh copies, each counting from 1)
          const id = dialogIdBase + '-' + (++dialogSeq);
          let first = true;
          const request = () => {
            const r = { kind: 'dialog', id, name: entry.name, title: entry.title, desc: first ? plainDesc(desc) : undefined, values: plainValues(values, types), lists: copyPlain(lists), enabled: Object.assign({}, enabled), shown: Object.assign({}, shown), red: Object.keys(red), focus };
            first = false;
            focus = null;
            return r;
          };
          const step = (reply) => {
            if (!reply) { ended = 'cancel'; return ended; }
            if (reply.set) for (const k of Object.keys(reply.set)) if (types[k]) setValue(k, reply.set[k]);
            if (reply.pick) for (const k of Object.keys(reply.pick)) if (types[k]) pickItem(values[k], reply.pick[k]);
            const b = reply.press;
            if (b === 'ok') {
              handler('ok');
              if (ended !== null) return ended;
              let valid = true;
              if (typeof d.validate === 'function') { try { valid = d.validate(el) !== false; } catch (e) { logError('dialog:' + entry.name + ':validate', e); } }
              if (!valid) return ended;
              if (typeof d.commit === 'function') d.commit(el);
              if (ended === null) ended = 'ok';
            } else if (b === 'cancel') { handler('cancel'); ended = 'cancel'; }
            else if (b === 'other') { if (!handler('other')) ended = 'other'; }
            else if (b && types[b]) handler(b);
            return ended;
          };
          if (stopHere) {
            // the dialog stays usable after the run has stopped: its handlers keep working on this copy of MPMB
            stopped = { kind: 'dialog', name: entry.name, request, step, get ended() { return ended; },
              finish() { entry.result = ended; if (typeof d.destroy === 'function') try { d.destroy(el); } catch (e) { /* the copy is thrown away */ } } };
            entry.answered = 'stopped';
          } else if (user) {
            while (ended === null) step(user(request()));
            entry.result = ended;
          } else {
            const steps = plan ? plan.steps || [] : [];
            for (let i = 0; i < steps.length && ended === null; i++) {
              const s = steps[i];
              if (s.set) for (const k in s.set) setValue(k, s.set[k]);
              if (s.end) { ended = s.end; break; }
              if (s.pick && !pickItem(values[s.pick.id], s.pick.item)) { logError('dialog:' + entry.name, new Error('no item "' + s.pick.item + '" in ' + s.pick.id)); ended = 'cancel'; break; }
              if (s.press && typeof d[s.press] === 'function') d[s.press](el);
            }
            if (ended === null || ended === 'ok') {
              // pressing OK, as in Acrobat: the dialog's "ok" handler first (MPMB's spell dialog stores the picks
              // there, in saveIt, and has no commit), then validate and commit
              if (typeof d.ok === 'function') d.ok(el);
              if (typeof d.validate === 'function') d.validate(el);
              if (typeof d.commit === 'function') d.commit(el);
            }
          }
          if (!stopHere && typeof d.destroy === 'function') d.destroy(el);
        } catch (e) { logError('dialog:' + entry.name, e); }
        if (opts.onDialog) opts.onDialog(entry);
        // outside the try above, so the engine's own error handling doesn't swallow the stop
        if (stopHere) throw STOP;
        return ended === null ? 'ok' : ended;
      },
      response(q, title, dflt) { push(log.dialogs, { name: 'Question', title: String(q || ''), answered: 'cancel', t: Date.now() }); return null; },
      // Menus can't wait for a tap, so the app runs an action twice: first every menu answers "nothing" and the
      // menu is kept (lastMenu), then the action runs again with the user's choice queued (queueMenu)
      popUpMenuEx() {
        const items = menuTree(Array.prototype.slice.call(arguments));
        if (menuAnswers.length) {
          const want = menuAnswers.shift();
          if (want !== null && menuHas(items, want)) return want;
          return null;
        }
        lastMenu = items;
        push(log.menus, { items: items.map((i) => i.name).slice(0, 12), t: Date.now() });
        return null;
      },
      popUpMenu() { return null; },
      setTimeOut(code, ms) { const t = { id: ++timeoutId, code, ms }; timeouts.push(t); return t; },
      clearTimeOut(t) { const i = timeouts.indexOf(t); if (i >= 0) timeouts.splice(i, 1); },
      setInterval(code, ms) { return { id: ++timeoutId, code, ms, interval: true }; },
      clearInterval() {},
      launchURL(url) { push(log.urls, String(url)); if (opts.onURL) opts.onURL(String(url)); },
      openDoc() { unsupported('app.openDoc'); return null; },
      newDoc() { unsupported('app.newDoc'); return null; },
      addToolButton() {}, removeToolButton() {}, addMenuItem() {}, addSubMenu() {}, hideMenuItem() {}, hideToolbarButton() {},
      execMenuItem(m) { unsupported('execMenuItem:' + m); }, listMenuItems() { return []; }, listToolbarButtons() { return []; },
      beep() {}, goBack() {}, goForward() {}, mailMsg() {}, getPath() { return ''; },
      trustedFunction(f) { return f; }, beginPriv() {}, endPriv() {},
      thermometer: { begin() {}, end() {}, value: 0, duration: 100, text: '', cancelled: false },
    };
    function elementTypes(desc) {
      const out = {};
      const stack = [desc];
      while (stack.length) {
        const e = stack.pop();
        if (!e || typeof e !== 'object') continue;
        if (e.item_id) out[e.item_id] = e;
        if (Array.isArray(e.elements)) for (let i = 0; i < e.elements.length; i++) stack.push(e.elements[i]);
      }
      return out;
    }
    function copyPlain(v) {
      if (!v || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.slice();
      const o = {};
      for (const k of Object.keys(v)) o[k] = copyPlain(v[k]);
      return o;
    }
    // A dialog's description for the app: its elements as plain data (no handlers)
    function plainDesc(desc) {
      const keep = ['type', 'item_id', 'name', 'elements', 'align_children', 'alignment', 'font', 'bold', 'italic', 'char_width', 'char_height', 'width', 'height',
        'multiline', 'readonly', 'password', 'PopupEdit', 'SpinEdit', 'group_id', 'ok_name', 'cancel_name', 'other_name', 'wrap_name'];
      const walk = (e) => {
        if (!e || typeof e !== 'object') return null;
        const o = {};
        for (const k of keep) {
          if (e[k] === undefined) continue;
          if (k === 'elements') { o.elements = []; if (Array.isArray(e.elements)) for (let i = 0; i < e.elements.length; i++) { const c = walk(e.elements[i]); if (c) o.elements.push(c); } }
          else if (typeof e[k] !== 'function' && typeof e[k] !== 'object') o[k] = e[k];
        }
        return o;
      };
      return walk(desc);
    }
    function plainValues(values, types) {
      const out = {};
      for (const k of Object.keys(values)) { const v = values[k]; if (v === undefined || typeof v === 'function' || types[k] === 'image') continue; out[k] = copyPlain(v); }
      try { return JSON.parse(JSON.stringify(out)); } catch (e) { return {}; }
    }
    // The dialog object's own data (lists, counts, selections) as JSON, for screens that show the choices themselves
    function dialogData(d) {
      const out = {};
      for (const k of Object.keys(d)) {
        if (k === 'description' || typeof d[k] === 'function') continue;
        try { out[k] = JSON.parse(JSON.stringify(d[k]) || 'null'); } catch (e) { /* skip what can't be copied */ }
      }
      return out;
    }
    // Select one item in a list box's value object ({ item: -1, group: { item: -2 } }): positive = selected
    function pickItem(obj, item) {
      if (!obj || typeof obj !== 'object') return false;
      let found = false;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === 'object') { if (pickItem(v, item)) found = true; } else {
          const n = Math.abs(Number(v)) || 1;
          obj[k] = k === item ? n : -n;
          if (k === item) found = true;
        }
      }
      return found;
    }
    function firstText(desc) {
      try {
        const stack = [desc];
        while (stack.length) {
          const e = stack.shift();
          if (e && (e.type === 'static_text' || e.type === 'cluster') && e.name) return String(e.name).slice(0, 140);
          if (e && Array.isArray(e.elements)) for (let i = 0; i < e.elements.length; i++) stack.push(e.elements[i]);
        }
      } catch (e) { /* ignore */ }
      return '';
    }
    const util = {
      printd, scand, printf,
      printx(fmt, s) { return String(s); },
      // Acrobat opens a file picker here. The app picks the file first and queues its text; an empty queue is "cancel".
      readFileIntoStream() { if (!fileQueue.length) { unsupported('util.readFileIntoStream'); return null; } return fileQueue.shift(); },
      stringFromStream(s) { return s === null || s === undefined ? '' : String(s); },
      streamFromString(s) { return String(s); },
      iconStreamFromIcon() { return null; },
      crackURL(u) { return { cURL: u, cScheme: String(u).split(':')[0] }; },
      xmlToSpans() { return []; }, spansToXML() { return ''; },
    };
    const color = {
      transparent: ['T'], black: ['G', 0], white: ['G', 1], red: ['RGB', 1, 0, 0], green: ['RGB', 0, 1, 0], blue: ['RGB', 0, 0, 1],
      cyan: ['CMYK', 1, 0, 0, 0], magenta: ['CMYK', 0, 1, 0, 0], yellow: ['CMYK', 0, 0, 1, 0], dkGray: ['G', 0.25], gray: ['G', 0.5], ltGray: ['G', 0.75],
      equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }, convert(c) { return c; },
    };

    // Bookmarks: MPMB reads their structure at startup and runs them as menu items
    function bookmark(name, children, code, parent) {
      const b = { name, color: ['RGB', 0, 0, 0], style: 0, open: false, parent: parent || null, doc: g, children: null,
        execute() { if (code) runGlobal(code, 'bookmark:' + name); },
        setAction(c) { code = c; },
        createChild(cName, cExpr, nIndex) { const c = bookmark(cName, [], cExpr, b); if (!b.children) b.children = []; b.children.splice(nIndex === undefined ? b.children.length : nIndex, 0, c); },
        insertChild(oBookmark, nIndex) { if (!b.children) b.children = []; b.children.splice(nIndex === undefined ? b.children.length : nIndex, 0, oBookmark); },
        remove() { if (b.parent && b.parent.children) { const i = b.parent.children.indexOf(b); if (i >= 0) b.parent.children.splice(i, 1); } },
      };
      const kids = (children || []).map((k) => bookmark(k.name, k.children, k.js, b));
      b.children = kids.length ? kids : null;
      return b;
    }
    function runGlobal(code, label) {
      try { return evalGlobal(code + '\n//# sourceURL=' + label.replace(/[^\w.:-]/g, '_'), label); }
      catch (e) { logError(label, e); return undefined; }
    }

    const docScriptsAdded = {};
    const info = Object.assign({}, model.info);
    const docAPI = {
      getField,
      getNthFieldName(n) { let i = 0; for (const k of recs.keys()) { if (i++ === n) return k; } return null; },
      resetForm(names) {
        const list = names === undefined || names === null ? null : [].concat(names).map(String);
        for (const [n, rec] of recs) {
          if (list && !list.some((x) => n === x || n.lastIndexOf(x + '.', 0) === 0)) continue;
          const dv = rec.props.defaultValue !== undefined ? rec.props.defaultValue : rec.def.defaultValue;
          setRaw(rec, dv !== null && dv !== undefined ? dv : (isToggle(rec) ? 'Off' : ''));
          if (rec.props.richValue) delete rec.props.richValue;
        }
        runCalcs(null);
      },
      calculateNow() { const c = docState.calculate; docState.calculate = true; const a = appState.calculate; appState.calculate = true; runCalcs(null); docState.calculate = c; appState.calculate = a; },
      getTemplate(name) { return model.templates.indexOf(name) === -1 ? null : templateObj(name); },
      createTemplate() { unsupported('createTemplate'); return null; },
      spawnPageFromTemplate(cTemplate, nPage, bRename, bOverlay) { spawnTemplate(cTemplate, nPage, bRename, bOverlay); },
      deletePages(o, e) { if (o && typeof o === 'object') deletePages(o.nStart, o.nEnd); else deletePages(o, e); },
      insertPages() { unsupported('insertPages'); }, movePage() { unsupported('movePage'); },
      extractPages() { unsupported('extractPages'); return null; },
      removeField,
      addField() { unsupported('addField'); return null; },
      addScript(n, code) { docScriptsAdded[n] = code; runGlobal(code, 'doc:' + n); },
      removeScript(n) { delete docScriptsAdded[n]; },
      closeDoc() { unsupported('closeDoc'); }, print() { unsupported('print'); }, getPrintParams() { return { constants: { interactionLevel: {}, printContents: {} } }; },
      mailDoc() { unsupported('mailDoc'); }, saveAs() { unsupported('saveAs'); },
      importDataObject() { unsupported('importDataObject'); return false; }, exportDataObject() { unsupported('exportDataObject'); },
      getDataObject() { return null; }, dataObjects: [],
      getOCGs() { return []; }, syncAnnotScan() {}, getAnnots() { return []; }, getAnnot() { return null; },
      getPageBox() { return [0, 842, 595, 0]; }, getPageRotation() { return 0; }, setPageAction() {}, setAction() {},
      gotoNamedDest() {}, scroll() {}, selectPageNthWord() {}, getIcon() { return null; }, addIcon() {}, importIcon() { return 0; }, removeIcon() {},
      icons: [], external: false, path: '/C/Users/player/' + (opts.fileName || 'sheet.pdf'), documentFileName: opts.fileName || 'sheet.pdf',
      filesize: model.stats ? model.stats.bytes : 0, layout: 'SinglePage', zoom: 100, zoomType: 'NoVary', pane: null,
      info, bookmarkRoot: bookmark('Root', model.bookmarks, null, null), templates: model.templates.map(templateObj),
    };
    function templateObj(name) { return { name, hidden: true, spawn(nPage, bRename, bOverlay) { spawnTemplate(name, nPage, bRename, bOverlay); return null; } }; }

    // install globals
    Object.assign(g, docAPI);
    const accessorsOnG = {
      numFields: { get: () => recs.size },
      numPages: { get: () => pages.length },
      pageNum: { get: () => docState.pageNum, set: (v) => { docState.pageNum = v; } },
      calculate: { get: () => docState.calculate, set: (v) => { docState.calculate = v; } },
      delay: { get: () => docState.delay, set: (v) => { docState.delay = v; } },
      dirty: { get: () => docState.dirty, set: (v) => { docState.dirty = v; } },
      disclosed: { get: () => docState.disclosed, set: (v) => { docState.disclosed = v; } },
    };
    for (const k in accessorsOnG) Object.defineProperty(g, k, Object.assign({ configurable: true, enumerable: true }, accessorsOnG[k]));
    Object.assign(g, {
      app, util, color, event: { name: 'Open', type: 'Doc', target: g, targetName: '', rc: true, value: '', change: '', willCommit: false },
      display: { visible: 0, hidden: 1, noPrint: 2, noView: 3 },
      border: { s: 'solid', b: 'beveled', d: 'dashed', i: 'inset', u: 'underline' },
      style: { ch: 'check', cr: 'cross', di: 'diamond', ci: 'circle', st: 'star', sq: 'square' },
      font: { Times: 'Times-Roman', TimesB: 'Times-Bold', TimesI: 'Times-Italic', TimesBI: 'Times-BoldItalic', Helv: 'Helvetica', HelvB: 'Helvetica-Bold', HelvI: 'Helvetica-Oblique', HelvBI: 'Helvetica-BoldOblique', Cour: 'Courier', CourB: 'Courier-Bold', CourI: 'Courier-Oblique', CourBI: 'Courier-BoldOblique', Symbol: 'Symbol', ZapfD: 'ZapfDingbats' },
      highlight: { n: 'none', i: 'invert', p: 'push', o: 'outline' },
      position: { textOnly: 0, iconOnly: 1, iconTextV: 2, textIconV: 3, iconTextH: 4, textIconH: 5, overlay: 6 },
      scaleWhen: { always: 0, never: 1, tooBig: 2, tooSmall: 3 }, scaleHow: { proportional: 0, anamorphic: 1 },
      zoomtype: { none: 'NoVary', fitP: 'FitPage', fitW: 'FitWidth', fitH: 'FitHeight', fitV: 'FitVisibleWidth', pref: 'Preferred', refW: 'ReflowWidth' },
      cursor: { visible: 0, hidden: 1, delay: 2 },
      global: { setPersistent() {}, subscribe() {} },
      identity: { name: '', loginName: '', email: '', corporation: '' },
    });
    const cons = g.console || {};
    cons.println = (s) => push(log.console, String(s)); cons.show = () => {}; cons.hide = () => {}; cons.clear = () => {};
    g.console = cons;

    // Acrobat's built-in form helpers (AForm.js), the subset MPMB uses
    function fmtNumber(v, nDec, sepStyle, negStyle, currStyle, strCurrency, bPrepend) {
      if (v === '' || v === null || v === undefined) return '';
      let n = Number(String(v).replace(sepStyle >= 2 ? /\./g : /,/g, '').replace(',', '.'));
      if (isNaN(n)) return String(v);
      const neg = n < 0; n = Math.abs(n);
      let s = n.toFixed(nDec || 0);
      let [ip, fp] = s.split('.');
      const th = sepStyle === 0 ? ',' : sepStyle === 2 ? '.' : sepStyle === 4 ? "'" : '';
      if (th) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, th);
      s = fp !== undefined ? ip + (sepStyle >= 2 && sepStyle !== 4 ? ',' : '.') + fp : ip;
      if (strCurrency) s = bPrepend ? strCurrency + s : s + strCurrency;
      if (neg) s = negStyle === 2 || negStyle === 3 ? '(' + s + ')' : '-' + s;
      return s;
    }
    Object.assign(g, {
      AFNumber_Format(nDec, sepStyle, negStyle, currStyle, strCurrency, bPrepend) { const e = g.event; e.value = fmtNumber(e.value, nDec, sepStyle, negStyle, currStyle, strCurrency, bPrepend); },
      AFNumber_Keystroke(nDec, sepStyle) {
        const e = g.event;
        if (e.willCommit) { const s = String(e.value).trim(); if (s !== '' && isNaN(Number(s.replace(sepStyle >= 2 ? /\./g : /,/g, '').replace(',', '.')))) { g.app.alert('The value entered does not match the format of the field [ ' + e.targetName + ' ]'); e.rc = false; } }
        else if (e.change && /[^\d.,\-+]/.test(e.change)) e.rc = false;
      },
      AFPercent_Format(nDec) { const e = g.event; if (e.value !== '' && !isNaN(Number(e.value))) e.value = (Number(e.value) * 100).toFixed(nDec) + '%'; },
      AFPercent_Keystroke() {},
      AFRange_Validate(bGreater, nGreater, bLess, nLess) {
        const e = g.event; if (e.value === '') return; const v = Number(e.value);
        if ((bGreater && v < nGreater) || (bLess && v > nLess)) { e.rc = false; g.app.alert('Invalid value: must be ' + (bGreater ? 'at least ' + nGreater : '') + (bGreater && bLess ? ' and ' : '') + (bLess ? 'at most ' + nLess : '') + '.'); }
      },
      AFDate_FormatEx(f) { const e = g.event; const d = scand(f, e.value) || (e.value ? new Date(e.value) : null); if (d && !isNaN(d)) e.value = printd(f, d); },
      AFDate_Format(i) { g.AFDate_FormatEx(['m/d', 'm/d/yy', 'mm/dd/yy', 'mm/yy', 'd-mmm', 'd-mmm-yy', 'dd-mmm-yy', 'yy-mm-dd', 'mmm-yy', 'mmmm-yy', 'mmm d, yyyy', 'mmmm d, yyyy', 'm/d/yy h:MM tt', 'm/d/yy HH:MM'][i] || 'mm/dd/yyyy'); },
      AFDate_KeystrokeEx() {}, AFDate_Keystroke() {}, AFTime_Format() {}, AFTime_Keystroke() {}, AFTime_FormatEx() {},
      AFSpecial_Format() {}, AFSpecial_Keystroke() {}, AFSpecial_KeystrokeEx() {},
      AFSimple_Calculate(op, fields) {
        const e = g.event; const list = Array.isArray(fields) ? fields : String(fields).split(/\s*,\s*/); const vals = [];
        for (let i = 0; i < list.length; i++) { const f = getField(list[i]); if (!f) continue; const arr = f.getArray ? f.getArray() : [f]; for (let j = 0; j < arr.length; j++) vals.push(Number(arr[j].value) || 0); }
        if (!vals.length) { e.value = 0; return; }
        e.value = op === 'SUM' ? vals.reduce((a, b) => a + b, 0) : op === 'PRD' ? vals.reduce((a, b) => a * b, 1) : op === 'AVG' ? vals.reduce((a, b) => a + b, 0) / vals.length : op === 'MIN' ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
      },
      AFMergeChange(e) { return String(e.value).slice(0, e.selStart) + e.change + String(e.value).slice(e.selEnd); },
    });

    // SpiderMonkey's non-standard toSource(), which MPMB uses to store its state in fields
    evalGlobal('(' + function () {
      function src(v, inner, seen) {
        if (v === null) return 'null';
        if (v === undefined) return '(void 0)';
        var t = typeof v;
        if (t === 'string') return inner ? JSON.stringify(v) : '(new String(' + JSON.stringify(v) + '))';
        if (t === 'number') return inner ? (Object.is(v, -0) ? '-0' : String(v)) : '(new Number(' + v + '))';
        if (t === 'boolean') return inner ? String(v) : '(new Boolean(' + v + '))';
        if (t === 'function') return v.toString();
        if (v instanceof RegExp) return v.toString();
        if (v instanceof Date) return '(new Date(' + v.getTime() + '))';
        if (v instanceof String || v instanceof Number || v instanceof Boolean) return src(v.valueOf(), inner, seen);
        if (seen.indexOf(v) !== -1) return '{}';
        seen.push(v);
        var out;
        if (Array.isArray(v)) { var parts = []; for (var i = 0; i < v.length; i++) parts.push(i in v ? src(v[i], true, seen) : ''); out = '[' + parts.join(', ') + ']'; }
        else {
          var ps = []; var keys = Object.keys(v);
          for (var j = 0; j < keys.length; j++) ps.push((/^[A-Za-z_$][\w$]*$/.test(keys[j]) ? keys[j] : JSON.stringify(keys[j])) + ':' + src(v[keys[j]], true, seen));
          out = inner ? '{' + ps.join(', ') + '}' : '({' + ps.join(', ') + '})';
        }
        seen.pop();
        return out;
      }
      var def = function (proto, fn) { Object.defineProperty(proto, 'toSource', { value: fn, writable: true, configurable: true, enumerable: false }); };
      def(Object.prototype, function () { return src(this, false, []); });
      def(Array.prototype, function () { return src(this, true, []); });
      def(Function.prototype, function () { return this.toString(); });
      def(String.prototype, function () { return src(String(this), false, []); });
      def(Number.prototype, function () { return src(Number(this), false, []); });
      def(Boolean.prototype, function () { return src(this.valueOf(), false, []); });
      def(RegExp.prototype, function () { return this.toString(); });
      def(Date.prototype, function () { return '(new Date(' + this.getTime() + '))'; });
      if (typeof uneval === 'undefined') this.uneval = function (v) { return v === null ? 'null' : v === undefined ? '(void 0)' : src(v, true, []); };
    }.toString() + ')()', 'mpmb:toSource');

    // localeCompare as MPMB expects from Acrobat: a leading space sorts first and a leading no-break space last (MPMB
    // prefixes menu names this way, e.g. " Simple Melee Weapon" first and "\xA0Mastery Text Only" last in Weapon
    // Mastery). The browser's collation ignores both, which put Mastery Text Only first.
    evalGlobal('(' + function () {
      var base = String.prototype.localeCompare;
      var lead = function (s) { var c = s.charAt(0); return c === ' ' ? 0 : c === '\xA0' ? 2 : 1; };
      Object.defineProperty(String.prototype, 'localeCompare', { writable: true, configurable: true, enumerable: false, value: function (that) {
        var a = String(this), b = String(that), d = lead(a) - lead(b);
        return d ? (d < 0 ? -1 : 1) : base.apply(a, arguments);
      } });
    }.toString() + ')()', 'mpmb:localeCompare');

    // ---- running ---------------------------------------------------------------------------------
    const stats = { startupMs: 0, calcPasses: 0, spawns: [], docScriptMs: {} };
    function flushTimeouts() {
      for (let round = 0; round < 20 && timeouts.length; round++) {
        const batch = timeouts.splice(0, timeouts.length);
        for (let i = 0; i < batch.length; i++) {
          const t = batch[i];
          if (typeof t.code === 'function') { try { t.code(); } catch (e) { logError('timeout', e); } }
          else runGlobal(String(t.code), 'timeout');
        }
      }
    }
    function finishAction() {
      flushTimeouts();
    }

    function start() {
      const t0 = now();
      for (let i = 0; i < model.docScripts.length; i++) {
        const s = model.docScripts[i];
        // the script the app's writer adds for Acrobat (redraw MPMB's formatted fields): nothing to redraw here
        if (s.name === 'zzMPMBSheetApp') continue;
        const t = now();
        try { evalGlobal(s.code + '\n//# sourceURL=mpmb:' + s.name, 'mpmb:' + s.name); }
        catch (e) { logError('doc:' + s.name, e); }
        stats.docScriptMs[s.name] = Math.round(now() - t);
      }
      // document scripts a saved state brings along (added with doc.addScript)
      for (const n of Object.keys(docScriptsAdded)) runGlobal(docScriptsAdded[n], 'doc:' + n);
      finishAction();
      runCalcs(null);
      stats.startupMs = Math.round(now() - t0);
      return stats.startupMs;
    }

    // A user entering a field, typing a value and leaving it (or picking from a list):
    // On Focus → Keystroke(commit) → Validate → store → Calculate → On Blur
    // index: the item picked from a combo box's list, where items share an export value (Size: Medium and Small are
    // both "1"); Acrobat keeps the picked item (/I) as it does after currentValueIndices
    function commit(name, value, index) {
      const rec = recs.get(name);
      if (!rec) return { ok: false, reason: 'no such field' };
      const fld = fieldObj(rec);
      const w = rec.widgets[0];
      if (w && w.scripts.Fo) runScript(w.scripts.Fo, mkEvent('Focus', fld, { value: typedValue(rec) }), 'field:' + name + ':focus');
      const r = commitValue(rec, fld, name, value);
      if (index !== undefined && index !== null) {
        const it = itemsOf(rec), k = Number(index);
        const first = it[k] ? it.findIndex((x) => x[1] === it[k][1]) : -1;
        if (first !== -1 && first !== k && rec.value === it[k][1]) { rec.props.valueIndex = k; markDirty(rec); }
      }
      if (w && w.scripts.Bl) runScript(w.scripts.Bl, mkEvent('Blur', fld, { value: typedValue(rec) }), 'field:' + name + ':blur');
      finishAction();
      return r;
    }
    function commitValue(rec, fld, name, value) {
      delete rec.props.valueIndex;
      if (rec.scripts.K) {
        const ev = mkEvent('Keystroke', fld, { value, change: '', changeEx: value, willCommit: true, commitKey: 2 });
        runScript(rec.scripts.K, ev, 'field:' + name + ':keystroke');
        if (ev.rc === false) { finishAction(); return { ok: false, reason: 'rejected' }; }
        value = ev.value;
      }
      if (rec.scripts.V) {
        const ev = mkEvent('Validate', fld, { value });
        runScript(rec.scripts.V, ev, 'field:' + name + ':validate');
        if (ev.rc === false) { finishAction(); dirty.add(name); return { ok: false, reason: 'rejected' }; }
        value = ev.value;
      }
      setRaw(rec, value);
      dirty.add(name);
      runCalcs(rec);
      finishAction();
      return { ok: true };
    }
    // A click on a check box or radio button
    function toggle(name, widgetIndex) {
      const rec = recs.get(name);
      if (!rec) return { ok: false };
      const i = widgetIndex || 0;
      const ex = exportsOf(rec)[i] || 'Yes';
      const fld = widgetObj(rec, i);
      const w = rec.widgets[i];
      if (w && w.scripts.D) runScript(w.scripts.D, mkEvent('Mouse Down', fld), 'field:' + name + ':mousedown');
      const next = rec.value === ex ? ((rec.def.ff & FF.noToggleToOff) ? ex : 'Off') : ex;
      setRaw(rec, next);
      dirty.add(name);
      if (w && w.scripts.A) runScript(w.scripts.A, mkEvent('Mouse Up', fld, { value: next }), 'field:' + name + ':mouseup');
      runCalcs(rec);
      finishAction();
      return { ok: true };
    }
    // A tap on a push button; mods: { modifier, shift } for a Ctrl/Shift-click (MPMB opens some menus that way)
    function press(name, widgetIndex, mods) {
      const rec = recs.get(name);
      if (!rec) return { ok: false };
      const i = widgetIndex || 0, w = rec.widgets[i], fld = widgetObj(rec, i);
      const extra = { modifier: !!(mods && mods.modifier), shift: !!(mods && mods.shift) };
      if (w && w.scripts.D) runScript(w.scripts.D, mkEvent('Mouse Down', fld, extra), 'field:' + name + ':mousedown');
      if (w && w.scripts.A) runScript(w.scripts.A, mkEvent('Mouse Up', fld, extra), 'field:' + name + ':mouseup');
      finishAction();
      return { ok: true };
    }

    // What the app shows for a field: its formatted text (MPMB's own Format scripts) and its state
    function formatted(rec) {
      const f = rec.scripts.F;
      const raw = Array.isArray(rec.value) ? rec.value.join(', ') : rec.value;
      if (!f) return { text: raw, spans: rec.props.richValue || null };
      const fld = fieldObj(rec);
      const rich = fld.richText;
      const ev = mkEvent('Format', fld, { value: typedValue(rec), richValue: rich ? fld.richValue : undefined });
      const savedDirty = docState.dirty;
      if (!runScript(f, ev, 'field:' + rec.name + ':format') || ev.rc === false) { docState.dirty = savedDirty; return { text: raw, spans: null }; }
      docState.dirty = savedDirty;
      const spans = rich && Array.isArray(ev.richValue) ? ev.richValue.map((s) => ({ text: String(s.text === undefined ? '' : s.text), fontWeight: s.fontWeight, fontStyle: s.fontStyle, textColor: s.textColor, superscript: s.superscript, subscript: s.subscript, strikethrough: s.strikethrough, underline: s.underline, textSize: s.textSize })) : null;
      return { text: ev.value === undefined || ev.value === null ? '' : String(ev.value), spans };
    }
    function snapshot(name) {
      const rec = recs.get(name);
      if (!rec) return { name, exists: false };
      const k = kind(rec);
      const w = rec.widgets[0];
      const disp = w ? displayOf(w) : 0;
      const out = {
        name, exists: true, kind: k, value: Array.isArray(rec.value) ? rec.value.slice() : rec.value,
        hidden: disp === DISPLAY.hidden || disp === DISPLAY.noView,
        readonly: rec.props.readonly !== undefined ? !!rec.props.readonly : !!(rec.def.ff & FF.readonly),
        tooltip: rec.props.userName !== undefined ? String(rec.props.userName) : (rec.def.tu || ''),
      };
      if (k === 'checkbox' || k === 'radiobutton') out.checked = rec.value !== 'Off' && rec.value !== '';
      if (k === 'combobox' || k === 'listbox') { out.items = itemsOf(rec).map((it) => [it[0], it[1]]); out.editable = rec.props.editable !== undefined ? !!rec.props.editable : !!(rec.def.ff & FF.edit); }
      if (k === 'combobox') out.index = fieldObj(rec).currentValueIndices;
      if (k === 'button') { out.caption = fieldObj(rec).buttonGetCaption(); out.icon = iconKey(rec); }
      if (k === 'text' || k === 'combobox') { const f = formatted(rec); out.display = f.text; if (f.spans) out.spans = f.spans; out.multiline = !!(rec.def.ff & FF.multiline); }
      return out;
    }
    // Which picture a button shows: its own from the PDF ("own:<name>"), one copied from another button
    // ("fld:<name>", MPMB keeps its pictures in hidden SaveIMG buttons), or one the user picked ("img:<id>")
    function iconKey(rec) {
      const ic = rec.widgets[0] && rec.widgets[0].props.icon;
      if (!ic) return 'own:' + rec.name;
      return ic.img ? 'img:' + ic.img.id : 'fld:' + ic.name;
    }
    // what the app needs to draw a button's picture: the picked image, or the button in the PDF whose icon it shows
    // (rect: the button's size, for the picture's proportions)
    function iconInfo(name) {
      const rec = recs.get(name);
      if (!rec || !rec.widgets[0]) return null;
      const w = rec.widgets[0], ic = w.props.icon, r = w.rect || [0, 0, 100, 100];
      const size = [Math.abs(r[2] - r[0]), Math.abs(r[3] - r[1])];
      if (ic && ic.img) return { img: ic.img, size };
      return { field: ic ? ic.name : rec.name, size };
    }
    // What text fields and combo boxes show, as their Format scripts make it (text, and spans for rich text), for the
    // writer to draw into the PDF; a combo box shows the picked item's name
    function appearanceData(names) {
      const out = {};
      for (let i = 0; i < names.length; i++) {
        const rec = recs.get(names[i]);
        if (!rec) continue;
        const k = kind(rec);
        if (k !== 'text' && k !== 'combobox') continue;
        const f = formatted(rec);
        let text = f.text;
        if (k === 'combobox' && !rec.scripts.F) { const it = itemsOf(rec), x = fieldObj(rec).currentValueIndices; if (typeof x === 'number' && it[x]) text = it[x][0]; }
        out[names[i]] = { text: text === undefined || text === null ? '' : String(text), spans: f.spans || null };
      }
      return out;
    }
    function drainChanges() { const out = Array.from(dirty); dirty.clear(); return out; }
    function evalExpr(code) { return runGlobal(code, 'expr'); }
    // Field values as if they had been saved in the PDF; call before start()
    function preset(values) {
      for (const n in values) { const rec = recs.get(n); if (rec) rec.value = normalize(rec, values[n]); }
    }
    // ---- saving: the state a saved PDF would hold, as differences from the PDF as distributed -----------------------
    // Field values, what scripts changed about fields (props: hidden, tooltips, submitName…; list items; scripts
    // attached with setAction; widget looks), the calculation order, the document info and the page changes.
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const plain = (o) => JSON.parse(JSON.stringify(o === undefined ? null : o));
    function exportState() {
      const fields = {};
      for (const [n, rec] of recs) {
        const f = {};
        if (!same(rec.value, rec.init)) f.v = plain(rec.value);
        if (Object.keys(rec.props).length) f.p = plain(rec.props);
        if (rec.items) f.i = plain(rec.items);
        if (!same(rec.scripts, rec.initScripts)) f.s = plain(rec.scripts);
        const ws = rec.widgets.map((w) => {
          const o = {};
          if (Object.keys(w.props).length) o.p = plain(w.props);
          if (!same(w.scripts, w.initScripts)) o.s = plain(w.scripts);
          return o;
        });
        if (ws.some((o) => Object.keys(o).length)) f.w = ws;
        // widget positions only change when scripts move fields; keep them when they do
        const rects = rec.widgets.map((w) => w.rect);
        if (rec.def.widgets.some((dw, i) => rec.widgets[i] && !same(dw.rect, rects[i]))) f.r = plain(rects);
        if (Object.keys(f).length) fields[n] = f;
      }
      return { v: 1, sheet: { title: model.info.Title || '', version: model.info.SheetVersion || '' }, pageOps: plain(pageOps), calcOrder: calcOrder.slice(), info: plain(info), docScripts: plain(docScriptsAdded), fields, date: Date.now() };
    }
    // Put a saved state back before start(), so MPMB's startup finds the sheet as Acrobat would find a saved PDF
    function importState(st) {
      if (!st || st.v !== 1) return false;
      for (const op of st.pageOps || []) {
        if (op[0] === 'spawn') spawnTemplate(op[1], op[2] === null ? undefined : op[2], op[3] === null ? undefined : op[3], op[4]);
        else if (op[0] === 'delete') deletePages(op[1], op[2]);
        else if (op[0] === 'remove') removeField(op[1]);
      }
      for (const n of Object.keys(st.fields || {})) {
        const rec = recs.get(n), f = st.fields[n];
        if (!rec) continue;
        if (f.v !== undefined) rec.value = Array.isArray(f.v) ? f.v.map(String) : String(f.v);
        if (f.p) rec.props = f.p;
        if (f.i) rec.items = f.i;
        if (f.s) rec.scripts = f.s;
        if (f.w) for (let i = 0; i < f.w.length && i < rec.widgets.length; i++) { if (f.w[i].p) rec.widgets[i].props = f.w[i].p; if (f.w[i].s) rec.widgets[i].scripts = f.w[i].s; }
        if (f.r) for (let i = 0; i < f.r.length && i < rec.widgets.length; i++) rec.widgets[i].rect = f.r[i];
      }
      if (Array.isArray(st.calcOrder)) calcOrder = st.calcOrder.filter((n) => recs.has(n));
      if (st.info) Object.assign(info, st.info);
      if (st.docScripts) Object.assign(docScriptsAdded, st.docScripts);
      groupCache.clear();
      dirty.clear();
      return true;
    }
    // Run MPMB code the way a menu item or button would (pending timeouts run afterwards)
    function action(code, label) { const r = runGlobal(code, label || 'action'); finishAction(); return r; }

    return {
      start, commit, toggle, press, snapshot, drainChanges, evalExpr, getField, preset, action, exportState, importState,
      queueFile(text) { fileQueue.push(String(text)); },
      queueIcon(icon) { iconQueue.push({ __icon: true, img: icon }); },
      takeIconWanted() { const n = iconWanted; iconWanted = null; return n; },
      iconInfo, appearanceData,
      queueDialog(answer) { dialogAnswers.push(answer); },
      setStandingAnswer(name, answer) { if (answer) standingAnswers[name] = Object.assign({ name }, answer); else delete standingAnswers[name]; },
      queueMenu(ret) { menuAnswers.push(ret === undefined ? null : ret); },
      takeMenu() { const m = lastMenu; lastMenu = null; return m; },
      // yes/no questions: queueAnswer(true|false), askQuestions(on), takeQuestion() → { title, msg } or null
      queueAnswer(yes) { alertAnswers.push(yes ? 4 : 3); },
      askQuestions(on) { askQuestions = !!on; },
      takeQuestion() { const q = lastQuestion; lastQuestion = null; return q; },
      // a user at the screen: fn(request) → reply, synchronous (see execDialog); null turns it off
      interactive(fn) { interact = typeof fn === 'function' ? fn : null; },
      // stopping for the user (see STOP): on/off; what the run stopped at (and clears it); the answers for a replay
      stopForUser(on) { stopForUser = !!on; if (on) stopped = null; },
      takeStopped() { const s = stopped; stopped = null; return s; },
      setReplay(list) { replayQueue = (list || []).slice(); },
      clearQueues() { iconQueue.length = 0; iconWanted = null; fileQueue.length = 0; dialogAnswers.length = 0; menuAnswers.length = 0; lastMenu = null; alertAnswers.length = 0; lastQuestion = null; },
      runBookmark(path) {
        let node = { children: g.bookmarkRoot.children };
        for (let i = 0; i < path.length; i++) { const kids = node.children || []; let next = null; for (let j = 0; j < kids.length; j++) if (kids[j].name === path[i]) { next = kids[j]; break; } if (!next) return false; node = next; }
        node.execute(); finishAction(); return true;
      },
      fieldNames() { return Array.from(recs.keys()); },
      get log() { return log; }, get logSeq() { return logSeq; }, get stats() { return stats; }, get pageCount() { return pages.length; },
    };
  }

  const api = { createEngine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MPMBEngine = api;
})(typeof self !== 'undefined' ? self : this);
