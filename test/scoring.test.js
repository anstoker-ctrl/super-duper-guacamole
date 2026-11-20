const test = require('node:test');
const assert = require('node:assert');
const S = require('../public/scoring.js');
const { parseCsv, clean } = require('../server.js');

test('acres from lotSize in sqft', () => {
  assert.strictEqual(S.acresOf({ lotSize: 43560 * 5 }), 5);
  assert.strictEqual(S.acresOf({}), null);
});

test('filters enforce price, acreage and state', () => {
  assert.ok(S.passes({ price: 250000, acres: 6, state: 'ID' }));
  assert.ok(!S.passes({ price: 350000, acres: 6, state: 'ID' }));
  assert.ok(!S.passes({ price: 250000, acres: 2, state: 'ID' }));
  assert.ok(!S.passes({ price: 250000, acres: 6, state: 'TX' }));
  assert.ok(S.passes({ price: 250000, state: 'ID' }), 'unknown acreage is kept');
  assert.ok(!S.passes({ price: 250000, acres: 6, state: 'ID', waterfront: null }, { requireWaterfront: true }));
});

test('waterfront, acreage and rental all raise the score', () => {
  const base = { price: 250000, acres: 5, state: 'CO' };
  const b = S.score(base).total;
  assert.ok(S.score({ ...base, waterfront: true }).total > b);
  assert.ok(S.score({ ...base, acres: 20 }).total > b);
  assert.ok(S.score({ ...base, nightlyRate: 150 }).total > b);
  assert.ok(S.score({ ...base, waterfront: true, acres: 20, nightlyRate: 150 }).total <= 100);
});

test('STR income uses occupancy and expenses', () => {
  const r = S.rentalIncome({ nightlyRate: 100, occupancy: 0.5 }, S.DEFAULT_PREFS);
  assert.strictEqual(Math.round(r.annual), Math.round(100 * 365 * 0.5 * 0.65));
});

test('CSV import handles quotes, aliases and money', () => {
  const rows = parseCsv('title,address,price,acres,water,occupancy\n"Cabin, big","1 Rd, Town, ID","$249,000",7.5,yes,40\n');
  assert.strictEqual(rows.length, 1);
  const l = clean(rows[0]);
  assert.strictEqual(l.title, 'Cabin, big');
  assert.strictEqual(l.formattedAddress, '1 Rd, Town, ID');
  assert.strictEqual(l.price, 249000);
  assert.strictEqual(l.acres, 7.5);
  assert.strictEqual(l.waterfront, true);
  assert.strictEqual(l.occupancy, 0.4);
});
