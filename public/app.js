/* global L, CabinScoring */
const S = CabinScoring;
const ALL_STATES = { WY: 'Wyoming', ID: 'Idaho', CO: 'Colorado', UT: 'Utah', NM: 'New Mexico', NV: 'Nevada', OR: 'Oregon', WA: 'Washington', CA: 'California', AZ: 'Arizona', MT: 'Montana' };
const $ = sel => document.querySelector(sel);
const fmt$ = n => (n > 0 ? '$' + Math.round(n).toLocaleString() : '—');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let listings = [];
let prefs = loadPrefs();
let mapPoint = null;
let editingId = null;

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('cabin-prefs') || '{}');
    return Object.assign({}, S.DEFAULT_PREFS, { favOnly: false, showHidden: false, sort: 'score' }, p);
  } catch { return Object.assign({}, S.DEFAULT_PREFS, { favOnly: false, showHidden: false, sort: 'score' }); }
}
function savePrefs() { try { localStorage.setItem('cabin-prefs', JSON.stringify(prefs)); } catch { /* ignore */ } }

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------- map ----------
// The map is optional: if Leaflet can't load (offline, CDN blocked) the list still works.
const hasMap = typeof L !== 'undefined';
const map = hasMap ? L.map('map').setView([41.5, -112], 5) : null;
if (hasMap) L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
else $('#map').innerHTML = '<p class="muted" style="padding:16px">Map unavailable (could not load Leaflet). Listings and city/state search still work.</p>';
const markers = hasMap ? L.layerGroup().addTo(map) : null;
let pointMarker = null;
if (hasMap) map.on('click', e => {
  mapPoint = e.latlng;
  if (pointMarker) pointMarker.remove();
  pointMarker = L.circleMarker(e.latlng, { radius: 7, color: '#b45309' }).addTo(map).bindTooltip('Search point');
  $('#s-point').textContent = `Point: ${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)}`;
  setMode('map');
});

