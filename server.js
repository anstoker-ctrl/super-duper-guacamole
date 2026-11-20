// Cabin Finder: zero-dependency Node server.
// Serves the web app, proxies RentCast (so the API key never reaches the browser),
// and stores your listings, flags and notes in data/store.json.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const RENTCAST_KEY = process.env.RENTCAST_API_KEY || '';
const RENTCAST_BASE = process.env.RENTCAST_BASE_URL || 'https://api.rentcast.io/v1';
const MONTHLY_LIMIT = Number(process.env.RENTCAST_MONTHLY_LIMIT) || 50;
const CACHE_HOURS = 24;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.CABIN_DATA_DIR || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const SAMPLE_FILE = path.join(__dirname, 'sample-listings.json');

// RentCast has no "cabin" type; keep detached homes and manufactured/mobile homes.
const KEEP_TYPES = new Set(['Single Family', 'Manufactured', 'Mobile Home', 'Multi-Family']);

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---------- storage ----------
function loadStore() {
  if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  const store = { listings: {}, cache: {}, usage: { month: monthKey(), count: 0 } };
  for (const l of JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'))) store.listings[l.id] = l;
  return store;
}
let store = loadStore();
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}
function monthKey() { return new Date().toISOString().slice(0, 7); }
function usage() {
  if (store.usage.month !== monthKey()) store.usage = { month: monthKey(), count: 0 };
  return { used: store.usage.count, limit: MONTHLY_LIMIT, month: store.usage.month };
}

