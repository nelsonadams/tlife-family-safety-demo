'use strict';
const D = window.INSIGHTS;
const $ = (s) => document.querySelector(s);
const NC = D.cells.length;
const CAPTURE = 0.018;          // share of addressable short trips Lime could win
const RIDES_PER_UNIT = 2.5;     // rides one staged vehicle serves in a planning block
const FIELDS = 5;

const state = {
  dt: 'wd', fleet: 'scooter', layer: 'score', hour: 8, teens: false, k: 10, eps: 1.0,
  w: { demand: 0.5, foot: 0.2, transit: 0.15, net: 0.15 },
  selected: null, playing: false, tab: 'now',
};

// ---------- deterministic Laplace noise (stable across slider moves) ----------
function hash(a, b, c, d) {
  let h = 2166136261 ^ a; h = Math.imul(h ^ (b + 0x9e37), 16777619); h = Math.imul(h ^ (c + 0x85eb), 16777619);
  h = Math.imul(h ^ (d + 0xc2b2), 16777619); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return ((h >>> 0) % 1e6 + 0.5) / 1e6;
}
function laplace(u, b) { const v = u - 0.5; return -b * Math.sign(v) * Math.log(1 - 2 * Math.abs(v)); }

// ---------- aggregate model ----------
let M = null; // computed metrics for current dt/segment/privacy
function compute(dt) {
  const days = D.meta.days[dt];
  const segs = state.teens ? ['a', 't'] : ['a'];
  const b = 1 / state.eps;
  const n = NC * 24;
  const foot = new Float32Array(n), uniq = new Int32Array(n), sh = new Float32Array(n), md = new Float32Array(n), ends = new Float32Array(n);
  const pub = new Uint8Array(n);
  const dtId = dt === 'wd' ? 1 : 2;
  for (let c = 0; c < NC; c++) {
    for (let h = 0; h < 24; h++) {
      let pd = 0, u = 0, s = 0, m = 0, e = 0;
      for (const sg of segs) {
        const row = D.series[dt][sg][c]; if (!row) continue;
        const o = h * FIELDS;
        pd += row[o]; u += row[o + 1]; s += row[o + 2] / 10; m += row[o + 3] / 10; e += row[o + 4] / 10;
      }
      const i = c * 24 + h;
      uniq[i] = u;
      if (u < state.k) continue;
      pub[i] = 1;
      foot[i] = Math.max(0, pd + laplace(hash(c, h, 0, dtId), b)) / days;
      sh[i] = Math.max(0, s + laplace(hash(c, h, 1, dtId), b)) / days;
      md[i] = Math.max(0, m + laplace(hash(c, h, 2, dtId), b)) / days;
      ends[i] = Math.max(0, e + laplace(hash(c, h, 3, dtId), b)) / days;
    }
  }
  return { dt, foot, uniq, sh, md, ends, pub };
}

function fleetDemand(s, m, fleet) {
  if (fleet === 'scooter') return s + 0.45 * m;
  if (fleet === 'bike') return 0.55 * s + m;
  return 0.85 * (s + m);
}
function p98(arr, pub) {
  const v = []; for (let i = 0; i < arr.length; i++) if (pub[i] && arr[i] > 0) v.push(arr[i]);
  v.sort((a, b) => a - b); return v.length ? v[Math.floor(v.length * 0.98)] : 1;
}
const panelSize = () => D.meta.panel.adults + (state.teens ? D.meta.panel.teens1617 : 0);
const expansion = () => (D.meta.population * D.meta.adultShare) / D.meta.panel.adults;

