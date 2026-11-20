// Cabin scoring + filtering. Shared by the browser app and the Node tests.
(function (root) {
  const SQFT_PER_ACRE = 43560;

  const DEFAULT_PREFS = {
    states: ['WY', 'ID', 'CO', 'UT', 'NM', 'NV', 'OR', 'WA', 'CA', 'AZ'],
    maxPrice: 300000,
    minAcres: 5,
    requireAcres: true,      // drop listings below minAcres
    hideUnknownAcres: true,  // drop listings with no acreage on record
    requireWaterfront: false,
    defaultOccupancy: 0.45,  // short-term rental occupancy when a nightly rate is entered
    expenseRatio: 0.35,      // share of STR revenue lost to fees, cleaning, utilities, etc.
  };

  const WATER_WORDS = /\b(lake|lakefront|waterfront|river|riverfront|creek|stream|pond|reservoir|frontage|shoreline|dock|beach)\b/i;

  function acresOf(l) {
    if (typeof l.acres === 'number' && l.acres > 0) return l.acres;
    if (typeof l.lotSize === 'number' && l.lotSize > 0) return l.lotSize / SQFT_PER_ACRE;
    return null;
  }

  // true / false when known, null when unknown. Text hints only suggest, never confirm.
  function waterfrontOf(l) {
    if (l.waterfront === true || l.waterfront === false) return l.waterfront;
    return null;
  }

  function waterHint(l) {
    return WATER_WORDS.test([l.description, l.notes, l.title, l.formattedAddress].filter(Boolean).join(' '));
  }

  // Estimated annual net rental income and where it came from.
  function rentalIncome(l, prefs) {
    if (l.nightlyRate > 0) {
      const occ = l.occupancy > 0 ? l.occupancy : prefs.defaultOccupancy;
      const gross = l.nightlyRate * 365 * occ;
      return { annual: gross * (1 - prefs.expenseRatio), basis: `STR $${l.nightlyRate}/night @ ${Math.round(occ * 100)}%` };
    }
    if (l.rentEstimate > 0) {
      return { annual: l.rentEstimate * 12 * 0.8, basis: `Long-term rent $${Math.round(l.rentEstimate)}/mo` };
    }
    return { annual: null, basis: 'No rent data' };
  }

  function score(l, prefsIn) {
    const prefs = Object.assign({}, DEFAULT_PREFS, prefsIn || {});
    const acres = acresOf(l);
    const water = waterfrontOf(l);
    const income = rentalIncome(l, prefs);
    const parts = {};

    // Acreage: 30 pts. Hitting the minimum earns 20, up to +10 more at 4x the minimum.
    if (acres == null) parts.acreage = 0;
    else if (acres < prefs.minAcres) parts.acreage = 20 * (acres / prefs.minAcres);
    else parts.acreage = 20 + 10 * Math.min(1, (acres - prefs.minAcres) / (prefs.minAcres * 3));

    // Waterfront: 20 pts if confirmed, 5 if text hints at water but unconfirmed.
    parts.waterfront = water === true ? 20 : water === null && waterHint(l) ? 5 : 0;

    // Rental income: 25 pts, scaled on net yield; 10%+ net yield is full marks.
    let yieldPct = null;
    if (income.annual != null && l.price > 0) {
      yieldPct = (income.annual / l.price) * 100;
      parts.rental = 25 * Math.min(1, Math.max(0, yieldPct) / 10);
    } else parts.rental = 0;

    // Price: 25 pts, cheaper relative to budget is better.
    parts.price = l.price > 0 ? 25 * Math.max(0, 1 - 0.7 * (l.price / prefs.maxPrice)) : 0;

    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    const flags = [];
    if (acres == null) flags.push('Acreage unknown');
    if (water === null) flags.push(waterHint(l) ? 'Possible water — confirm' : 'Waterfront unknown');
    if (income.annual == null) flags.push('No rental estimate');

    return {
      total: Math.round(total),
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      acres, water, yieldPct, income, flags,
    };
  }

  function passes(l, prefsIn) {
    const prefs = Object.assign({}, DEFAULT_PREFS, prefsIn || {});
    if (!(l.price > 0) || l.price > prefs.maxPrice) return false;
    if (prefs.states.length && l.state && !prefs.states.includes(String(l.state).toUpperCase())) return false;
    const acres = acresOf(l);
    if (acres == null && prefs.hideUnknownAcres) return false;
    if (prefs.requireAcres && acres != null && acres < prefs.minAcres) return false;
    if (prefs.requireWaterfront && waterfrontOf(l) !== true) return false;
    return true;
  }

  const api = { DEFAULT_PREFS, SQFT_PER_ACRE, acresOf, waterfrontOf, waterHint, rentalIncome, score, passes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CabinScoring = api;
})(typeof window !== 'undefined' ? window : globalThis);