// ---------- RentCast ----------
async function rentcast(endpoint, params) {
  if (!RENTCAST_KEY) throw httpError(400, 'No RENTCAST_API_KEY set. Add it to .env and restart.');
  if (usage().used >= MONTHLY_LIMIT) {
    throw httpError(429, `Monthly RentCast budget of ${MONTHLY_LIMIT} calls reached. Raise RENTCAST_MONTHLY_LIMIT in .env if your plan allows.`);
  }
  const url = new URL(RENTCAST_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  store.usage.count++;
  save();
  const res = await fetch(url, { headers: { 'X-Api-Key': RENTCAST_KEY, Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw httpError(res.status, `RentCast ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function fromRentcast(r) {
  return {
    id: 'rc_' + String(r.id).replace(/[^\w-]/g, '_'),
    source: 'rentcast',
    title: r.formattedAddress || r.addressLine1,
    formattedAddress: r.formattedAddress,
    city: r.city, state: r.state, zipCode: r.zipCode, county: r.county,
    latitude: r.latitude, longitude: r.longitude,
    propertyType: r.propertyType,
    bedrooms: r.bedrooms, bathrooms: r.bathrooms, squareFootage: r.squareFootage,
    lotSize: r.lotSize, yearBuilt: r.yearBuilt,
    price: r.price, status: r.status, listedDate: r.listedDate, daysOnMarket: r.daysOnMarket,
    mlsNumber: r.mlsNumber,
    agent: r.listingAgent ? [r.listingAgent.name, r.listingAgent.phone, r.listingAgent.email].filter(Boolean).join(' · ') : '',
    url: '',
    waterfront: null,
  };
}

async function search(q) {
  const params = {
    status: 'Active',
    limit: 500,
    state: (q.state || '').toUpperCase(),
    city: q.city, zipCode: q.zipCode,
  };
  if (q.latitude && q.longitude) {
    Object.assign(params, { latitude: q.latitude, longitude: q.longitude, radius: q.radius || 50 });
    delete params.state; delete params.city; delete params.zipCode;
  }
  if (!params.state && !params.zipCode && !params.latitude) throw httpError(400, 'Pick a state, ZIP, or map point to search.');

  const key = JSON.stringify(params);
  const cached = store.cache[key];
  let raw, fromCache = false;
  if (cached && !q.refresh && Date.now() - cached.at < CACHE_HOURS * 3600e3) {
    raw = cached.results; fromCache = true;
  } else {
    raw = await rentcast('/listings/sale', params);
    store.cache[key] = { at: Date.now(), results: raw };
  }
  const maxPrice = Number(q.maxPrice) || Infinity;
  let added = 0;
  const ids = [];
  for (const r of raw) {
    if (r.propertyType && !KEEP_TYPES.has(r.propertyType)) continue;
    if (!(r.price > 0) || r.price > maxPrice) continue;
    const fresh = fromRentcast(r);
    const existing = store.listings[fresh.id];
    // Keep the user's own edits (waterfront, notes, rates) when refreshing.
    store.listings[fresh.id] = existing ? Object.assign(fresh, pickUserFields(existing)) : fresh;
    if (!existing) added++;
    ids.push(fresh.id);
  }
  save();
  return { fromCache, totalReturned: raw.length, matched: ids.length, added, ids, usage: usage() };
}

const USER_FIELDS = ['waterfront', 'notes', 'nightlyRate', 'occupancy', 'rentEstimate', 'favorite', 'hidden', 'acres', 'url', 'description'];
function pickUserFields(l) {
  const out = {};
  for (const f of USER_FIELDS) if (l[f] !== undefined && l[f] !== null && l[f] !== '') out[f] = l[f];
  return out;
}

async function rentEstimate(id) {
  const l = store.listings[id];
  if (!l) throw httpError(404, 'Listing not found');
  if (!l.formattedAddress) throw httpError(400, 'Listing needs a full address for a rent estimate.');
  const r = await rentcast('/avm/rent/long-term', {
    address: l.formattedAddress,
    propertyType: l.propertyType || 'Single Family',
    bedrooms: l.bedrooms, bathrooms: l.bathrooms, squareFootage: l.squareFootage,
  });
  l.rentEstimate = r.rent;
  l.rentRange = [r.rentRangeLow, r.rentRangeHigh];
  save();
  return { listing: l, usage: usage() };
}

// ---------- manual entry / CSV ----------
const NUM_FIELDS = ['price', 'acres', 'lotSize', 'bedrooms', 'bathrooms', 'squareFootage', 'yearBuilt', 'latitude', 'longitude', 'nightlyRate', 'occupancy', 'rentEstimate'];
function clean(input) {
  const l = {};
  const allowed = new Set([...NUM_FIELDS, ...USER_FIELDS, 'title', 'formattedAddress', 'city', 'state', 'zipCode', 'propertyType', 'agent', 'source']);
  for (const [k, v] of Object.entries(input || {})) {
    if (!allowed.has(k)) continue;
    if (NUM_FIELDS.includes(k)) {
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s%]/g, ''));
      if (!Number.isNaN(n)) l[k] = k === 'occupancy' && n > 1 ? n / 100 : n;
      else if (v === '' || v === null) l[k] = null;
    } else if (k === 'waterfront') {
      l[k] = v === true || /^(y|yes|true|1)$/i.test(String(v)) ? true : v === false || /^(n|no|false|0)$/i.test(String(v)) ? false : null;
    } else if (k === 'favorite' || k === 'hidden') l[k] = Boolean(v);
    else l[k] = v == null ? '' : String(v).trim();
  }
  if (l.state) l.state = l.state.toUpperCase().slice(0, 2);
  return l;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(x => x.trim()));
  if (nonEmpty.length < 2) return [];
  const aliases = { address: 'formattedAddress', link: 'url', listing: 'url', lot_acres: 'acres', 'lot acres': 'acres', beds: 'bedrooms', baths: 'bathrooms', sqft: 'squareFootage', nightly: 'nightlyRate', 'nightly rate': 'nightlyRate', water: 'waterfront', zip: 'zipCode' };
  const header = nonEmpty[0].map(h => { const k = h.trim(); return aliases[k.toLowerCase()] || k; });
  return nonEmpty.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function addManual(input) {
  const l = clean(input);
  l.id = 'm_' + crypto.randomBytes(6).toString('hex');
  l.source = 'manual';
  if (!l.title) l.title = l.formattedAddress || [l.city, l.state].filter(Boolean).join(', ') || 'Untitled cabin';
  if (l.waterfront === undefined) l.waterfront = null;
  store.listings[l.id] = l;
  return l;
}

// ---------- HTTP ----------
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e6) reject(httpError(413, 'Body too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(httpError(400, 'Invalid JSON')); } });
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/config' && req.method === 'GET') return send(res, 200, { hasKey: Boolean(RENTCAST_KEY), usage: usage() });
    if (p === '/api/listings' && req.method === 'GET') return send(res, 200, Object.values(store.listings));
    if (p === '/api/listings' && req.method === 'POST') { const l = addManual(await readBody(req)); save(); return send(res, 201, l); }
    if (p === '/api/import' && req.method === 'POST') {
      const { csv } = await readBody(req);
      const rows = parseCsv(String(csv || ''));
      const added = rows.map(addManual);
      save();
      return send(res, 201, { added: added.length });
    }
    if (p === '/api/samples' && req.method === 'DELETE') {
      for (const [id, l] of Object.entries(store.listings)) if (l.source === 'sample') delete store.listings[id];
      save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/search' && req.method === 'GET') return send(res, 200, await search(Object.fromEntries(url.searchParams)));
    let m = p.match(/^\/api\/listings\/([\w-]+)$/);
    if (m && req.method === 'PUT') {
      const l = store.listings[m[1]];
      if (!l) throw httpError(404, 'Listing not found');
      Object.assign(l, clean(await readBody(req)));
      save();
      return send(res, 200, l);
    }
    if (m && req.method === 'DELETE') { delete store.listings[m[1]]; save(); return send(res, 200, { ok: true }); }
    m = p.match(/^\/api\/listings\/([\w-]+)\/rent-estimate$/);
    if (m && req.method === 'POST') return send(res, 200, await rentEstimate(m[1]));
    if (p.startsWith('/api/')) throw httpError(404, 'Not found');

    // static files
    const file = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

if (require.main === module) {
  http.createServer(handle).listen(PORT, () => {
    console.log(`Cabin Finder running at http://localhost:${PORT}`);
    console.log(RENTCAST_KEY ? `RentCast key loaded (${usage().used}/${MONTHLY_LIMIT} calls used this month).` : 'No RentCast key: search is off. Manual entry, CSV import and sample data still work.');
  });
}

module.exports = { handle, parseCsv, clean, fromRentcast };