function score(Mx) {
  const n = NC * 24;
  const dem = new Float32Array(n), net = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dem[i] = fleetDemand(Mx.sh[i], Mx.md[i], state.fleet);
    net[i] = dem[i] - fleetDemand(0, Mx.ends[i], 'both') * 0.85;
  }
  const pd = p98(dem, Mx.pub), pf = p98(Mx.foot, Mx.pub), pn = p98(net.map((x) => Math.max(0, x)), Mx.pub);
  const W = state.w, sum = W.demand + W.foot + W.transit + W.net || 1;
  const sc = new Float32Array(n), parts = new Float32Array(n * 4), rides = new Float32Array(n);
  const s = (x, p) => Math.min(1, Math.sqrt(Math.max(0, x) / p));
  for (let c = 0; c < NC; c++) {
    const tr = D.cells[c][3];
    for (let h = 0; h < 24; h++) {
      const i = c * 24 + h; if (!Mx.pub[i]) { sc[i] = -1; continue; }
      const sd = s(dem[i], pd);
      const a = W.demand * sd, f = W.foot * s(Mx.foot[i], pf), t = W.transit * tr * sd, q = W.net * s(net[i], pn);
      sc[i] = 100 * (a + f + t + q) / sum;
      parts[i * 4] = a; parts[i * 4 + 1] = f; parts[i * 4 + 2] = t; parts[i * 4 + 3] = q;
      rides[i] = dem[i] * expansion() * CAPTURE;
    }
  }
  return { ...Mx, dem, net, sc, parts, rides, pd, pf, pn };
}

let S = null, SALT = null; // current-day scored metrics, plus the other day type (for zone charts)
function recompute() {
  S = score(compute(state.dt));
  SALT = score(compute(state.dt === 'wd' ? 'we' : 'wd'));
  render();
}

// ---------- labels ----------
const fmtHour = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' AM' : ' PM');
const fmtHM = (h) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };
function hourContext(h, dt) {
  if (dt === 'we') return h < 7 ? 'Overnight' : h < 10 ? 'Weekend morning' : h < 13 ? 'Brunch & errands' : h < 17 ? 'Parks & shopping' : h < 21 ? 'Dinner & nightlife' : 'Late night';
  return h < 5 ? 'Overnight' : h < 7 ? 'Early risers' : h < 10 ? 'Morning commute' : h < 12 ? 'Late morning' : h < 14 ? 'Lunch rush' : h < 16 ? 'School dismissal' : h < 19 ? 'Evening commute' : h < 22 ? 'Dinner & evening' : 'Late night';
}
const name = (c) => D.names[D.cells[c][2]];
const DRIVERS = ['Short trips', 'Foot traffic', 'Transit last mile', 'Net outflow'];
function driversOf(i) {
  const p = [0, 1, 2, 3].map((k) => [DRIVERS[k], S.parts[i * 4 + k]]).sort((a, b) => b[1] - a[1]);
  return p.filter((x) => x[1] > 0.02).slice(0, 2).map((x) => x[0]);
}
function unitsSplit(n) {
  if (state.fleet === 'scooter') return { scooter: n, bike: 0 };
  if (state.fleet === 'bike') return { scooter: 0, bike: n };
  const s = Math.round(n * 0.6); return { scooter: s, bike: n - s };
}
const unitsText = (u) => [u.scooter && `${u.scooter} scooters`, u.bike && `${u.bike} e-bikes`].filter(Boolean).join(' + ') || '—';
const deviceBucket = (u) => (u < state.k ? `<${state.k}` : u < 25 ? `${state.k}–24` : u < 50 ? '25–49' : u < 100 ? '50–99' : u < 250 ? '100–249' : '250+');

// ---------- map ----------
const map = L.map('map', { zoomControl: false, preferCanvas: true, attributionControl: true }).setView([47.598, -122.163], 13);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 16, attribution: 'Tiles © Esri · Esri, HERE, Garmin, © OpenStreetMap contributors',
}).addTo(map);
const labelPane = map.createPane('labels'); labelPane.style.zIndex = 450; labelPane.style.pointerEvents = 'none';
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'labels' }).addTo(map);
map.attributionControl.setPrefix(false);