// ---------- rendering ----------
function render() {
  const rows = listings
    .filter(l => (prefs.showHidden || !l.hidden) && (!prefs.favOnly || l.favorite) && S.passes(l, prefs))
    .map(l => ({ l, s: S.score(l, prefs) }));
  const sorters = {
    score: (a, b) => b.s.total - a.s.total,
    price: (a, b) => a.l.price - b.l.price,
    acres: (a, b) => (b.s.acres ?? -1) - (a.s.acres ?? -1),
    yield: (a, b) => (b.s.yieldPct ?? -1) - (a.s.yieldPct ?? -1),
  };
  rows.sort(sorters[prefs.sort] || sorters.score);

  const unknown = listings.filter(l => !l.hidden && S.acresOf(l) == null).length;
  $('#count').textContent = `${rows.length} of ${listings.length} listings match your filters` +
    (prefs.hideUnknownAcres && unknown ? ` (${unknown} hidden because acreage is unknown)` : '');
  $('#results').innerHTML = rows.map(({ l, s }) => card(l, s)).join('') || '<p class="muted">No matches. Loosen filters, search a new area, or add a listing.</p>';

  if (!hasMap) return;
  markers.clearLayers();
  for (const { l, s } of rows) {
    if (l.latitude == null || l.longitude == null) continue;
    const color = s.total >= 70 ? '#15803d' : s.total >= 50 ? '#ca8a04' : '#6b7280';
    L.circleMarker([l.latitude, l.longitude], { radius: 8, color, fillOpacity: 0.7 })
      .bindPopup(`<b>${esc(l.title)}</b><br>${fmt$(l.price)} · ${s.acres ? s.acres.toFixed(1) + ' ac' : '? ac'}<br>Score ${s.total}`)
      .on('click', () => document.getElementById('card-' + l.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      .addTo(markers);
  }
}

function card(l, s) {
  const water = s.water === true ? '💧 Waterfront' : s.water === false ? 'No water' : 'Water ?';
  const yieldTxt = s.yieldPct != null ? `${s.yieldPct.toFixed(1)}% net yield` : 'No rental estimate';
  const bar = (label, v, max) => `<div class="bar"><span>${label}</span><i style="width:${(v / max) * 100}%"></i><b>${v}/${max}</b></div>`;
  return `
  <article class="card ${l.hidden ? 'is-hidden' : ''}" id="card-${esc(l.id)}">
    <div class="score s${s.total >= 70 ? 'hi' : s.total >= 50 ? 'mid' : 'lo'}">${s.total}</div>
    <div class="body">
      <h3>${l.favorite ? '★ ' : ''}${esc(l.title)}</h3>
      <p class="muted small">${esc([l.city, l.state].filter(Boolean).join(', '))} · ${esc(l.source)}${l.propertyType ? ' · ' + esc(l.propertyType) : ''}${l.daysOnMarket != null ? ` · ${l.daysOnMarket}d on market` : ''}</p>
      <p class="facts"><b>${fmt$(l.price)}</b> · ${s.acres ? s.acres.toFixed(1) + ' acres' : 'acres ?'} · ${l.bedrooms ?? '?'} bd / ${l.bathrooms ?? '?'} ba${l.squareFootage ? ` · ${l.squareFootage.toLocaleString()} sqft` : ''} · ${water}</p>
      <p class="small">${esc(yieldTxt)} <span class="muted">(${esc(s.income.basis)}${s.income.annual ? `, ~${fmt$(s.income.annual)}/yr net` : ''})</span></p>
      <div class="bars">${bar('Acreage', s.parts.acreage, 30)}${bar('Water', s.parts.waterfront, 20)}${bar('Rental', s.parts.rental, 25)}${bar('Price', s.parts.price, 25)}</div>
      ${s.flags.length ? `<p class="flags">${s.flags.map(f => `<span>${esc(f)}</span>`).join('')}</p>` : ''}
      ${l.agent || l.office || l.mlsNumber ? `<p class="small muted">Listed by ${esc([l.agent, l.office].filter(Boolean).join(' · ') || 'unknown agent')}${l.mlsNumber ? ` · MLS #${esc(l.mlsNumber)}` : ''}</p>` : ''}
      ${l.notes ? `<p class="small notes">${esc(l.notes)}</p>` : ''}
      <div class="actions">
        <button data-act="fav" data-id="${esc(l.id)}">${l.favorite ? 'Unfavorite' : 'Favorite'}</button>
        <button data-act="edit" data-id="${esc(l.id)}">Edit / flag water</button>
        ${l.source === 'rentcast' ? `<button data-act="rent" data-id="${esc(l.id)}">Get rent estimate (1 call)</button>` : ''}
        ${/^https?:\/\//i.test(l.url || '') ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">Listing ↗</a>` : ''}
        ${l.formattedAddress ? `<a target="_blank" rel="noopener" href="${esc(zillowUrl(l.formattedAddress))}">Zillow ↗</a>` : ''}
        ${l.formattedAddress ? `<a target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(`"${l.formattedAddress}" for sale`)}">Google ↗</a>` : ''}
        ${l.formattedAddress || l.latitude ? `<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.formattedAddress || `${l.latitude},${l.longitude}`)}">Satellite ↗</a>` : ''}
        <button data-act="hide" data-id="${esc(l.id)}">${l.hidden ? 'Unhide' : 'Hide'}</button>
        ${l.source !== 'rentcast' ? `<button data-act="del" data-id="${esc(l.id)}" class="danger">Delete</button>` : ''}
      </div>
    </div>
  </article>`;
}

// Zillow address search, e.g. https://www.zillow.com/homes/1-Main-St,-Kamas,-UT-84036_rb/
function zillowUrl(address) {
  return 'https://www.zillow.com/homes/' + encodeURIComponent(address.trim().replace(/\s+/g, '-')).replace(/%2C/g, ',') + '_rb/';
}

async function update(id, patch) {
  const l = await api('/api/listings/' + id, { method: 'PUT', body: patch });
  listings = listings.map(x => (x.id === id ? l : x));
  render();
}

$('#results').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const l = listings.find(x => x.id === id);
  try {
    if (btn.dataset.act === 'fav') await update(id, { favorite: !l.favorite });
    if (btn.dataset.act === 'hide') await update(id, { hidden: !l.hidden });
    if (btn.dataset.act === 'edit') openEdit(l);
    if (btn.dataset.act === 'del' && confirm('Delete this listing?')) {
      await api('/api/listings/' + id, { method: 'DELETE' });
      listings = listings.filter(x => x.id !== id); render();
    }
    if (btn.dataset.act === 'rent') {
      btn.disabled = true; btn.textContent = 'Estimating…';
      const r = await api(`/api/listings/${id}/rent-estimate`, { method: 'POST' });
      listings = listings.map(x => (x.id === id ? r.listing : x));
      showUsage(r.usage); render();
    }
  } catch (err) { alert(err.message); render(); }
});

// ---------- edit / add ----------
function openEdit(l) {
  editingId = l ? l.id : null;
  $('#edit-title').textContent = l ? 'Edit listing' : 'Add a listing';
  const f = $('#edit-form');
  f.reset();
  if (l) {
    for (const el of f.elements) {
      if (!el.name) continue;
      let v = l[el.name];
      if (el.name === 'acres' && v == null) v = S.acresOf(l)?.toFixed(2);
      if (el.name === 'occupancy' && v) v = Math.round(v * 100);
      if (el.name === 'waterfront') v = v === true ? 'yes' : v === false ? 'no' : '';
      el.value = v ?? '';
    }
  }
  $('#dlg-edit').showModal();
}
$('#btn-add').onclick = () => openEdit(null);
$('#dlg-edit').addEventListener('close', async () => {
  if ($('#dlg-edit').returnValue !== 'save') return;
  const body = Object.fromEntries(new FormData($('#edit-form')));
  try {
    if (editingId) await update(editingId, body);
    else { const l = await api('/api/listings', { method: 'POST', body }); listings.push(l); render(); }
  } catch (err) { alert(err.message); }
});

// ---------- import ----------
$('#btn-import').onclick = () => { $('#import-text').value = ''; $('#import-file').value = ''; $('#dlg-import').showModal(); };
$('#import-file').onchange = async e => { const f = e.target.files[0]; if (f) $('#import-text').value = await f.text(); };
$('#dlg-import').addEventListener('close', async () => {
  if ($('#dlg-import').returnValue !== 'import') return;
  try {
    const r = await api('/api/import', { method: 'POST', body: { csv: $('#import-text').value } });
    alert(`Imported ${r.added} listing(s).`);
    await refresh();
  } catch (err) { alert(err.message); }
});

// ---------- search ----------
const mode = () => document.querySelector('input[name=s-mode]:checked').value;
const checkedSearchStates = () => [...document.querySelectorAll('#s-states input:checked')].map(i => i.value);
function setMode(m) {
  document.querySelector(`input[name=s-mode][value=${m}]`).checked = true;
  for (const k of ['states', 'place', 'map']) $('#mode-' + k).hidden = k !== m;
  updateSearchButton();
}
function updateSearchButton() {
  const n = checkedSearchStates().length;
  $('#btn-search').textContent = mode() === 'states' ? `Search ${n} state${n === 1 ? '' : 's'} (up to ${n} search${n === 1 ? '' : 'es'})` : 'Search (uses 1 search)';
}
function bindSearch() {
  const saved = Array.isArray(prefs.searchStates) ? prefs.searchStates : prefs.states;
  $('#s-states').innerHTML = Object.keys(ALL_STATES).map(s => `<label class="row"><input type="checkbox" value="${s}" ${saved.includes(s) ? 'checked' : ''}> ${s}</label>`).join('');
  const onStates = () => { prefs.searchStates = checkedSearchStates(); savePrefs(); updateSearchButton(); };
  $('#s-states').addEventListener('change', onStates);
  $('#s-all').onclick = () => { document.querySelectorAll('#s-states input').forEach(i => { i.checked = true; }); onStates(); };
  $('#s-none').onclick = () => { document.querySelectorAll('#s-states input').forEach(i => { i.checked = false; }); onStates(); };
  document.querySelectorAll('input[name=s-mode]').forEach(r => r.addEventListener('change', () => setMode(mode())));
  setMode('states');
}

async function searchStates(status) {
  const states = checkedSearchStates();
  if (!states.length) return alert('Check at least one state.');
  const q = new URLSearchParams({ states: states.join(','), maxPrice: prefs.maxPrice });
  if ($('#s-refresh').checked) q.set('refresh', '1');
  const cost = await api('/api/search/cost?' + q);
  if (cost.calls > cost.remaining) {
    return alert(`This needs ${cost.calls} searches but you have ${cost.remaining} left this month. Uncheck some states.`);
  }
  if (cost.calls > 0 && !confirm(`This will use ${cost.calls} of your ${cost.remaining} remaining searches this month` +
    (cost.calls < states.length ? ` (${states.length - cost.calls} state(s) were searched in the last 24 hours and are free).` : '.') + ' Continue?')) return;
  status.textContent = `Searching ${states.length} state(s)… this can take a minute.`;
  const r = await api('/api/search/states?' + q);
  const lines = r.results.map(x => x.ok
    ? `${x.state}: ${x.matched} homes under your max price (${x.added} new)${x.fromCache ? ', from earlier search' : ''}${x.capped ? ' — hit the 500 limit, some homes may be missing' : ''}`
    : `${x.state}: ${x.error}`);
  status.innerHTML = lines.map(esc).join('<br>');
  showUsage(r.usage);
  await refresh();
}

$('#btn-search').onclick = async () => {
  const status = $('#search-status');
  if (mode() === 'states') {
    try { await searchStates(status); } catch (err) { status.textContent = err.message; }
    return;
  }
  const q = new URLSearchParams({ maxPrice: prefs.maxPrice });
  if (mode() === 'map') {
    if (!mapPoint) return alert('Click the map to choose a search point first.');
    q.set('latitude', mapPoint.lat.toFixed(5)); q.set('longitude', mapPoint.lng.toFixed(5)); q.set('radius', $('#s-radius').value || 50);
  } else {
    q.set('state', $('#s-state').value);
    if ($('#s-city').value.trim()) q.set('city', $('#s-city').value.trim());
    if ($('#s-zip').value.trim()) q.set('zipCode', $('#s-zip').value.trim());
    if (!q.get('city') && !q.get('zipCode')) return alert('Type a city or ZIP, or choose "Whole states".');
  }
  if ($('#s-refresh').checked) q.set('refresh', '1');
  status.textContent = 'Searching…';
  try {
    const r = await api('/api/search?' + q);
    status.textContent = `${r.fromCache ? 'From cache: ' : ''}${r.totalReturned} listings returned, ${r.matched} homes under your max price (${r.added} new).`;
    showUsage(r.usage);
    await refresh();
  } catch (err) { status.textContent = err.message; }
};

function showUsage(u) { $('#usage').textContent = u ? `RentCast: ${u.used}/${u.limit} calls this month` : ''; }

// ---------- filters ----------
function bindFilters() {
  $('#s-state').innerHTML = prefs.states.concat(Object.keys(ALL_STATES).filter(s => !prefs.states.includes(s)))
    .map(s => `<option value="${s}">${ALL_STATES[s] || s}</option>`).join('');
  $('#f-states').innerHTML = Object.keys(ALL_STATES).map(s => `<label class="row"><input type="checkbox" value="${s}" ${prefs.states.includes(s) ? 'checked' : ''}> ${s}</label>`).join('');
  $('#f-price').value = prefs.maxPrice;
  $('#f-acres').value = prefs.minAcres;
  $('#f-require-acres').checked = prefs.requireAcres;
  $('#f-hide-unknown').checked = prefs.hideUnknownAcres;
  $('#f-water').checked = prefs.requireWaterfront;
  $('#f-fav').checked = prefs.favOnly;
  $('#f-hidden').checked = prefs.showHidden;
  $('#f-occ').value = Math.round(prefs.defaultOccupancy * 100);
  $('#f-sort').value = prefs.sort;

  const onChange = () => {
    prefs.maxPrice = Number($('#f-price').value) || S.DEFAULT_PREFS.maxPrice;
    prefs.minAcres = Number($('#f-acres').value) || 0.01;
    prefs.requireAcres = $('#f-require-acres').checked;
    prefs.hideUnknownAcres = $('#f-hide-unknown').checked;
    prefs.requireWaterfront = $('#f-water').checked;
    prefs.favOnly = $('#f-fav').checked;
    prefs.showHidden = $('#f-hidden').checked;
    prefs.defaultOccupancy = (Number($('#f-occ').value) || 45) / 100;
    prefs.sort = $('#f-sort').value;
    prefs.states = [...document.querySelectorAll('#f-states input:checked')].map(i => i.value);
    savePrefs(); render();
  };
  document.querySelectorAll('aside section:nth-of-type(2) input, aside section:nth-of-type(2) select').forEach(el => el.addEventListener('change', onChange));
}

$('#btn-clear-samples').onclick = async () => {
  if (!confirm('Remove all SAMPLE listings?')) return;
  await api('/api/samples', { method: 'DELETE' });
  await refresh();
};

async function refresh() { listings = await api('/api/listings'); render(); }

(async function init() {
  bindFilters();
  bindSearch();
  const cfg = await api('/api/config');
  $('#key-warning').hidden = cfg.hasKey;
  $('#btn-search').disabled = !cfg.hasKey;
  if (cfg.hasKey) showUsage(cfg.usage);
  await refresh();
})();
