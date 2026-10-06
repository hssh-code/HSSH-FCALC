// Run with: npm test   (or: node --test tests/)
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/calc.js');

const close = (actual, expected, places = 2) =>
  assert.equal(Number(actual.toFixed(places)), expected, `${actual} should round to ${expected}`);

const US = { unit: 'us', weightMode: 'unit', rounding: 'exact', scale: 'nmfc2025' };

test('matches the reference example (two carton lines, US units)', () => {
  const rows = [
    { length: '12.375', width: '8.375', height: '4.625', weight: '2.3', units: '9' },
    { length: '9.375', width: '6.375', height: '7.625', weight: '1.7', units: '6' }
  ];
  const r = F.computeShipment(rows, US);
  close(r.totals.cubeFt3, 4.08);
  close(r.totals.cubeM3, 0.12);
  close(r.totals.weightLb, 30.9);
  close(r.totals.weightKg, 14.02);
  close(r.totals.pcf, 7.58);
  close(r.totals.kgm3, 121.35);
  assert.equal(r.classification.cls, 125);
});

test('fractions give the same result as decimals', () => {
  const rows = [
    { length: '12 3/8', width: '8-3/8', height: '4 5/8', weight: '2.3', units: '9' },
    { length: '9 3/8', width: '6 3/8', height: '7 5/8', weight: '1.7', units: '6' }
  ];
  const r = F.computeShipment(rows, US);
  close(r.totals.pcf, 7.58);
  assert.equal(r.classification.cls, 125);
});

test('parseNumber handles decimals, fractions, blanks and junk', () => {
  assert.equal(F.parseNumber('12.5'), 12.5);
  assert.equal(F.parseNumber('.5'), 0.5);
  assert.equal(F.parseNumber('12.'), 12);
  assert.equal(F.parseNumber('3/8'), 0.375);
  assert.equal(F.parseNumber('12 1/2'), 12.5);
  assert.equal(F.parseNumber('12-1/2'), 12.5);
  assert.equal(F.parseNumber('  7  '), 7);
  assert.equal(F.parseNumber(''), null);
  assert.equal(F.parseNumber(null), null);
  assert.ok(Number.isNaN(F.parseNumber('abc')));
  assert.ok(Number.isNaN(F.parseNumber('1/0')));
  assert.ok(Number.isNaN(F.parseNumber('-4')));
  assert.ok(Number.isNaN(F.parseNumber('1,000')));
});

test('NMFC 2025 boundaries: lower bound is inclusive', () => {
  const cases = [
    [0.5, 400], [1, 300], [1.99, 300], [2, 250], [3.99, 250], [4, 175],
    [5.999, 175], [6, 125], [8, 100], [10, 92.5], [12, 85], [15, 70],
    [22.5, 65], [30, 60], [35, 55], [49.99, 55], [50, 50], [500, 50]
  ];
  for (const [pcf, cls] of cases) assert.equal(F.classify(pcf, 'nmfc2025').cls, cls, `${pcf} pcf`);
});

test('legacy 18-class boundaries', () => {
  const cases = [
    [0.9, 500], [1, 400], [2.5, 300], [3, 250], [4.5, 200], [5, 175], [6.5, 150],
    [7.58, 125], [8.5, 110], [9, 100], [10.5, 92.5], [12, 85], [13.5, 77.5],
    [15, 70], [22.5, 65], [30, 60], [35, 55], [50, 50]
  ];
  for (const [pcf, cls] of cases) assert.equal(F.classify(pcf, 'legacy18').cls, cls, `${pcf} pcf`);
});

test('floating point noise at a boundary does not drop a class', () => {
  assert.equal(F.classify(7.9999999999999, 'nmfc2025').cls, 100);
});

test('metric input gives the same class as the equivalent US input', () => {
  const us = F.computeShipment([{ length: 48, width: 40, height: 50, weight: 600, units: 1 }], US);
  const metric = F.computeShipment(
    [{ length: 48 * 2.54, width: 40 * 2.54, height: 50 * 2.54, weight: 600 * F.KG_PER_LB, units: 1 }],
    { ...US, unit: 'metric' }
  );
  close(metric.totals.pcf, Number(us.totals.pcf.toFixed(2)));
  assert.equal(metric.classification.cls, us.classification.cls);
  close(metric.totals.kgm3, Number((us.totals.pcf * F.KGM3_PER_PCF).toFixed(2)));
});

test('weight mode "total" does not multiply weight by units', () => {
  const row = { length: 12, width: 12, height: 12, weight: 20, units: 4 };
  const perUnit = F.computeLine(row, US);
  const total = F.computeLine(row, { ...US, weightMode: 'total' });
  assert.equal(perUnit.weightLb, 80);
  assert.equal(total.weightLb, 20);
  assert.equal(total.cubeFt3, 4);
});