const R = D.meta.hexRadiusM, MLAT = 111320;
function hexPoly(lat, lng) {
  const mlng = MLAT * Math.cos(lat * Math.PI / 180), pts = [];
  for (let k = 0; k < 6; k++) { const a = (Math.PI / 180) * (60 * k + 30); pts.push([lat + (R * Math.sin(a)) / MLAT, lng + (R * Math.cos(a)) / mlng]); }
  return pts;
}
const renderer = L.canvas({ padding: 0.3 });
const hexes = D.cells.map(([lat, lng], c) => {
  const p = L.polygon(hexPoly(lat, lng), { renderer, weight: 0.6, color: '#000', fillOpacity: 0 }).addTo(map);
  p.on('click', () => selectCell(c, false));
  p.on('mouseover', () => { p.setStyle({ weight: 2, color: '#fff' }); });
  p.on('mouseout', () => styleHex(c));
  p.bindTooltip(() => tipFor(c), { sticky: true, className: 'hex-tip', direction: 'top', offset: [0, -6] });
  return p;
});
const selRing = L.polygon([[0, 0]], { renderer, color: '#fff', weight: 3, fill: false, interactive: false, dashArray: '5 4' });
const STATION_ICON = L.divIcon({ className: '', iconSize: [16, 16], html: '<div class="stn">⬢</div>' });
for (const [n, la, lo] of D.stations) L.marker([la, lo], { icon: STATION_ICON, keyboard: false, interactive: true }).bindTooltip(n, { className: 'hex-tip', direction: 'top' }).addTo(map);
const rankLayer = L.layerGroup().addTo(map);

function mix(a, b, t) { return a.map((x, i) => Math.round(x + (b[i] - x) * t)); }
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t)); const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n));
  return mix(stops[i], stops[i + 1], t * n - i);
}
const RAMPS = {
  score: [[16, 40, 22], [24, 120, 40], [61, 220, 61], [190, 255, 90], [255, 255, 200]],
  foot: [[40, 10, 30], [120, 0, 70], [226, 0, 116], [255, 120, 190], [255, 225, 240]],
  netPos: [[20, 60, 30], [61, 220, 61], [210, 255, 120]],
  netNeg: [[60, 40, 10], [245, 158, 11], [255, 220, 140]],
};
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
function cellValue(c) {
  const i = c * 24 + state.hour;
  if (!S.pub[i]) return null;
  if (state.layer === 'score') return S.sc[i] / 100;
  if (state.layer === 'foot') return Math.min(1, Math.sqrt(S.foot[i] / S.pf));
  return Math.max(-1, Math.min(1, S.net[i] / (S.pn || 1)));
}
function styleHex(c) {
  const v = cellValue(c), p = hexes[c];
  if (v === null) { p.setStyle({ fillColor: '#888', fillOpacity: 0.04, color: '#555', weight: 0.5, dashArray: '2 3' }); return; }
  let col, op;
  if (state.layer === 'net') {
    col = v >= 0 ? ramp(RAMPS.netPos, v) : ramp(RAMPS.netNeg, -v); op = 0.12 + 0.6 * Math.abs(v);
  } else { col = ramp(RAMPS[state.layer], v); op = 0.1 + 0.62 * v; }
  p.setStyle({ fillColor: rgb(col), fillOpacity: op, color: 'rgba(0,0,0,.6)', weight: 0.6, dashArray: null });
}
function tipFor(c) {
  const i = c * 24 + state.hour;
  if (!S.pub[i]) return `<b>${name(c)}</b><br><span class="tip-dim">Suppressed: fewer than ${state.k} devices this hour</span>`;
  return `<b>${name(c)}</b><br>Propensity <b>${Math.round(S.sc[i])}</b> · ~${S.rides[i].toFixed(1)} Lime rides/hr<br><span class="tip-dim">Devices: ${deviceBucket(S.uniq[i])} · ${fmtHour(state.hour)}</span>`;
}

