/*
 * HSSH FCalc: user interface.
 * All math lives in calc.js (window.FCalc); this file only reads inputs,
 * paints results and remembers the sheet between visits.
 */
(function () {
  'use strict';

  const F = window.FCalc;
  const STATE_KEY = 'hssh-fcalc:v1:state';
  const LIBRARY_KEY = 'hssh-fcalc:v1:library';
  const DRAFTS_KEY = 'hssh-fcalc:v1:drafts';
  const PREVIEW = Boolean(window.FCALC_PREVIEW); // hosted preview: no print, downloads or install
  const FIELDS = ['desc', 'length', 'width', 'height', 'weight', 'units'];
  const MEASURE_FIELDS = ['length', 'width', 'height', 'weight'];
  const FIELD_NAMES = { length: 'length', width: 'width', height: 'height', weight: 'weight', units: 'units' };

  const EXAMPLE_ROWS = [
    { desc: 'Carton A (example)', length: '12 3/8', width: '8 3/8', height: '4 5/8', weight: '2.3', units: '9' },
    { desc: 'Carton B (example)', length: '9.375', width: '6.375', height: '7.625', weight: '1.7', units: '6' }
  ];

  const $ = (id) => document.getElementById(id);

  let seq = 0;
  const uid = () => 'r' + Date.now().toString(36) + (seq++).toString(36);

  const blankRow = () => ({ id: uid(), desc: '', length: '', width: '', height: '', weight: '', units: '' });

  // ------------------------------------------------------------- storage --

  /** Parsed value, undefined when nothing is stored, null when unreadable or blocked. */
  function load(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /** Returns false when the browser refuses to store (private windows, blocked site data). */
  function store(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  const STORAGE_BLOCKED = ' This browser is blocking saved data, so it will be gone when you close the page.';

  // Stored data is untrusted: only plain strings and numbers become text.
  const asText = (v) => (typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : '');
  const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const asUnit = (v) => (v === 'metric' ? 'metric' : 'us');

  function defaultState() {
    return {
      unit: 'us',
      weightMode: 'unit',
      rounding: 'exact',
      scale: F.DEFAULT_SCALE,
      example: true,
      draftName: '',
      rows: EXAMPLE_ROWS.map((r) => Object.assign({ id: uid() }, r))
    };
  }

  /** What a line held before a unit switch, if the stored copy is well formed. */
  function restoreBeforeSwitch(b) {
    if (!isObject(b) || (b.unit !== 'us' && b.unit !== 'metric') || !isObject(b.values) || !isObject(b.produced)) return null;
    const values = {};
    const produced = {};
    for (const f of MEASURE_FIELDS) {
      if (typeof b.values[f] !== 'string' || typeof b.produced[f] !== 'string') return null;
      values[f] = b.values[f];
      produced[f] = b.produced[f];
    }
    return { unit: b.unit, values: values, produced: produced };
  }

  function restoreState(saved) {
    if (!isObject(saved) || !Array.isArray(saved.rows)) return defaultState();
    const unit = asUnit(saved.unit);
    const rows = saved.rows.filter(isObject).map((r) => {
      const row = { id: uid() };
      FIELDS.forEach((f) => { row[f] = asText(r[f]); });
      const back = restoreBeforeSwitch(r.beforeSwitch);
      if (back && back.unit !== unit) row.beforeSwitch = back;
      return row;
    });
    return {
      unit: unit,
      weightMode: saved.weightMode === 'total' ? 'total' : 'unit',
      rounding: ['exact', 'nearest', 'up'].includes(saved.rounding) ? saved.rounding : 'exact',
      scale: typeof saved.scale === 'string' && Object.prototype.hasOwnProperty.call(F.SCALES, saved.scale)
        ? saved.scale : F.DEFAULT_SCALE,
      example: saved.example === true,
      draftName: asText(saved.draftName).slice(0, 60),
      rows: rows.length ? rows : [blankRow()]
    };
  }

  function restoreLibrary(saved) {
    if (!Array.isArray(saved)) return [];
    return saved
      .filter(isObject)
      .map((it) => ({
        id: asText(it.id) || uid(),
        name: asText(it.name).slice(0, 80),
        unit: asUnit(it.unit),
        length: asText(it.length),
        width: asText(it.width),
        height: asText(it.height),
        weight: asText(it.weight),
        savedAt: typeof it.savedAt === 'number' && isFinite(it.savedAt) ? it.savedAt : 0
      }))
      .filter((it) => it.name);
  }

  function restoreDrafts(saved) {
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((d) => isObject(d) && Array.isArray(d.rows))
      .map((d) => ({
        id: asText(d.id) || uid(),
        name: asText(d.name).slice(0, 60),
        unit: asUnit(d.unit),
        savedAt: typeof d.savedAt === 'number' && isFinite(d.savedAt) ? d.savedAt : 0,
        rows: d.rows.filter(isObject).map((r) => {
          const row = {};
          F.DRAFT_FIELDS.forEach((f) => { row[f] = asText(r[f]); });
          if (r.unit === 'us' || r.unit === 'metric') row.unit = r.unit;
          return row;
        })
      }))
      .filter((d) => d.name);
  }

  /** Never let bad stored data stop the calculator from starting. */
  function safely(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  let state = safely(() => restoreState(load(STATE_KEY)), null) || defaultState();
  let library = safely(() => restoreLibrary(load(LIBRARY_KEY)), []);
  let drafts = safely(() => restoreDrafts(load(DRAFTS_KEY)), []);
  let lastResult = null;

  // Another window may have changed the lists since this page loaded. Re-read
  // them before every change so one window never overwrites the other's work.
  // Changes this window could not write (blocked or full storage) are kept as
  // pending and replayed over every fresh read until a write succeeds, so
  // neither this window's unsaved work nor other windows' saves get lost.
  const pending = { library: [], drafts: [] };

  /**
   * Replay pending changes over a fresh read. A change is skipped when the
   * stored copy of that entry was saved later (by another window), so an old
   * unsaved change never overwrites newer work.
   */
  function applyPending(list, ops) {
    return ops.reduce((acc, op) => {
      const same = (x) => x.id === op.id ||
        Boolean(op.entry && x.name.toLowerCase() === op.entry.name.toLowerCase());
      if (acc.some((x) => same(x) && (x.savedAt || 0) > op.at)) return acc;
      const rest = acc.filter((x) => !same(x));
      return op.entry ? rest.concat(op.entry) : rest;
    }, list);
  }

  /** Record one change ({ id, entry } to upsert, { id } to delete) and write the list. */
  function commitLibrary(op) {
    pending.library.push(Object.assign({ at: Date.now() }, op));
    const kept = store(LIBRARY_KEY, library);
    if (kept) pending.library = [];
    return kept;
  }

  function commitDrafts(op) {
    pending.drafts.push(Object.assign({ at: Date.now() }, op));
    const kept = store(DRAFTS_KEY, drafts);
    if (kept) pending.drafts = [];
    return kept;
  }

  /** Once storage works again, write pending changes without waiting for this window's next edit. */
  function flushPending() {
    if (pending.library.length && store(LIBRARY_KEY, library)) pending.library = [];
    if (pending.drafts.length && store(DRAFTS_KEY, drafts)) pending.drafts = [];
  }

  function refreshLibrary() {
    const saved = load(LIBRARY_KEY);
    if (saved === null) return;
    library = applyPending(safely(() => restoreLibrary(saved || []), library), pending.library);
  }

  function refreshDrafts() {
    const saved = load(DRAFTS_KEY);
    if (saved === null) return;
    drafts = applyPending(safely(() => restoreDrafts(saved || []), drafts), pending.drafts);
  }

  const persist = () => {
    store(STATE_KEY, {
      unit: state.unit,
      weightMode: state.weightMode,
      rounding: state.rounding,
      scale: state.scale,
      example: state.example,
      draftName: state.draftName,
      rows: state.rows.map((r) => {
        const o = {};
        FIELDS.forEach((f) => { o[f] = r[f]; });
        if (r.beforeSwitch) o.beforeSwitch = r.beforeSwitch;
        return o;
      })
    });
  };

  // ---------------------------------------------------------- formatting --

  const fmt = F.fmt;
  const fmtFixed = F.fmtFixed;

  /** Values for display in the current unit system. */
  function inUnits(q) {
    return state.unit === 'metric'
      ? { cube: q.cubeM3, weight: q.weightKg, density: q.kgm3 }
      : { cube: q.cubeFt3, weight: q.weightLb, density: q.pcf };
  }

  const pcfToDisplay = (pcf) => (state.unit === 'metric' ? pcf * F.KGM3_PER_PCF : pcf);
  const densityPlaces = () => (state.unit === 'metric' ? 1 : 2);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'className') node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach((c) => node.append(c));
    return node;
  }

  const ICONS = {
    duplicate: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/></svg>',
    save: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3h10v14l-5-3.5L5 17z"/></svg>',
    remove: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>'
  };

  function iconButton(action, label, extraClass) {
    const b = el('button', {
      type: 'button',
      className: 'icon-btn' + (extraClass ? ' ' + extraClass : ''),
      'data-action': action,
      title: label,
      'aria-label': label
    });
    b.innerHTML = ICONS[action];
    return b;
  }

  // --------------------------------------------------------------- lines --

  const linesEl = $('lines');

  function buildLine(row, index) {
    const L = F.labels(state.unit);
    const n = index + 1;
    const li = el('li', { className: 'line', 'data-id': row.id });
    li.append(el('span', { className: 'line-no', text: String(n), 'aria-hidden': 'true' }));

    const spec = [
      ['desc', 'Description', '', 'text', 'Description (optional)'],
      ['length', 'Length', L.len, 'decimal', 'L'],
      ['width', 'Width', L.len, 'decimal', 'W'],
      ['height', 'Height', L.len, 'decimal', 'H'],
      ['weight', 'Weight', L.wt, 'decimal', 'Wt'],
      ['units', 'Units', '', 'numeric', '1']
    ];

    spec.forEach(([field, label, unit, mode, placeholder]) => {
      const id = field + '-' + row.id;
      const cell = el('div', { className: 'cell cell-' + field });
      const lab = el('label', { className: 'cell-label', for: id, text: label + ' ' });
      if (unit) lab.append(el('em', { text: unit }));
      const input = el('input', {
        id: id,
        type: 'text',
        inputmode: mode,
        autocomplete: 'off',
        spellcheck: 'false',
        'data-field': field,
        placeholder: placeholder,
        'aria-label': label + (unit ? ' (' + unit + ')' : '') + ', item ' + n
      });
      if (field === 'desc') input.maxLength = 80;
      input.value = row[field];
      cell.append(lab, input);
      li.append(cell);
    });

    const tools = el('div', { className: 'line-tools' });
    tools.append(
      iconButton('duplicate', 'Duplicate item ' + n),
      iconButton('save', 'Save item ' + n + ' for reuse'),
      iconButton('remove', 'Remove item ' + n, 'remove')
    );
    li.append(tools);
    li.append(el('p', { className: 'line-result', 'aria-live': 'polite' }));
    return li;
  }

  function renderLines() {
    linesEl.replaceChildren(...state.rows.map(buildLine));
    update();
  }

  function paintLine(li, line) {
    const out = li.querySelector('.line-result');
    const L = F.labels(state.unit);
    out.classList.remove('is-error');
    out.replaceChildren();

    li.querySelectorAll('input[data-field]').forEach((input) => {
      const err = line.errors && line.errors[input.dataset.field];
      if (err) {
        input.setAttribute('aria-invalid', 'true');
        input.title = err;
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('title');
      }
    });

    if (line.status === 'ok') {
      const v = inUnits(line);
      const c = F.classify(line.pcf, state.scale);
      const part = (value, unit) => {
        const s = el('span');
        s.append(el('b', { text: value }), ' ' + unit);
        return s;
      };
      out.append(
        part(fmt(v.cube, 3), L.cube),
        part(fmt(v.weight), L.wt),
        part(fmt(v.density, densityPlaces()), L.density),
        el('span', { className: 'cls', text: 'Class ' + c.cls })
      );
      if (state.rounding !== 'exact') {
        out.append(el('span', { text: 'Billed as ' + line.dims.map((d) => fmt(d, 3)).join(' x ') + ' ' + L.len }));
      }
    } else if (line.status === 'incomplete') {
      const names = line.missing.map((f) => FIELD_NAMES[f]);
      const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
      out.textContent = 'Add ' + list + ' to include this item.';
    } else if (line.status === 'invalid') {
      out.classList.add('is-error');
      out.textContent = Object.keys(line.errors)
        .map((f) => FIELD_NAMES[f].charAt(0).toUpperCase() + FIELD_NAMES[f].slice(1) + ': ' + line.errors[f])
        .join('. ') + '.';
    }
  }

  // -------------------------------------------------------------- totals --

  function paintTotals(result) {
    const L = F.labels(state.unit);
    const t = result.totals;
    const c = result.classification;
    const scale = F.getScale(state.scale);
    const tag = $('tag');

    $('tagScale').textContent = scale.name + ' scale';
    tag.classList.toggle('is-empty', !c);

    if (!c) {
      $('classValue').textContent = '-';
      ['densityMain', 'cubeMain', 'weightMain'].forEach((id) => { $(id).textContent = '-'; });
      ['densityAlt', 'cubeAlt', 'weightAlt'].forEach((id) => { $(id).textContent = ''; });
      $('hints').replaceChildren();
      $('tagCount').textContent = countText(result);
      return;
    }

    $('classValue').textContent = String(c.cls);
    if (state.unit === 'metric') {
      $('densityMain').textContent = fmtFixed(t.kgm3) + ' ' + L.density;
      $('densityAlt').textContent = fmtFixed(t.pcf) + ' pcf';
      $('cubeMain').textContent = fmtFixed(t.cubeM3, 3) + ' ' + L.cube;
      $('cubeAlt').textContent = fmtFixed(t.cubeFt3) + ' cu ft';
      $('weightMain').textContent = fmtFixed(t.weightKg) + ' ' + L.wt;
      $('weightAlt').textContent = fmtFixed(t.weightLb) + ' lbs';
    } else {
      $('densityMain').textContent = fmtFixed(t.pcf) + ' ' + L.density;
      $('densityAlt').textContent = fmtFixed(t.kgm3) + ' kg/m³';
      $('cubeMain').textContent = fmtFixed(t.cubeFt3) + ' ' + L.cube;
      $('cubeAlt').textContent = fmtFixed(t.cubeM3, 3) + ' m³';
      $('weightMain').textContent = fmtFixed(t.weightLb) + ' ' + L.wt;
      $('weightAlt').textContent = fmtFixed(t.weightKg) + ' kg';
    }

    paintBand(c, t.pcf);
    paintHints(result.hints);
    $('tagCount').textContent = countText(result);
  }

  function countText(result) {
    const t = result.totals;
    const skipped = result.lines.filter((l) => l.status === 'incomplete' || l.status === 'invalid').length;
    const parts = [];
    if (t.lines) {
      parts.push(t.lines + (t.lines === 1 ? ' item line' : ' item lines'));
      parts.push(t.units + (t.units === 1 ? ' handling unit' : ' handling units'));
    }
    if (skipped) parts.push(skipped + (skipped === 1 ? ' line' : ' lines') + ' left out until complete');
    return parts.join(', ');
  }

  function paintBand(c, pcf) {
    const L = F.labels(state.unit);
    const p = densityPlaces();
    let pct;
    let low;
    let high;
    if (c.max == null) {
      pct = 100;
      low = 'Class ' + c.higherCls + ' below ' + fmt(pcfToDisplay(c.min), p) + ' ' + L.density;
      high = 'Lowest class on this scale';
    } else if (c.higherCls == null) {
      pct = Math.max(0, Math.min(100, (pcf / c.max) * 100));
      low = 'Highest class on this scale';
      high = 'Class ' + c.lowerCls + ' at ' + fmt(pcfToDisplay(c.max), p) + ' ' + L.density;
    } else {
      pct = Math.max(0, Math.min(100, ((pcf - c.min) / (c.max - c.min)) * 100));
      low = 'Class ' + c.higherCls + ' below ' + fmt(pcfToDisplay(c.min), p) + ' ' + L.density;
      high = 'Class ' + c.lowerCls + ' at ' + fmt(pcfToDisplay(c.max), p) + ' ' + L.density;
    }
    $('bandFill').style.width = pct.toFixed(1) + '%';
    $('bandLow').textContent = low;
    $('bandHigh').textContent = high;
  }

  function paintHints(h) {
    const L = F.labels(state.unit);
    const metric = state.unit === 'metric';
    const cube = (ft3) => fmt(metric ? ft3 * F.M3_PER_FT3 : ft3, metric ? 3 : 2) + ' ' + L.cube;
    const weight = (lb) => fmt(metric ? lb * F.KG_PER_LB : lb) + ' ' + L.wt;
    const density = (pcfValue) => fmt(pcfToDisplay(pcfValue), densityPlaces()) + ' ' + L.density;
    const items = [];

    if (h && h.toLower) {
      items.push(el('li', {
        text: 'Class ' + h.toLower.cls + ' starts at ' + density(h.toLower.pcf) + '. Trim ' +
          cube(h.toLower.cutCubeFt3) + ' of cube (or carry ' + weight(h.toLower.addWeightLb) +
          ' more weight) to reach it.'
      }));
    }
    if (h && h.margin) {
      const tight = h.margin.densityPcf < 0.25;
      items.push(el('li', {
        className: tight ? 'warn' : '',
        text: (tight ? 'Close to the line: ' : '') + density(h.margin.densityPcf) + ' above class ' +
          h.margin.cls + '. About ' + cube(h.margin.cubeFt3) + ' more cube on a carrier re-measure would reclass it.'
      }));
    }
    $('hints').replaceChildren(...items);
  }

  // --------------------------------------------------------------- scale --

  function renderScale(c) {
    const scale = F.getScale(state.scale);
    const L = F.labels(state.unit);
    const p = densityPlaces();
    const tiers = scale.tiers;
    $('scaleDesc').textContent = scale.description + '.';
    $('scaleUnit').textContent = L.density;

    const rows = [];
    for (let i = tiers.length - 1; i >= 0; i--) {
      const min = fmt(pcfToDisplay(tiers[i].min), p);
      const next = i < tiers.length - 1 ? fmt(pcfToDisplay(tiers[i + 1].min), p) : null;
      let range;
      if (next == null) range = min + ' and up';
      else if (i === 0) range = 'Under ' + next;
      else range = min + ' to ' + next;
      const tr = el('tr', {}, [el('td', { text: range }), el('td', { text: String(tiers[i].cls) })]);
      if (c && c.index === i) {
        tr.className = 'is-active';
        tr.setAttribute('aria-current', 'true');
      }
      rows.push(tr);
    }
    $('scaleBody').replaceChildren(...rows);
  }

  // -------------------------------------------------------------- update --

  function update() {
    const result = F.computeShipment(state.rows, state);
    lastResult = result;
    Array.from(linesEl.children).forEach((li, i) => paintLine(li, result.lines[i]));
    paintTotals(result);
    renderScale(result.classification);
    $('exampleNote').hidden = !state.example;
    persist();
  }

  function syncUnitLabels() {
    const L = F.labels(state.unit);
    document.querySelectorAll('.u-len').forEach((n) => { n.textContent = L.len; });
    document.querySelectorAll('.u-wt').forEach((n) => { n.textContent = L.wt; });
    document.querySelectorAll('.u-wmode').forEach((n) => {
      n.textContent = state.weightMode === 'total' ? 'total' : 'each';
    });
    const word = state.unit === 'metric' ? 'cm' : 'inch';
    const opts = $('roundingSelect').options;
    opts[1].textContent = 'Nearest whole ' + word;
    opts[2].textContent = 'Round up to whole ' + word;
  }

  function syncControls() {
    $(state.unit === 'metric' ? 'unitMetric' : 'unitUs').checked = true;
    $(state.weightMode === 'total' ? 'weightTotal' : 'weightUnit').checked = true;
    $('roundingSelect').value = state.rounding;
    $('scaleSelect').value = state.scale;
    syncUnitLabels();
  }

  // ------------------------------------------------------------- actions --

  function focusField(rowId, field) {
    const input = $(field + '-' + rowId);
    if (input) {
      input.focus();
      input.select();
    }
  }

  function addRow(afterIndex, data) {
    const row = Object.assign(blankRow(), data || {}, { id: uid() });
    const at = afterIndex == null ? state.rows.length : afterIndex + 1;
    state.rows.splice(at, 0, row);
    renderLines();
    return row;
  }

  function removeRow(index) {
    const before = cloneRows();
    if (state.rows.length === 1) {
      state.rows = [blankRow()];
    } else {
      state.rows.splice(index, 1);
    }
    renderLines();
    toast('Item removed.', 'Undo', () => {
      state.rows = before;
      renderLines();
    });
  }

  const cloneRows = () => state.rows.map((r) => Object.assign({}, r));

  /**
   * A line as the user typed it. A line that was converted to the other unit
   * system and not edited since keeps its original entries (12 3/8, 2.3) and
   * their unit, so saving never stores rounded conversions like 2.3001.
   */
  function asTyped(row) {
    const back = row.beforeSwitch;
    if (back && MEASURE_FIELDS.every((f) => row[f] === back.produced[f])) {
      return Object.assign({}, row, back.values, { unit: back.unit });
    }
    return Object.assign({}, row, { unit: state.unit });
  }

  /**
   * A line just filled from values typed in `fromUnit`. When that differs from
   * the sheet's unit, remember the typed values so switching back or saving
   * uses them exactly instead of a rounded conversion.
   */
  function rememberTyped(row, typed, fromUnit) {
    delete row.beforeSwitch;
    if (fromUnit === state.unit) return;
    const values = {};
    const produced = {};
    MEASURE_FIELDS.forEach((f) => {
      values[f] = asText(typed[f]).trim();
      produced[f] = row[f];
    });
    row.beforeSwitch = { unit: fromUnit, values: values, produced: produced };
  }

  const savedAtText = (ms) => new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  function setPanel(panelId, toggleId, open) {
    $(panelId).hidden = !open;
    $(toggleId).setAttribute('aria-expanded', String(open));
  }

  /** After a list re-renders, keep keyboard focus on the entry that took the removed one's place. */
  function focusInList(list, position, fallbackId, options) {
    const li = list.children[Math.min(position, list.children.length - 1)];
    const btn = li && li.querySelector('.btn');
    (btn || $(fallbackId)).focus(options);
  }

  function saveToLibrary(row) {
    const typed = asTyped(row);
    const bad = MEASURE_FIELDS.some((f) => {
      const n = F.parseNumber(typed[f]);
      return n === null || isNaN(n);
    });
    if (bad) {
      toast('Fill in length, width, height and weight before saving this item.');
      return;
    }
    const L = F.labels(typed.unit);
    const name = (typed.desc.trim() || [typed.length, typed.width, typed.height].join(' x ') + ' ' + L.len).slice(0, 80);
    const units = F.parseNumber(typed.units);
    const entry = {
      id: uid(),
      name: name,
      unit: typed.unit,
      length: typed.length.trim(),
      width: typed.width.trim(),
      height: typed.height.trim(),
      weight: (state.weightMode === 'total' && units > 0 && F.divideWeight(typed.weight, units)) ||
        typed.weight.trim(),
      savedAt: Date.now()
    };
    refreshLibrary();
    const existing = library.findIndex((it) => it.name.toLowerCase() === name.toLowerCase());
    if (existing >= 0) {
      entry.id = library[existing].id;
      library[existing] = entry;
    } else {
      library.push(entry);
    }
    const kept = commitLibrary({ id: entry.id, entry: entry });
    renderLibrary();
    toast((existing >= 0 ? 'Updated ' : 'Saved ') + '"' + name + '" in saved items.' + (kept ? '' : STORAGE_BLOCKED));
  }

  function addFromLibrary(id) {
    const it = library.find((x) => x.id === id);
    if (!it) {
      refreshLibrary();
      renderLibrary();
      toast('That saved item was deleted in another window.');
      return;
    }
    const data = { desc: it.name, units: '1' };
    ['length', 'width', 'height'].forEach((f) => { data[f] = F.convertField(it[f], 'dim', it.unit, state.unit); });
    data.weight = F.convertField(it.weight, 'weight', it.unit, state.unit);
    // Saved items keep weight per unit. On a line-total sheet, switch the
    // sheet to per unit first (as opening a draft does) so every line reads
    // its weight the same way; Undo puts everything back.
    const switchedMode = state.weightMode === 'total';
    if (switchedMode) {
      const blocked = linesBlockingPerUnit();
      if (blocked.length) {
        toast('Fix line ' + blocked.join(', line ') + ' first. Saved items use weight per unit, and ' +
          (blocked.length === 1 ? 'that line\'s' : 'those lines\'') +
          ' weight or units cannot be read, so the line total cannot be split per unit.');
        return;
      }
    }
    const before = { rows: cloneRows(), weightMode: state.weightMode, example: state.example };
    let converted = 0;
    if (switchedMode) {
      state.rows.forEach((r) => { if (toPerUnit(r)) converted++; });
      state.weightMode = 'unit';
      syncControls();
    }
    state.example = false;

    // Fill the last line if it is still blank, otherwise add a new one.
    const last = state.rows[state.rows.length - 1];
    let row;
    if (FIELDS.every((f) => !last[f])) {
      Object.assign(last, data);
      row = last;
    } else {
      row = Object.assign(blankRow(), data);
      state.rows.push(row);
    }
    rememberTyped(row, it, it.unit);
    renderLines(); // renders and autosaves with everything above in place
    focusField(row.id, 'units');
    if (switchedMode) {
      toast('Added "' + it.name + '". Saved items keep weight per unit, so Weight entered is now Per unit' +
        (converted ? " and the other lines' totals were divided by their units." : '.'), 'Undo', () => {
        state.rows = before.rows;
        state.weightMode = before.weightMode;
        state.example = before.example;
        syncControls();
        renderLines();
      });
    }
  }

  /**
   * Turn a line's line-total weight into a per-unit weight (20.7 lbs for 9
   * units becomes 2.3). Returns false for lines left as typed: one unit, or no
   * usable weight or units.
   */
  function toPerUnit(row) {
    const typedUnits = F.parseNumber(row.units);
    const u = typedUnits === null ? 1 : typedUnits;
    if (u === 1) return false;
    const each = F.divideWeight(row.weight, u);
    if (each === null) return false;
    const back = row.beforeSwitch;
    if (back && back.produced.weight === row.weight) {
      const typedEach = F.divideWeight(back.values.weight, u);
      // New objects, not edits: duplicated lines and undo snapshots share them.
      row.beforeSwitch = {
        unit: back.unit,
        values: Object.assign({}, back.values, { weight: typedEach === null ? back.values.weight : typedEach }),
        produced: Object.assign({}, back.produced, { weight: each })
      };
    }
    row.weight = each;
    return true;
  }

  /**
   * Line numbers whose line-total weight cannot be turned into a per-unit
   * weight because the weight or units cannot be read. Switching the sheet to
   * per unit would quietly change what those weights mean.
   */
  function linesBlockingPerUnit() {
    const out = [];
    state.rows.forEach((row, i) => {
      if (!row.weight.trim()) return;
      const typedUnits = F.parseNumber(row.units);
      const u = typedUnits === null ? 1 : typedUnits;
      const unitsOk = !isNaN(u) && u >= 1 && Math.floor(u) === u;
      if (!unitsOk || F.divideWeight(row.weight, u) === null) out.push(i + 1);
    });
    return out;
  }

  function deleteFromLibrary(id, position) {
    refreshLibrary();
    const removed = library.find((it) => it.id === id);
    if (!removed) {
      renderLibrary();
      return;
    }
    library = library.filter((it) => it.id !== id);
    const kept = commitLibrary({ id: id });
    renderLibrary();
    focusInList($('libraryList'), position, 'libraryToggle');
    toast('Deleted "' + removed.name + '".' + (kept ? '' : STORAGE_BLOCKED), 'Undo', () => {
      refreshLibrary();
      const clash = library.some((it) => it.id !== removed.id && it.name.toLowerCase() === removed.name.toLowerCase());
      if (clash) {
        renderLibrary();
        toast('Not restored: another window has since saved an item called "' + removed.name + '".');
        return;
      }
      // Already back (another window saved it again): leave that newer copy alone.
      if (!library.some((it) => it.id === removed.id)) {
        library.push(removed);
        commitLibrary({ id: removed.id, entry: removed, at: removed.savedAt || 0 });
      }
      renderLibrary();
      setPanel('library', 'libraryToggle', true);
      const again = $('libraryList').querySelector('[data-library-add="' + CSS.escape(removed.id) + '"]');
      if (again) again.focus();
    });
  }

  function renderLibrary() {
    const L = (unit) => F.labels(unit);
    $('libraryCount').textContent = String(library.length);
    $('libraryEmpty').hidden = library.length > 0;
    $('libraryList').replaceChildren(...library
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((it) => {
        const info = el('span');
        info.append(
          el('b', { text: it.name }),
          el('small', {
            text: [it.length, it.width, it.height].join(' x ') + ' ' + L(it.unit).len + ', ' +
              it.weight + ' ' + L(it.unit).wt + ' each'
          })
        );
        const add = el('button', {
          type: 'button', className: 'btn btn-sm', text: 'Add', 'data-library-add': it.id,
          'aria-label': 'Add ' + it.name + ' to the sheet'
        });
        const del = iconButton('remove', 'Delete saved item ' + it.name, 'remove');
        del.dataset.libraryDelete = it.id;
        return el('li', { title: it.name }, [info, add, del]);
      }));
  }

  function changeUnit(next) {
    if (next === state.unit) return;
    const from = state.unit;
    state.rows.forEach((row) => {
      // Switching back without edits restores exactly what was typed, so a
      // round trip never turns 2.3 lbs into 2.299 lbs.
      const back = row.beforeSwitch;
      if (back && back.unit === next && MEASURE_FIELDS.every((f) => row[f] === back.produced[f])) {
        MEASURE_FIELDS.forEach((f) => { row[f] = back.values[f]; });
        delete row.beforeSwitch;
        return;
      }
      const values = {};
      const produced = {};
      MEASURE_FIELDS.forEach((f) => {
        values[f] = row[f];
        row[f] = F.convertField(row[f], f === 'weight' ? 'weight' : 'dim', from, next);
        produced[f] = row[f];
      });
      row.beforeSwitch = { unit: from, values: values, produced: produced };
    });
    state.unit = next;
    syncUnitLabels();
    renderLines();
    toast('Converted all items to ' + (next === 'metric' ? 'centimeters and kilograms.' : 'inches and pounds.'));
  }

  function clearAll() {
    const before = { rows: cloneRows(), example: state.example, draftName: state.draftName };
    state.rows = [blankRow()];
    state.example = false;
    state.draftName = '';
    closeDraftForm(false);
    renderLines();
    focusField(state.rows[0].id, 'length');
    toast('Sheet cleared.', 'Undo', () => {
      state.rows = before.rows;
      state.example = before.example;
      state.draftName = before.draftName;
      renderLines();
    });
  }

  // -------------------------------------------------------------- drafts --

  const draftForm = $('draftForm');
  const draftNameInput = $('draftName');

  function suggestDraftName() {
    const named = state.rows.map((r) => r.desc.trim()).filter(Boolean);
    if (named.length) {
      const first = named[0].slice(0, 40);
      return named.length > 1 ? first + ' + ' + (named.length - 1) + ' more' : first;
    }
    return 'Draft ' + savedAtText(Date.now());
  }

  function openDraftForm() {
    if (!F.toDraftRows(state.rows, state.weightMode).length) {
      toast('Add at least one item before saving a draft.');
      return;
    }
    draftForm.hidden = false;
    $('saveDraftBtn').setAttribute('aria-expanded', 'true');
    draftNameInput.removeAttribute('aria-invalid');
    draftNameInput.value = state.draftName || suggestDraftName();
    draftNameInput.focus();
    draftNameInput.select();
  }

  function closeDraftForm(returnFocus) {
    if (draftForm.hidden) return;
    draftForm.hidden = true;
    $('saveDraftBtn').setAttribute('aria-expanded', 'false');
    if (returnFocus) $('saveDraftBtn').focus();
  }

  function saveDraft() {
    const name = draftNameInput.value.trim().slice(0, 60);
    if (!name) {
      draftNameInput.setAttribute('aria-invalid', 'true');
      draftNameInput.focus();
      toast('Give the draft a name so you can find it later.');
      return;
    }
    const rows = F.toDraftRows(state.rows.map(asTyped), state.weightMode);
    if (!rows.length) {
      closeDraftForm(true);
      toast('Add at least one item before saving a draft.');
      return;
    }
    refreshDrafts();
    const existing = drafts.findIndex((d) => d.name.toLowerCase() === name.toLowerCase());
    const draft = {
      id: existing >= 0 ? drafts[existing].id : uid(),
      name: name,
      unit: state.unit,
      savedAt: Date.now(),
      rows: rows
    };
    if (existing >= 0) drafts[existing] = draft;
    else drafts.push(draft);
    const kept = commitDrafts({ id: draft.id, entry: draft });
    state.draftName = name;
    persist();
    renderDrafts();
    closeDraftForm(true);
    toast((existing >= 0 ? 'Updated' : 'Saved') + ' draft "' + name + '" with ' +
      rows.length + (rows.length === 1 ? ' item.' : ' items.') + (kept ? '' : STORAGE_BLOCKED));
  }

  function loadDraft(id) {
    const draft = drafts.find((d) => d.id === id);
    if (!draft) {
      refreshDrafts();
      renderDrafts();
      toast('That draft was deleted in another window.');
      return;
    }
    const before = {
      rows: cloneRows(), example: state.example, draftName: state.draftName, weightMode: state.weightMode
    };
    const rows = F.fromDraftRows(draft, state.unit).map((r, i) => {
      const row = Object.assign({ id: uid() }, r);
      rememberTyped(row, draft.rows[i], draft.rows[i].unit || draft.unit);
      return row;
    });
    // Draft weights are per unit, so the sheet has to read them that way.
    const switchedMode = state.weightMode !== 'unit';
    state.weightMode = 'unit';
    state.rows = rows.length ? rows : [blankRow()];
    state.example = false;
    state.draftName = draft.name;
    closeDraftForm(false);
    setPanel('drafts', 'draftsToggle', false);
    syncControls();
    renderLines();
    focusField(state.rows[0].id, 'units');
    toast('Opened "' + draft.name + '". Enter the units for each item.' +
      (switchedMode ? ' Weight is now entered per unit.' : ''), 'Undo', () => {
      state.rows = before.rows;
      state.example = before.example;
      state.draftName = before.draftName;
      state.weightMode = before.weightMode;
      syncControls();
      renderLines();
    });
  }

  function deleteDraft(id, position) {
    refreshDrafts();
    const removed = drafts.find((d) => d.id === id);
    if (!removed) {
      renderDrafts();
      return;
    }
    drafts = drafts.filter((d) => d.id !== id);
    const kept = commitDrafts({ id: id });
    renderDrafts();
    focusInList($('draftList'), position, 'draftsToggle');
    toast('Deleted draft "' + removed.name + '".' + (kept ? '' : STORAGE_BLOCKED), 'Undo', () => {
      refreshDrafts();
      const clash = drafts.some((d) => d.id !== removed.id && d.name.toLowerCase() === removed.name.toLowerCase());
      if (clash) {
        renderDrafts();
        toast('Not restored: another window has since saved a draft called "' + removed.name + '".');
        return;
      }
      // Already back (another window saved it again): leave that newer copy alone.
      if (!drafts.some((d) => d.id === removed.id)) {
        drafts.push(removed);
        commitDrafts({ id: removed.id, entry: removed, at: removed.savedAt || 0 });
      }
      renderDrafts();
      setPanel('drafts', 'draftsToggle', true);
      const again = $('draftList').querySelector('[data-draft-open="' + CSS.escape(removed.id) + '"]');
      if (again) again.focus();
    });
  }

  function renderDrafts() {
    $('draftCount').textContent = String(drafts.length);
    $('draftsEmpty').hidden = drafts.length > 0;
    $('draftList').replaceChildren(...drafts
      .slice()
      .sort((a, b) => b.savedAt - a.savedAt)
      .map((d) => {
        const info = el('span');
        info.append(
          el('b', { text: d.name }),
          el('small', {
            text: d.rows.length + (d.rows.length === 1 ? ' item' : ' items') +
              (d.savedAt ? ', saved ' + savedAtText(d.savedAt) : '')
          })
        );
        const open = el('button', {
          type: 'button', className: 'btn btn-sm', text: 'Open', 'data-draft-open': d.id,
          'aria-label': 'Open draft ' + d.name
        });
        const del = iconButton('remove', 'Delete draft ' + d.name, 'remove');
        del.dataset.draftDelete = d.id;
        return el('li', { title: d.name }, [info, open, del]);
      }));
  }

  /** ' 2 lines are left out ...' when some lines are incomplete or invalid, else ''. */
  function leftOutNote(where) {
    const n = F.leftOutLines(state, lastResult).length;
    if (!n) return '';
    return ' ' + n + (n === 1 ? ' line is' : ' lines are') + ' left out of the totals because ' +
      (n === 1 ? 'it is' : 'they are') + ' incomplete, and ' + where + ' says so.';
  }

  function copySummary() {
    const text = F.buildSummary(state, lastResult);
    const copied = 'Summary copied. Paste it into an email or quote request.' + leftOutNote('the summary');
    const fallback = () => {
      const ta = el('textarea', { readonly: '' });
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? copied : 'Your browser blocked copying. Try again from a normal browser window.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast(copied))
        .catch(fallback);
    } else {
      fallback();
    }
  }

  function exportCsv() {
    if (!lastResult || !lastResult.totals.lines) {
      toast('Add at least one complete item to export.');
      return;
    }
    const csv = F.buildCsv(state, lastResult);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'shipment-density-' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const note = leftOutNote('the file');
    if (note) toast('CSV exported.' + note);
  }

  // --------------------------------------------------------------- toast --

  const toastBox = $('toast');
  let toastTimer = null;
  let toastDelay = 3500;

  const hideToast = () => { toastBox.hidden = true; };

  // The message stays up while the pointer or keyboard focus is on it, so
  // Undo can always be reached; leaving it starts the countdown again.
  function armToast() {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastBox.matches(':hover') || toastBox.contains(document.activeElement)) return;
      hideToast();
    }, toastDelay);
  }

  function toast(message, actionLabel, onAction) {
    const action = $('toastAction');
    $('toastText').textContent = message;
    action.hidden = !actionLabel;
    action.textContent = actionLabel || '';
    action.onclick = actionLabel
      ? () => {
        hideToast();
        onAction();
        const active = document.activeElement;
        if (!active || active === document.body || toastBox.contains(active)) {
          const first = linesEl.querySelector('input');
          if (first) first.focus();
        }
      }
      : null;
    toastDelay = actionLabel ? 8000 : 3500;
    toastBox.hidden = false;
    armToast();
  }

  toastBox.addEventListener('mouseleave', armToast);
  toastBox.addEventListener('focusout', armToast);

  // -------------------------------------------------------------- events --

  linesEl.addEventListener('input', (e) => {
    const input = e.target;
    const li = input.closest('.line');
    if (!li || !input.dataset.field) return;
    const row = state.rows.find((r) => r.id === li.dataset.id);
    if (!row) return;
    row[input.dataset.field] = input.value;
    if (state.example) state.example = false;
    update();
  });

  linesEl.addEventListener('keydown', (e) => {
    const field = e.target.dataset.field;
    if (!field || e.isComposing) return;
    const li = e.target.closest('.line');
    const index = state.rows.findIndex((r) => r.id === li.dataset.id);
    if (index < 0) return;

    // Up and Down jump to the same field on the neighbouring line, like a spreadsheet.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !(e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      const target = state.rows[index + (e.key === 'ArrowDown' ? 1 : -1)];
      if (target) focusField(target.id, field);
      return;
    }

    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = field === 'desc' ? 'length' : field;
    if (index === state.rows.length - 1) {
      const row = addRow();
      focusField(row.id, 'length');
    } else {
      focusField(state.rows[index + 1].id, next);
    }
  });

  linesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const li = btn.closest('.line');
    const index = state.rows.findIndex((r) => r.id === li.dataset.id);
    if (index < 0) return;
    const action = btn.dataset.action;
    if (action === 'duplicate') {
      const copy = Object.assign({}, state.rows[index]);
      const row = addRow(index, copy);
      focusField(row.id, 'units');
    } else if (action === 'save') {
      saveToLibrary(state.rows[index]);
    } else if (action === 'remove') {
      removeRow(index);
    }
  });

  $('addLine').addEventListener('click', () => {
    const row = addRow();
    focusField(row.id, 'length');
  });

  $('libraryToggle').addEventListener('click', () => {
    const open = $('library').hidden;
    if (open) {
      refreshLibrary();
      renderLibrary();
    }
    setPanel('library', 'libraryToggle', open);
  });

  $('libraryList').addEventListener('click', (e) => {
    const add = e.target.closest('[data-library-add]');
    if (add) {
      addFromLibrary(add.dataset.libraryAdd);
      return;
    }
    const del = e.target.closest('[data-library-delete]');
    if (del) deleteFromLibrary(del.dataset.libraryDelete, [...$('libraryList').children].indexOf(del.closest('li')));
  });

  $('saveDraftBtn').addEventListener('click', () => {
    if (draftForm.hidden) openDraftForm();
    else closeDraftForm(true);
  });

  draftForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveDraft();
  });

  draftForm.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDraftForm(true);
    }
  });

  draftNameInput.addEventListener('input', () => draftNameInput.removeAttribute('aria-invalid'));
  $('draftCancel').addEventListener('click', () => closeDraftForm(true));

  $('draftsToggle').addEventListener('click', () => {
    const open = $('drafts').hidden;
    if (open) {
      refreshDrafts();
      renderDrafts();
    }
    setPanel('drafts', 'draftsToggle', open);
  });

  $('draftList').addEventListener('click', (e) => {
    const open = e.target.closest('[data-draft-open]');
    if (open) {
      loadDraft(open.dataset.draftOpen);
      return;
    }
    const del = e.target.closest('[data-draft-delete]');
    if (del) deleteDraft(del.dataset.draftDelete, [...$('draftList').children].indexOf(del.closest('li')));
  });

  /** Re-render a list without losing keyboard focus on one of its buttons. */
  function keepListFocus(render) {
    const active = document.activeElement;
    const attr = active && ['data-draft-open', 'data-draft-delete', 'data-library-add', 'data-library-delete']
      .find((a) => active.hasAttribute(a));
    if (!attr) {
      render();
      return;
    }
    const list = active.closest('ul');
    const position = [...list.children].indexOf(active.closest('li'));
    const id = active.getAttribute(attr);
    render();
    // Another window caused this, so keep focus without scrolling the page.
    const same = list.querySelector('[' + attr + '="' + CSS.escape(id) + '"]');
    if (same) same.focus({ preventScroll: true });
    else focusInList(list, position, list.id === 'draftList' ? 'draftsToggle' : 'libraryToggle', { preventScroll: true });
  }

  // Keep the lists current when another window saves or deletes.
  window.addEventListener('storage', (e) => {
    if (e.key === DRAFTS_KEY || e.key === LIBRARY_KEY || e.key === null) setTimeout(flushPending, 0);
    if (e.key === null || e.key === DRAFTS_KEY) {
      keepListFocus(() => {
        refreshDrafts();
        renderDrafts();
      });
    }
    if (e.key === null || e.key === LIBRARY_KEY) {
      keepListFocus(() => {
        refreshLibrary();
        renderLibrary();
      });
    }
  });

  document.querySelectorAll('input[name="unit"]').forEach((r) => {
    r.addEventListener('change', () => changeUnit(r.value));
  });

  document.querySelectorAll('input[name="weightMode"]').forEach((r) => {
    r.addEventListener('change', () => {
      state.weightMode = r.value;
      syncUnitLabels();
      update();
    });
  });

  $('roundingSelect').addEventListener('change', (e) => {
    state.rounding = e.target.value;
    update();
  });

  $('scaleSelect').addEventListener('change', (e) => {
    state.scale = e.target.value;
    update();
  });

  $('exampleClear').addEventListener('click', clearAll);
  $('clearBtn').addEventListener('click', clearAll);
  $('copyBtn').addEventListener('click', copySummary);
  $('csvBtn').addEventListener('click', exportCsv);
  $('printBtn').addEventListener('click', () => window.print());

  // Hosted previews cannot print, download files or install apps.
  if (PREVIEW) {
    $('csvBtn').hidden = true;
    $('printBtn').hidden = true;
  }

  // ------------------------------------------------- installable web app --

  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    if (PREVIEW) return;
    e.preventDefault();
    installPrompt = e;
    $('installBtn').hidden = false;
  });

  $('installBtn').addEventListener('click', () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.finally(() => {
      installPrompt = null;
      $('installBtn').hidden = true;
    });
  });

  if (!PREVIEW && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    });
  }

  // ---------------------------------------------------------------- boot --

  syncControls();
  renderLibrary();
  renderDrafts();
  renderLines();
})();
