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

  function load(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
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

  const asText = (v) => (v == null ? '' : String(v));

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

  function restoreState(saved) {
    if (!saved || typeof saved !== 'object' || !Array.isArray(saved.rows)) return defaultState();
    const rows = saved.rows
      .filter((r) => r && typeof r === 'object')
      .map((r) => {
        const row = { id: uid() };
        FIELDS.forEach((f) => { row[f] = asText(r[f]); });
        return row;
      });
    return {
      unit: saved.unit === 'metric' ? 'metric' : 'us',
      weightMode: saved.weightMode === 'total' ? 'total' : 'unit',
      rounding: ['exact', 'nearest', 'up'].includes(saved.rounding) ? saved.rounding : 'exact',
      scale: F.SCALES[saved.scale] ? saved.scale : F.DEFAULT_SCALE,
      example: Boolean(saved.example),
      draftName: asText(saved.draftName).slice(0, 60),
      rows: rows.length ? rows : [blankRow()]
    };
  }

  function restoreLibrary(saved) {
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((it) => it && typeof it === 'object' && it.name)
      .map((it) => ({
        id: asText(it.id) || uid(),
        name: asText(it.name),
        unit: it.unit === 'metric' ? 'metric' : 'us',
        length: asText(it.length),
        width: asText(it.width),
        height: asText(it.height),
        weight: asText(it.weight)
      }));
  }

  let state = restoreState(load(STATE_KEY));
  function restoreDrafts(saved) {
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((d) => d && typeof d === 'object' && d.name && Array.isArray(d.rows))
      .map((d) => ({
        id: asText(d.id) || uid(),
        name: asText(d.name).slice(0, 60),
        unit: d.unit === 'metric' ? 'metric' : 'us',
        savedAt: Number(d.savedAt) || 0,
        rows: d.rows
          .filter((r) => r && typeof r === 'object')
          .map((r) => {
            const row = {};
            F.DRAFT_FIELDS.forEach((f) => { row[f] = asText(r[f]); });
            return row;
          })
      }));
  }

  let library = restoreLibrary(load(LIBRARY_KEY));
  let drafts = restoreDrafts(load(DRAFTS_KEY));
  let lastResult = null;

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

  function saveToLibrary(row) {
    const missing = MEASURE_FIELDS.filter((f) => F.parseNumber(row[f]) === null || isNaN(F.parseNumber(row[f])));
    if (missing.length) {
      toast('Fill in length, width, height and weight before saving this item.');
      return;
    }
    const L = F.labels(state.unit);
    const name = row.desc.trim() ||
      [row.length, row.width, row.height].join(' x ') + ' ' + L.len;
    const entry = {
      id: uid(),
      name: name,
      unit: state.unit,
      length: row.length,
      width: row.width,
      height: row.height,
      weight: state.weightMode === 'total'
        ? F.trimNumber(F.parseNumber(row.weight) / (F.parseNumber(row.units) || 1), 3)
        : row.weight
    };
    const existing = library.findIndex((it) => it.name.toLowerCase() === name.toLowerCase());
    if (existing >= 0) library[existing] = entry;
    else library.push(entry);
    const kept = store(LIBRARY_KEY, library);
    renderLibrary();
    toast((existing >= 0 ? 'Updated ' : 'Saved ') + '"' + name + '" in saved items.' + (kept ? '' : STORAGE_BLOCKED));
  }

  function addFromLibrary(id) {
    const it = library.find((x) => x.id === id);
    if (!it) return;
    const data = { desc: it.name };
    ['length', 'width', 'height'].forEach((f) => { data[f] = F.convertField(it[f], 'dim', it.unit, state.unit); });
    data.weight = F.convertField(it.weight, 'weight', it.unit, state.unit);
    data.units = '1';
    state.example = false;

    // Fill the last line if it is still blank, otherwise add a new one.
    const last = state.rows[state.rows.length - 1];
    let row;
    if (FIELDS.every((f) => !last[f])) {
      Object.assign(last, data);
      row = last;
      renderLines();
    } else {
      row = addRow(null, data);
    }
    focusField(row.id, 'units');
  }

  function renderLibrary() {
    const pick = $('libraryPick');
    const L = (unit) => F.labels(unit);
    pick.replaceChildren(el('option', { value: '', text: library.length ? 'Add saved item...' : 'No saved items yet' }));
    pick.disabled = !library.length;
    library
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((it) => pick.append(el('option', { value: it.id, text: it.name })));

    $('library').hidden = !library.length;
    $('libraryCount').textContent = String(library.length);
    $('libraryList').replaceChildren(...library.map((it) => {
      const info = el('span');
      info.append(
        el('b', { text: it.name }),
        el('small', {
          text: [it.length, it.width, it.height].join(' x ') + ' ' + L(it.unit).len + ', ' +
            it.weight + ' ' + L(it.unit).wt + ' each'
        })
      );
      const del = iconButton('remove', 'Delete saved item ' + it.name, 'remove');
      del.dataset.libraryId = it.id;
      return el('li', {}, [info, del]);
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
    return 'Draft ' + new Date().toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
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
    const rows = F.toDraftRows(state.rows, state.weightMode);
    if (!rows.length) {
      closeDraftForm(true);
      toast('Add at least one item before saving a draft.');
      return;
    }
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
    const kept = store(DRAFTS_KEY, drafts);
    state.draftName = name;
    persist();
    renderDrafts();
    closeDraftForm(true);
    toast((existing >= 0 ? 'Updated' : 'Saved') + ' draft "' + name + '" with ' +
      rows.length + (rows.length === 1 ? ' item.' : ' items.') + (kept ? '' : STORAGE_BLOCKED));
  }

  function loadDraft(id) {
    const draft = drafts.find((d) => d.id === id);
    if (!draft) return;
    const before = {
      rows: cloneRows(), example: state.example, draftName: state.draftName, weightMode: state.weightMode
    };
    const rows = F.fromDraftRows(draft, state.unit).map((r, i) => {
      const row = Object.assign({ id: uid() }, r);
      // Opened in the other unit system: remember what was saved so switching
      // back shows the original entries (2.3 lbs, not 2.3001 lbs).
      if (draft.unit !== state.unit) {
        const values = {};
        const produced = {};
        MEASURE_FIELDS.forEach((f) => {
          values[f] = asText(draft.rows[i][f]).trim();
          produced[f] = row[f];
        });
        row.beforeSwitch = { unit: draft.unit, values: values, produced: produced };
      }
      return row;
    });
    // Draft weights are per unit, so the sheet has to read them that way.
    const switchedMode = state.weightMode !== 'unit';
    state.weightMode = 'unit';
    state.rows = rows.length ? rows : [blankRow()];
    state.example = false;
    state.draftName = draft.name;
    closeDraftForm(false);
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

  function deleteDraft(id) {
    const index = drafts.findIndex((d) => d.id === id);
    if (index < 0) return;
    const removed = drafts[index];
    drafts.splice(index, 1);
    store(DRAFTS_KEY, drafts);
    renderDrafts();
    toast('Deleted draft "' + removed.name + '".', 'Undo', () => {
      drafts.splice(Math.min(index, drafts.length), 0, removed);
      store(DRAFTS_KEY, drafts);
      renderDrafts();
    });
  }

  function renderDrafts() {
    const pick = $('draftPick');
    const sorted = drafts.slice().sort((a, b) => b.savedAt - a.savedAt);
    pick.replaceChildren(el('option', { value: '', text: drafts.length ? 'Open draft...' : 'No drafts yet' }));
    pick.disabled = !drafts.length;
    sorted.forEach((d) => pick.append(el('option', { value: d.id, text: d.name })));

    $('drafts').hidden = !drafts.length;
    $('draftCount').textContent = String(drafts.length);
    $('draftList').replaceChildren(...sorted.map((d) => {
      const when = d.savedAt
        ? new Date(d.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
      const info = el('span');
      info.append(
        el('b', { text: d.name }),
        el('small', {
          text: d.rows.length + (d.rows.length === 1 ? ' item' : ' items') + (when ? ', saved ' + when : '')
        })
      );
      const open = el('button', {
        type: 'button', className: 'btn btn-sm', text: 'Open', 'data-draft-open': d.id,
        'aria-label': 'Open draft ' + d.name
      });
      const del = iconButton('remove', 'Delete draft ' + d.name, 'remove');
      del.dataset.draftDelete = d.id;
      return el('li', {}, [info, open, del]);
    }));
  }

  function copySummary() {
    const text = F.buildSummary(state, lastResult);
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
      toast(ok ? 'Summary copied. Paste it into an email or quote request.' : 'Your browser blocked copying. Try again from a normal browser window.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast('Summary copied. Paste it into an email or quote request.'))
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
  }

  // --------------------------------------------------------------- toast --

  let toastTimer = null;

  function toast(message, actionLabel, onAction) {
    const box = $('toast');
    const action = $('toastAction');
    $('toastText').textContent = message;
    action.hidden = !actionLabel;
    action.textContent = actionLabel || '';
    action.onclick = actionLabel
      ? () => { box.hidden = true; onAction(); }
      : null;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, actionLabel ? 7000 : 3500);
  }

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

  $('libraryPick').addEventListener('change', (e) => {
    if (e.target.value) addFromLibrary(e.target.value);
    e.target.value = '';
  });

  $('libraryList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-library-id]');
    if (!btn) return;
    const removed = library.find((it) => it.id === btn.dataset.libraryId);
    library = library.filter((it) => it.id !== btn.dataset.libraryId);
    store(LIBRARY_KEY, library);
    renderLibrary();
    toast('Deleted "' + removed.name + '".', 'Undo', () => {
      library.push(removed);
      store(LIBRARY_KEY, library);
      renderLibrary();
    });
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

  $('draftPick').addEventListener('change', (e) => {
    const id = e.target.value;
    e.target.value = '';
    if (id) loadDraft(id);
  });

  $('draftList').addEventListener('click', (e) => {
    const open = e.target.closest('[data-draft-open]');
    if (open) {
      loadDraft(open.dataset.draftOpen);
      return;
    }
    const del = e.target.closest('[data-draft-delete]');
    if (del) deleteDraft(del.dataset.draftDelete);
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