// ---------- ranking ----------
function topZones(hours, limit, sc = S) {
  const best = new Map();
  for (let c = 0; c < NC; c++) {
    let s = 0, rides = 0, cnt = 0, peak = -1, peakH = hours[0];
    for (const h of hours) {
      const i = c * 24 + h; if (!sc.pub[i]) continue;
      s += sc.sc[i]; rides += sc.rides[i]; cnt++;
      if (sc.sc[i] > peak) { peak = sc.sc[i]; peakH = h; }
    }
    if (!cnt) continue;
    const avg = s / hours.length, nm = name(c);
    const cur = best.get(nm);
    if (!cur) best.set(nm, { c, name: nm, score: avg, rides, peakH, hexes: 1 });
    else { cur.hexes++; cur.rides += rides; if (avg > cur.score) { cur.score = avg; cur.c = c; cur.peakH = peakH; } }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------- render ----------
function render() {
  for (let c = 0; c < NC; c++) styleHex(c);
  $('#hourLabel').textContent = fmtHour(state.hour) + (state.dt === 'we' ? ' · Weekend' : ' · Weekday');
  $('#hourSub').textContent = hourContext(state.hour, state.dt);
  $('#hourSlider').value = state.hour;
  renderLegend(); renderSpark(); renderKpis(); renderPrivacy(); renderRanks();
  renderNow(); renderPlan(); if (state.selected !== null) renderZone(state.selected);
}

function renderLegend() {
  const L = {
    score: ['Low', 'Propensity score', 'High', RAMPS.score],
    foot: ['Few', 'Devices present (aggregate)', 'Many', RAMPS.foot],
    net: ['Vehicles pile up', 'Trip starts minus ends', 'Vehicles drain', [...RAMPS.netNeg].reverse().concat(RAMPS.netPos)],
  }[state.layer];
  const grad = L[3].map((c, i, a) => `${rgb(c)} ${Math.round((i / (a.length - 1)) * 100)}%`).join(',');
  $('#legend').innerHTML = `<div class="lg-bar" style="background:linear-gradient(90deg,${grad})"></div><div class="lg-row"><span>${L[0]}</span><b>${L[1]}</b><span>${L[2]}</span></div>
    <div class="lg-row lg-sup"><i></i>Hatched cells are suppressed (k-anonymity)</div>`;
}

function cityTotals(sc) {
  const t = new Array(24).fill(0);
  for (let c = 0; c < NC; c++) for (let h = 0; h < 24; h++) { const i = c * 24 + h; if (sc.pub[i]) t[h] += sc.rides[i]; }
  return t;
}
function renderSpark() {
  const t = cityTotals(S), mx = Math.max(...t, 1), w = 100 / 24;
  $('#spark').innerHTML = `<svg viewBox="0 0 100 24" preserveAspectRatio="none">${t.map((v, h) =>
    `<rect x="${h * w + 0.4}" y="${24 - (v / mx) * 22}" width="${w - 0.8}" height="${(v / mx) * 22}" class="${h === state.hour ? 'on' : ''}" data-h="${h}"><title>${fmtHour(h)}: ~${Math.round(v)} rides</title></rect>`).join('')}</svg>`;
}

function renderKpis() {
  let pub = 0, sup = 0, rides = 0;
  for (let c = 0; c < NC; c++) { const i = c * 24 + state.hour; if (S.pub[i]) { pub++; rides += S.rides[i]; } else if (S.uniq[i] > 0) sup++; }
  const top = topZones([state.hour], 10);
  const cover = rides ? top.reduce((a, z) => a + z.rides, 0) / rides : 0;
  const day = cityTotals(S).reduce((a, b) => a + b, 0);
  $('#mapKpis').innerHTML = `
    <div><b>${Math.round(rides).toLocaleString()}</b><span>est. Lime rides this hour</span></div>
    <div><b>${Math.round(cover * 100)}%</b><span>of demand in top 10 zones</span></div>
    <div><b>${Math.round(day).toLocaleString()}</b><span>est. rides per ${state.dt === 'wd' ? 'weekday' : 'weekend day'}</span></div>
    <div><b>${pub}</b><span>cells published · ${sup} suppressed</span></div>`;
}

function renderPrivacy() {
  const P = D.meta.panel;
  $('#segA').textContent = `${P.adults.toLocaleString()} devices`;
  $('#segT').textContent = `${P.teens1617.toLocaleString()} devices`;
  let tot = 0, pub = 0;
  for (let i = 0; i < NC * 24; i++) if (S.uniq[i] > 0) { tot++; if (S.pub[i]) pub++; }
  $('#privStats').innerHTML = `
    <div><b>${P.devices.toLocaleString()}</b><span>devices tracked in T-Life</span></div>
    <div><b>${panelSize().toLocaleString()}</b><span>opted in &amp; eligible</span></div>
    <div class="ex"><b>${(P.under13 + P.age13to15).toLocaleString()}</b><span>under 16, excluded</span></div>
    <div class="ex"><b>${P.optedOut.toLocaleString()}</b><span>opted out, excluded</span></div>
    <div class="wide"><b>${Math.round((pub / Math.max(1, tot)) * 100)}%</b><span>of cell-hours publishable at k=${state.k} · noise ±${(1.41 / state.eps).toFixed(1)} trips (σ)</span></div>`;
}

function renderRanks() {
  rankLayer.clearLayers();
  if (state.layer !== 'score') return;
  topZones([state.hour], 10).forEach((z, r) => {
    const [la, lo] = D.cells[z.c];
    L.marker([la, lo], { icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: `<div class="rank">${r + 1}</div>` }), keyboard: false })
      .on('click', () => selectCell(z.c, true)).addTo(rankLayer);
  });
}

