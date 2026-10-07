/*
 * HSSH FCalc: calculation core.
 *
 * Pure functions only (no DOM), so the same file runs in the browser
 * (exposed as window.FCalc) and in Node for the test suite (require()).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FCalc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Unit constants (exact definitions)
  // ---------------------------------------------------------------------------
  var CM_PER_IN = 2.54;
  var KG_PER_LB = 0.45359237;
  var IN3_PER_FT3 = 1728;            // 12 x 12 x 12
  var CM3_PER_M3 = 1000000;          // 100 x 100 x 100
  var M3_PER_FT3 = 0.028316846592;   // (0.3048 m)^3
  var KGM3_PER_PCF = KG_PER_LB / M3_PER_FT3; // ~16.0184634 kg/m3 per lb/ft3

  // ---------------------------------------------------------------------------
  // Density scales. Each tier starts at `min` pcf (inclusive) and runs up to
  // the next tier's `min` (exclusive).
  // ---------------------------------------------------------------------------
  var SCALES = {
    nmfc2025: {
      id: 'nmfc2025',
      name: 'NMFC 2025',
      description: '13-tier density scale, NMFC Docket 2025-1 (effective July 19, 2025)',
      tiers: [
        { min: 0, cls: 400 },
        { min: 1, cls: 300 },
        { min: 2, cls: 250 },
        { min: 4, cls: 175 },
        { min: 6, cls: 125 },
        { min: 8, cls: 100 },
        { min: 10, cls: 92.5 },
        { min: 12, cls: 85 },
        { min: 15, cls: 70 },
        { min: 22.5, cls: 65 },
        { min: 30, cls: 60 },
        { min: 35, cls: 55 },
        { min: 50, cls: 50 }
      ]
    },
    legacy18: {
      id: 'legacy18',
      name: 'Legacy 18-class',
      description: 'Pre-2025 density guideline with 18 classes (50 to 500), still used in some FAK and carrier agreements',
      tiers: [
        { min: 0, cls: 500 },
        { min: 1, cls: 400 },
        { min: 2, cls: 300 },
        { min: 3, cls: 250 },
        { min: 4, cls: 200 },
        { min: 5, cls: 175 },
        { min: 6, cls: 150 },
        { min: 7, cls: 125 },
        { min: 8, cls: 110 },
        { min: 9, cls: 100 },
        { min: 10.5, cls: 92.5 },
        { min: 12, cls: 85 },
        { min: 13.5, cls: 77.5 },
        { min: 15, cls: 70 },
        { min: 22.5, cls: 65 },
        { min: 30, cls: 60 },
        { min: 35, cls: 55 },
        { min: 50, cls: 50 }
      ]
    }
  };

  var DEFAULT_SCALE = 'nmfc2025';

  function getScale(id) {
    return SCALES[id] || SCALES[DEFAULT_SCALE];
  }

  // ---------------------------------------------------------------------------
  // Number parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse a user-typed measurement. Accepts decimals ("12.375", ".5"),
   * fractions ("3/8") and mixed numbers ("12 3/8", "12-3/8").
   * Returns null for an empty field and NaN for anything unreadable.
   */
  function parseNumber(input) {
    if (typeof input === 'number') return isFinite(input) ? input : NaN;
    var s = String(input == null ? '' : input).trim();
    if (s === '') return null;

    var m;
    if (/^(\d+\.?\d*|\.\d+)$/.test(s)) return parseFloat(s);

    m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m) return Number(m[2]) === 0 ? NaN : Number(m[1]) / Number(m[2]);

    m = s.match(/^(\d+)(?:\s+|\s*-\s*)(\d+)\s*\/\s*(\d+)$/);
    if (m) return Number(m[3]) === 0 ? NaN : Number(m[1]) + Number(m[2]) / Number(m[3]);

    return NaN;
  }

  /** Apply the carrier dimension rounding rule to one measurement. */
  function roundDimension(value, mode) {
    if (mode === 'up') return Math.ceil(value - 1e-9);
    if (mode === 'nearest') return Math.max(1, Math.round(value));
    return value;
  }

  // ---------------------------------------------------------------------------
  // Classification
  // ---------------------------------------------------------------------------

  /** Look up the class for a density in lb/ft3. Returns null for no density. */
  function classify(pcf, scaleId) {
    if (pcf == null || !isFinite(pcf) || pcf < 0) return null;
    var scale = getScale(scaleId);
    var tiers = scale.tiers;
    // Guard against floating point noise right at a boundary (7.9999999999 -> 8).
    var d = Math.round(pcf * 1e9) / 1e9;
    var i = tiers.length - 1;
    while (i > 0 && d < tiers[i].min) i--;
    return {
      scaleId: scale.id,
      index: i,
      cls: tiers[i].cls,
      min: tiers[i].min,
      max: i < tiers.length - 1 ? tiers[i + 1].min : null,
      lowerCls: i < tiers.length - 1 ? tiers[i + 1].cls : null, // next cheaper class
      higherCls: i > 0 ? tiers[i - 1].cls : null                // next pricier class
    };
  }

  /**
   * What it takes to move between classes, in US units.
   *  - toLower: reach the next cheaper class (higher density)
   *  - margin: how far above the line into the next pricier class
   */
  function classHints(totals, scaleId) {
    if (!totals || !(totals.cubeFt3 > 0)) return null;
    var c = classify(totals.pcf, scaleId);
    if (!c) return null;
    var out = { classification: c, toLower: null, margin: null };
    if (c.max != null) {
      out.toLower = {
        cls: c.lowerCls,
        pcf: c.max,
        addWeightLb: c.max * totals.cubeFt3 - totals.weightLb,
        cutCubeFt3: totals.cubeFt3 - totals.weightLb / c.max
      };
    }
    if (c.higherCls != null) {
      out.margin = {
        cls: c.higherCls,
        pcf: c.min,
        densityPcf: totals.pcf - c.min,
        weightLb: totals.weightLb - c.min * totals.cubeFt3,
        cubeFt3: c.min > 0 ? totals.weightLb / c.min - totals.cubeFt3 : null
      };
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Line and shipment math
  // ---------------------------------------------------------------------------

  var DIM_FIELDS = ['length', 'width', 'height'];
  var REQUIRED_FIELDS = ['length', 'width', 'height', 'weight'];

  /**
   * Evaluate one item line.
   * row:  { length, width, height, weight, units } as strings or numbers
   * opts: { unit: 'us'|'metric', weightMode: 'unit'|'total', rounding: 'exact'|'nearest'|'up' }
   */
  function computeLine(row, opts) {
    opts = opts || {};
    var unit = opts.unit === 'metric' ? 'metric' : 'us';
    var values = {};
    var errors = {};
    var missing = [];
    var anyFilled = false;

    REQUIRED_FIELDS.forEach(function (f) {
      var v = parseNumber(row[f]);
      if (v === null) { missing.push(f); return; }
      anyFilled = true;
      if (isNaN(v)) errors[f] = 'Enter a number like 12.5 or 12 1/2';
      else if (v <= 0) errors[f] = 'Must be more than 0';
      else values[f] = v;
    });

    var units = parseNumber(row.units);
    if (units === null) {
      units = 1;
    } else {
      anyFilled = true;
      if (isNaN(units) || units < 1 || Math.floor(units) !== units) {
        errors.units = 'Use a whole number of 1 or more';
      }
    }

    if (!anyFilled) return { status: 'empty' };
    if (Object.keys(errors).length) return { status: 'invalid', errors: errors, missing: missing };
    if (missing.length) return { status: 'incomplete', missing: missing };

    var dims = DIM_FIELDS.map(function (f) { return roundDimension(values[f], opts.rounding); });
    var volEach = dims[0] * dims[1] * dims[2];
    var lineWeight = opts.weightMode === 'total' ? values.weight : values.weight * units;

    var cubeFt3, cubeM3, weightLb, weightKg;
    if (unit === 'us') {
      cubeFt3 = (volEach * units) / IN3_PER_FT3;
      cubeM3 = cubeFt3 * M3_PER_FT3;
      weightLb = lineWeight;
      weightKg = lineWeight * KG_PER_LB;
    } else {
      cubeM3 = (volEach * units) / CM3_PER_M3;
      cubeFt3 = cubeM3 / M3_PER_FT3;
      weightKg = lineWeight;
      weightLb = lineWeight / KG_PER_LB;
    }

    return {
      status: 'ok',
      dims: dims,
      units: units,
      cubeFt3: cubeFt3,
      cubeM3: cubeM3,
      weightLb: weightLb,
      weightKg: weightKg,
      pcf: weightLb / cubeFt3,
      kgm3: weightKg / cubeM3
    };
  }

  /** Evaluate all lines and roll them up into shipment totals. */
  function computeShipment(rows, opts) {
    var lines = (rows || []).map(function (r) { return computeLine(r, opts); });
    var t = { cubeFt3: 0, cubeM3: 0, weightLb: 0, weightKg: 0, units: 0, lines: 0 };
    lines.forEach(function (l) {
      if (l.status !== 'ok') return;
      t.cubeFt3 += l.cubeFt3;
      t.cubeM3 += l.cubeM3;
      t.weightLb += l.weightLb;
      t.weightKg += l.weightKg;
      t.units += l.units;
      t.lines += 1;
    });
    var hasData = t.cubeFt3 > 0;
    t.pcf = hasData ? t.weightLb / t.cubeFt3 : null;
    t.kgm3 = hasData ? t.weightKg / t.cubeM3 : null;
    return {
      lines: lines,
      totals: t,
      classification: hasData ? classify(t.pcf, opts && opts.scale) : null,
      hints: hasData ? classHints(t, opts && opts.scale) : null
    };
  }

  // ---------------------------------------------------------------------------
  // Conversions and formatting
  // ---------------------------------------------------------------------------

  /** Trim a number to at most `places` decimals without trailing zeros. */
  function trimNumber(n, places) {
    var f = Math.pow(10, places == null ? 3 : places);
    return String(Math.round(n * f) / f);
  }

  /** Convert a typed field between unit systems. Leaves unreadable text alone. */
  function convertField(value, kind, from, to) {
    if (from === to) return value;
    var n = parseNumber(value);
    if (n === null || isNaN(n)) return value;
    var factor = kind === 'weight' ? KG_PER_LB : CM_PER_IN;
    // Four places keeps the converted density within 0.01 of the original.
    return trimNumber(from === 'us' ? n * factor : n / factor, 4);
  }

  function fmt(n, places) {
    if (n == null || !isFinite(n)) return '-';
    var p = places == null ? 2 : places;
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: p });
  }

  function fmtFixed(n, places) {
    if (n == null || !isFinite(n)) return '-';
    var p = places == null ? 2 : places;
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: p, maximumFractionDigits: p });
  }

  /** Unit labels for the current measurement system. */
  function labels(unit) {
    return unit === 'metric'
      ? { len: 'cm', wt: 'kg', cube: 'm³', density: 'kg/m³' }
      : { len: 'in', wt: 'lbs', cube: 'cu ft', density: 'pcf' };
  }

  // ---------------------------------------------------------------------------
  // Export helpers
  // ---------------------------------------------------------------------------

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Build a CSV of every line plus a totals row. */
  function buildCsv(state, result) {
    var L = labels(state.unit);
    var head = [
      'Item', 'Description',
      'Length (' + L.len + ')', 'Width (' + L.len + ')', 'Height (' + L.len + ')',
      'Weight (' + L.wt + (state.weightMode === 'total' ? ', line total' : ', per unit') + ')',
      'Units', 'Cube (cu ft)', 'Cube (m3)', 'Weight (lbs)', 'Weight (kg)',
      'Density (pcf)', 'Density (kg/m3)', 'Class'
    ];
    var out = [head.map(csvCell).join(',')];
    state.rows.forEach(function (row, i) {
      var l = result.lines[i];
      if (!l || l.status !== 'ok') return;
      var c = classify(l.pcf, state.scale);
      out.push([
        i + 1, row.desc || '', l.dims[0], l.dims[1], l.dims[2], parseNumber(row.weight), l.units,
        l.cubeFt3.toFixed(3), l.cubeM3.toFixed(4), l.weightLb.toFixed(2), l.weightKg.toFixed(2),
        l.pcf.toFixed(2), l.kgm3.toFixed(2), c ? c.cls : ''
      ].map(csvCell).join(','));
    });
    var t = result.totals;
    if (t.lines) {
      out.push([
        'Total', '', '', '', '', '', t.units,
        t.cubeFt3.toFixed(3), t.cubeM3.toFixed(4), t.weightLb.toFixed(2), t.weightKg.toFixed(2),
        t.pcf.toFixed(2), t.kgm3.toFixed(2), result.classification ? result.classification.cls : ''
      ].map(csvCell).join(','));
    }
    return out.join('\r\n') + '\r\n';
  }

  /** Plain-text summary for pasting into an email, quote form or BOL note. */
  function buildSummary(state, result) {
    var L = labels(state.unit);
    var lines = ['Shipment density summary (HSSH FCalc)', ''];
    state.rows.forEach(function (row, i) {
      var l = result.lines[i];
      if (!l || l.status !== 'ok') return;
      var name = row.desc ? row.desc + ': ' : '';
      lines.push(
        (i + 1) + '. ' + name +
        l.dims.map(function (d) { return fmt(d, 3); }).join(' x ') + ' ' + L.len + ', ' +
        fmt(parseNumber(row.weight), 3) + ' ' + L.wt + (state.weightMode === 'total' ? ' total' : ' each') +
        ', ' + l.units + (l.units === 1 ? ' unit' : ' units')
      );
    });
    var t = result.totals;
    if (!t.lines) return lines.concat('No complete items yet.').join('\n');
    var scale = getScale(state.scale);
    lines.push(
      '',
      'Total cube:    ' + fmtFixed(t.cubeFt3) + ' cu ft (' + fmtFixed(t.cubeM3) + ' m³)',
      'Total weight:  ' + fmtFixed(t.weightLb) + ' lbs (' + fmtFixed(t.weightKg) + ' kg)',
      'Density:       ' + fmtFixed(t.pcf) + ' pcf (' + fmtFixed(t.kgm3) + ' kg/m³)',
      'Est. class:    ' + result.classification.cls + ' (' + scale.name + ' scale)'
    );
    if (state.rounding && state.rounding !== 'exact') {
      lines.push('Dimensions rounded ' + (state.rounding === 'up' ? 'up to the next whole ' : 'to the nearest whole ') + L.len + '.');
    }
    lines.push('', 'Estimate based on density only. Commodity, handling, liability and stowability can change the class.');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Drafts
  // ---------------------------------------------------------------------------

  // A draft keeps what describes each SKU. Units are left out on purpose:
  // quantities change from one shipment to the next.
  var DRAFT_FIELDS = ['desc', 'length', 'width', 'height', 'weight'];

  function cleanText(v) {
    return v == null ? '' : String(v).trim();
  }

  /**
   * Sheet rows -> draft rows. Drops lines with nothing typed and stores the
   * weight per unit, so a line-total weight is divided by its units first.
   */
  function toDraftRows(rows, weightMode) {
    return (rows || [])
      .filter(function (r) {
        return r && DRAFT_FIELDS.some(function (f) { return cleanText(r[f]) !== ''; });
      })
      .map(function (r) {
        var out = {};
        DRAFT_FIELDS.forEach(function (f) { out[f] = cleanText(r[f]); });
        if (weightMode === 'total') {
          var w = parseNumber(r.weight);
          var u = parseNumber(r.units);
          if (u === null) u = 1;
          if (w !== null && !isNaN(w) && !isNaN(u) && u > 0) out.weight = trimNumber(w / u, 4);
        }
        return out;
      });
  }

  /** Draft -> sheet rows in the given unit system, with units left blank. */
  function fromDraftRows(draft, unit) {
    var from = draft && draft.unit === 'metric' ? 'metric' : 'us';
    return ((draft && draft.rows) || []).map(function (r) {
      return {
        desc: cleanText(r.desc),
        length: convertField(cleanText(r.length), 'dim', from, unit),
        width: convertField(cleanText(r.width), 'dim', from, unit),
        height: convertField(cleanText(r.height), 'dim', from, unit),
        weight: convertField(cleanText(r.weight), 'weight', from, unit),
        units: ''
      };
    });
  }

  return {
    CM_PER_IN: CM_PER_IN,
    KG_PER_LB: KG_PER_LB,
    M3_PER_FT3: M3_PER_FT3,
    KGM3_PER_PCF: KGM3_PER_PCF,
    SCALES: SCALES,
    DEFAULT_SCALE: DEFAULT_SCALE,
    getScale: getScale,
    parseNumber: parseNumber,
    roundDimension: roundDimension,
    classify: classify,
    classHints: classHints,
    computeLine: computeLine,
    computeShipment: computeShipment,
    convertField: convertField,
    trimNumber: trimNumber,
    fmt: fmt,
    fmtFixed: fmtFixed,
    labels: labels,
    buildCsv: buildCsv,
    buildSummary: buildSummary,
    DRAFT_FIELDS: DRAFT_FIELDS,
    toDraftRows: toDraftRows,
    fromDraftRows: fromDraftRows
  };
});