test('dimension rounding modes', () => {
  const row = { length: '12 3/8', width: '8.5', height: '4.25', weight: 10, units: 1 };
  assert.deepEqual(F.computeLine(row, { ...US, rounding: 'exact' }).dims, [12.375, 8.5, 4.25]);
  assert.deepEqual(F.computeLine(row, { ...US, rounding: 'nearest' }).dims, [12, 9, 4]);
  assert.deepEqual(F.computeLine(row, { ...US, rounding: 'up' }).dims, [13, 9, 5]);
  assert.equal(F.roundDimension(12, 'up'), 12);
});

test('blank units default to 1; row status reflects what is missing or wrong', () => {
  assert.equal(F.computeLine({ length: 10, width: 10, height: 10, weight: 5 }, US).units, 1);
  assert.equal(F.computeLine({}, US).status, 'empty');
  const inc = F.computeLine({ length: 10, width: 10 }, US);
  assert.equal(inc.status, 'incomplete');
  assert.deepEqual(inc.missing, ['height', 'weight']);
  const bad = F.computeLine({ length: 'x', width: 10, height: 0, weight: 5, units: '1.5' }, US);
  assert.equal(bad.status, 'invalid');
  assert.deepEqual(Object.keys(bad.errors).sort(), ['height', 'length', 'units']);
});

test('incomplete and invalid lines are left out of the totals', () => {
  const r = F.computeShipment([
    { length: 12, width: 12, height: 12, weight: 10, units: 1 },
    { length: 12, width: 12 },
    { length: 'abc', width: 12, height: 12, weight: 10 }
  ], US);
  assert.equal(r.totals.lines, 1);
  assert.equal(r.totals.weightLb, 10);
  assert.equal(r.classification.cls, 92.5);
});

test('no complete lines means no class', () => {
  const r = F.computeShipment([{}, { length: 5 }], US);
  assert.equal(r.classification, null);
  assert.equal(r.totals.pcf, null);
});

test('class hints: what it takes to reach the next class', () => {
  // 1 cu ft at 7 lbs = 7 pcf, class 125. Class 100 starts at 8 pcf.
  const r = F.computeShipment([{ length: 12, width: 12, height: 12, weight: 7, units: 1 }], US);
  const h = r.hints;
  assert.equal(h.toLower.cls, 100);
  close(h.toLower.addWeightLb, 1);
  close(h.toLower.cutCubeFt3, 0.13);
  assert.equal(h.margin.cls, 175);
  close(h.margin.densityPcf, 1);
  close(h.margin.weightLb, 1);
});

test('class hints at the ends of the scale', () => {
  const top = F.computeShipment([{ length: 12, width: 12, height: 12, weight: 60 }], US).hints;
  assert.equal(top.toLower, null);
  assert.equal(top.margin.cls, 55);
  const bottom = F.computeShipment([{ length: 12, width: 12, height: 12, weight: 0.5 }], US).hints;
  assert.equal(bottom.margin, null);
  assert.equal(bottom.toLower.cls, 300);
});

test('convertField converts between systems and leaves junk alone', () => {
  assert.equal(F.convertField('10', 'dim', 'us', 'metric'), '25.4');
  assert.equal(F.convertField('12 3/8', 'dim', 'us', 'metric'), '31.4325');
  assert.equal(F.convertField('2.3', 'weight', 'us', 'metric'), '1.0433');
  assert.equal(F.convertField('25.4', 'dim', 'metric', 'us'), '10');
  assert.equal(F.convertField('abc', 'dim', 'us', 'metric'), 'abc');
  assert.equal(F.convertField('', 'dim', 'us', 'metric'), '');
});

test('CSV export has a header, one row per complete line and a total', () => {
  const state = {
    unit: 'us', weightMode: 'unit', rounding: 'exact', scale: 'nmfc2025',
    rows: [
      { desc: 'Carton, "A"', length: '12.375', width: '8.375', height: '4.625', weight: '2.3', units: '9' },
      { desc: '', length: '', width: '', height: '', weight: '', units: '' },
      { desc: 'Carton B', length: '9.375', width: '6.375', height: '7.625', weight: '1.7', units: '6' }
    ]
  };
  const csv = F.buildCsv(state, F.computeShipment(state.rows, state)).trim().split('\r\n');
  assert.equal(csv.length, 4);
  assert.match(csv[0], /^Item,Description,Length \(in\)/);
  assert.match(csv[1], /^1,"Carton, ""A""",12.375,/);
  assert.match(csv[2], /^3,Carton B,/);
  assert.match(csv[3], /^Total,.*,7\.58,121\.35,125$/);
});

test('summary text includes totals and the scale used', () => {
  const state = {
    unit: 'us', weightMode: 'unit', rounding: 'up', scale: 'nmfc2025',
    rows: [{ desc: 'Box', length: 12, width: 12, height: 12, weight: 7, units: 2 }]
  };
  const text = F.buildSummary(state, F.computeShipment(state.rows, state));
  assert.match(text, /1\. Box: 12 x 12 x 12 in, 7 lbs each, 2 units/);
  assert.match(text, /Total cube:\s+2\.00 cu ft/);
  assert.match(text, /Est\. class:\s+125 \(NMFC 2025 scale\)/);
  assert.match(text, /rounded up to the next whole in/);
});