function zoneRow(z, r, extra = '') {
  const i = z.c * 24 + state.hour;
  const units = unitsSplit(Math.max(1, Math.ceil((z.rides * 2) / RIDES_PER_UNIT)));
  const drv = S.pub[i] ? driversOf(i) : [];
  return `<button class="zone" data-c="${z.c}">
    <span class="z-rank">${r + 1}</span>
    <span class="z-main"><b>${z.name}</b>${z.hexes > 1 ? `<small> · ${z.hexes} hexes</small>` : ''}
      <span class="z-bar"><i style="width:${Math.max(3, z.score)}%"></i></span>
      <span class="z-meta">${drv.map((d) => `<em>${d}</em>`).join('')}${extra}</span></span>
    <span class="z-score"><b>${Math.round(z.score)}</b><small>${unitsText(units)}</small></span></button>`;
}

function renderNow() {
  const top = topZones([state.hour], 10);
  $('#tab-now').innerHTML = `
    <div class="tab-intro">Top staging zones for <b>${fmtHour(state.hour)}</b> (${hourContext(state.hour, state.dt).toLowerCase()}). Units cover about 2 hours of predicted ${fleetLabel()} demand.</div>
    ${top.length ? top.map((z, r) => zoneRow(z, r)).join('') : '<div class="empty">No cells meet the privacy threshold this hour.</div>'}`;
}
const fleetLabel = () => ({ scooter: 'scooter', bike: 'e-bike', both: 'scooter and e-bike' }[state.fleet]);

const BLOCKS = {
  wd: [[6, 9, 'Morning commute'], [11, 14, 'Lunch rush'], [14, 16, 'School dismissal'], [16, 19, 'Evening commute'], [19, 22, 'Dinner & evening']],
  we: [[9, 12, 'Weekend morning'], [12, 16, 'Parks & shopping'], [16, 20, 'Dinner & nightlife']],
};
function planData() {
  return BLOCKS[state.dt].map(([a, b, label]) => {
    const hours = []; for (let h = a; h < b; h++) hours.push(h);
    const zones = topZones(hours, 5).map((z) => ({ ...z, units: unitsSplit(Math.max(1, Math.ceil(z.rides / RIDES_PER_UNIT))) }));
    return { a, b, label, zones, stageBy: a - 0.5 };
  });
}
function renderPlan() {
  const plan = planData();
  $('#tab-plan').innerHTML = `<div class="tab-intro">${state.dt === 'wd' ? 'Weekday' : 'Weekend'} rebalancing plan for ${fleetLabel()}s. Have vehicles in place by the time shown.</div>` +
    plan.map((p) => {
      const tot = p.zones.reduce((a, z) => a + z.units.scooter + z.units.bike, 0);
      return `<div class="block"><div class="block-head"><b>${p.label}</b><span>${fmtHour(p.a)}–${fmtHour(p.b)}</span><em>Stage by ${fmtHM(p.stageBy)} · ${tot} units</em></div>
        ${p.zones.map((z) => `<button class="pz" data-c="${z.c}"><span>${z.name}</span><small>peak ${fmtHour(z.peakH)}</small><b>${unitsText(z.units)}</b></button>`).join('')}</div>`;
    }).join('');
}

function bars24(sc, c, cls) {
  return Array.from({ length: 24 }, (_, h) => {
    const i = c * 24 + h, v = sc.pub[i] ? sc.sc[i] : 0;
    return `<rect class="${cls}${sc.pub[i] ? '' : ' sup'}${h === state.hour && sc === S ? ' on' : ''}" x="${h * 10 + 1}" y="${100 - v}" width="8" height="${Math.max(sc.pub[i] ? 1 : 0, v)}"><title>${fmtHour(h)}: ${sc.pub[i] ? Math.round(v) : 'suppressed'}</title></rect>`;
  }).join('');
}
function renderZone(c) {
  const i = c * 24 + state.hour;
  const wd = state.dt === 'wd' ? S : SALT, we = state.dt === 'wd' ? SALT : S;
  let best = { s: -1, h: 0, dt: 'wd' };
  for (const [sc, dt] of [[wd, 'wd'], [we, 'we']]) for (let h = 0; h < 24; h++) { const j = c * 24 + h; if (sc.pub[j] && sc.sc[j] > best.s) best = { s: sc.sc[j], h, dt }; }
  const dayRides = Array.from({ length: 24 }, (_, h) => (S.pub[c * 24 + h] ? S.rides[c * 24 + h] : 0)).reduce((a, b) => a + b, 0);
  const parts = S.pub[i] ? [0, 1, 2, 3].map((k) => S.parts[i * 4 + k]) : [0, 0, 0, 0];
  const pmax = Math.max(...parts, 0.01);
  $('#tab-zone').innerHTML = `
    <div class="zd-head"><div><b>${name(c)}</b><small>Hex #${c} · ${D.cells[c][3] > 0 ? `${Math.round(D.cells[c][3] * 650)} m of rail/transit influence` : 'no transit hub nearby'}</small></div>
      <div class="zd-score">${S.pub[i] ? Math.round(S.sc[i]) : '—'}<small>${fmtHour(state.hour)}</small></div></div>
    <div class="zd-kpis">
      <div><b>${S.pub[i] ? S.rides[i].toFixed(1) : '—'}</b><span>rides/hr now</span></div>
      <div><b>${Math.round(dayRides)}</b><span>rides/${state.dt === 'wd' ? 'weekday' : 'weekend day'}</span></div>
      <div><b>${best.s >= 0 ? fmtHour(best.h) : '—'}</b><span>peak (${best.dt === 'wd' ? 'weekday' : 'weekend'})</span></div>
      <div><b>${deviceBucket(S.uniq[i])}</b><span>devices this hour</span></div>
    </div>
    <h4>When to stage here <span class="lg-key"><i class="k-wd"></i>Weekday <i class="k-we"></i>Weekend</span></h4>
    <svg class="zchart" viewBox="0 0 240 104" preserveAspectRatio="none">
      <g>${bars24(wd, c, 'b-wd')}</g><g transform="translate(2.5,0)">${bars24(we, c, 'b-we thin')}</g></svg>
    <div class="ticks small"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>
    <h4>Why it scores ${S.pub[i] ? Math.round(S.sc[i]) : '—'} at ${fmtHour(state.hour)}</h4>
    ${DRIVERS.map((d, k) => `<div class="drv"><span>${d}</span><i><em style="width:${(parts[k] / pmax) * 100}%"></em></i></div>`).join('')}
    ${S.pub[i] ? '' : `<div class="note warn">This cell is suppressed at ${fmtHour(state.hour)} because fewer than ${state.k} opted-in devices were present.</div>`}`;
}

function selectCell(c, pan) {
  state.selected = c;
  selRing.setLatLngs(hexPoly(D.cells[c][0], D.cells[c][1])).addTo(map);
  if (pan) map.panTo([D.cells[c][0], D.cells[c][1]], { animate: true });
  setTab('zone'); renderZone(c);
}
function setTab(t) {
  state.tab = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  for (const k of ['now', 'plan', 'zone']) $('#tab-' + k).classList.toggle('hidden', k !== t);
}

// ---------- controls ----------
function bindSeg(id, key, after) {
  const el = $(id);
  const sync = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state[key]));
  el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state[key] = b.dataset.v; sync(); after(); });
  sync(); return sync;
}
const syncDay = bindSeg('#daySeg', 'dt', recompute);
bindSeg('#fleetSeg', 'fleet', recompute);
bindSeg('#layerSeg', 'layer', render);
$('#teenChk').addEventListener('change', (e) => { state.teens = e.target.checked; recompute(); });
$('#hourSlider').addEventListener('input', (e) => { state.hour = +e.target.value; render(); });
$('#spark').addEventListener('click', (e) => { const h = e.target.dataset && e.target.dataset.h; if (h !== undefined) { state.hour = +h; render(); } });
let rt = null; const later = (fn) => { clearTimeout(rt); rt = setTimeout(fn, 60); };
$('#kSlider').addEventListener('input', (e) => { state.k = +e.target.value; $('#kVal').textContent = state.k; later(recompute); });
$('#epsSlider').addEventListener('input', (e) => { state.eps = +e.target.value; $('#epsVal').textContent = state.eps.toFixed(1); later(recompute); });
for (const [id, key] of [['wDemand', 'demand'], ['wFoot', 'foot'], ['wTransit', 'transit'], ['wNet', 'net']]) {
  const el = $('#' + id), lab = $('#' + id + 'Val');
  lab.textContent = state.w[key].toFixed(2);
  el.addEventListener('input', () => { state.w[key] = +el.value; lab.textContent = state.w[key].toFixed(2); later(recompute); });
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.t); });
document.querySelector('.insights').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) selectCell(+b.dataset.c, true); });

let timer = null;
function setPlaying(on) {
  state.playing = on; document.body.classList.toggle('playing', on);
  clearInterval(timer);
  if (on) timer = setInterval(() => { state.hour = (state.hour + 1) % 24; render(); }, 900);
}
$('#playBtn').addEventListener('click', () => setPlaying(!state.playing));
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); state.hour = (state.hour + 1) % 24; render(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); state.hour = (state.hour + 23) % 24; render(); }
  else if (e.key === 'w' || e.key === 'W') { state.dt = state.dt === 'wd' ? 'we' : 'wd'; syncDay(); recompute(); }
  else if (e.key === 'Escape') $('#apiModal').classList.add('hidden');
});

$('#exportBtn').addEventListener('click', () => {
  const rows = [['day_type', 'window', 'stage_by', 'zone', 'hex_id', 'lat', 'lng', 'propensity', 'peak_hour', 'est_rides', 'scooters', 'ebikes']];
  for (const p of planData()) for (const z of p.zones) {
    rows.push([state.dt === 'wd' ? 'weekday' : 'weekend', `${fmtHour(p.a)}-${fmtHour(p.b)}`, fmtHM(p.stageBy), z.name, z.c, D.cells[z.c][0], D.cells[z.c][1],
      Math.round(z.score), fmtHour(z.peakH), z.rides.toFixed(1), z.units.scooter, z.units.bike]);
  }
  const csv = rows.map((r) => r.map((v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `lime-staging-plan-bellevue-${state.dt === 'wd' ? 'weekday' : 'weekend'}-${state.fleet}.csv`; a.click();
});
$('#apiBtn').addEventListener('click', () => {
  const top = topZones([state.hour], 3);
  const body = {
    metro: 'bellevue-wa', day_type: state.dt === 'wd' ? 'weekday' : 'weekend', hour: state.hour, fleet: state.fleet,
    privacy: { k_min_devices: state.k, epsilon: state.eps, min_age: state.teens ? 16 : 18 },
    zones: top.map((z) => ({ hex_id: z.c, name: z.name, center: D.cells[z.c].slice(0, 2), propensity: Math.round(z.score), est_rides_per_hr: +z.rides.toFixed(1) })),
  };
  $('#apiCode').textContent = `GET /partner/v1/mobility/propensity?metro=bellevue-wa&day_type=${body.day_type}&hour=${state.hour}&fleet=${state.fleet}\nAuthorization: Bearer <partner token>\n\n${JSON.stringify(body, null, 2)}`;
  $('#apiModal').classList.remove('hidden');
});
$('#apiClose').addEventListener('click', () => $('#apiModal').classList.add('hidden'));
$('#apiModal').addEventListener('click', (e) => { if (e.target.id === 'apiModal') $('#apiModal').classList.add('hidden'); });

recompute();
