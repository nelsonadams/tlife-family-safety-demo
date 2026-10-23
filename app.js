(() => {
'use strict';

const MAG = '#E20074';
const ROUTES = window.DEMO_ROUTES;
const M_PER_MI = 1609.344;

const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3z"/></svg>',
  school: '<svg viewBox="0 0 24 24"><path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zm-7 9.18v4L12 20l7-3.82v-4L12 16l-7-3.82z"/></svg>',
};

const ZONES = {
  home:   { id: 'home', name: 'Home', short: 'Home', lat: 47.557936, lng: -122.160054, r: 150, color: '#00A3AD', arrive: true, leave: true, addr: 'Somerset neighborhood, Bellevue' },
  school: { id: 'school', name: 'Somerset Elementary', short: 'School', lat: 47.56355, lng: -122.15124, r: 200, color: MAG, arrive: true, leave: true, addr: 'Somerset Blvd SE, Bellevue' },
};

const MEMBERS = {
  emma: { id: 'emma', name: 'Emma', initial: 'E', age: 10, device: 'SyncUP KIDS Watch', color: MAG, battery: 86 },
  jake: { id: 'jake', name: 'Jake', initial: 'J', age: 16, device: 'iPhone · T-Mobile 5G', color: '#5B2C83', battery: 71 },
};

const SCENARIOS = [
  {
    id: 'toSchool', member: 'emma', startMin: 7 * 60 + 44, mult: 60,
    title: 'Morning walk to school',
    desc: 'Emma (10) walks to Somerset Elementary wearing her SyncUP KIDS Watch. Mom gets a heads-up when she leaves home and when she gets to school.',
    expect: [['Left Home', 'leave:home'], ['Arrived at School', 'arrive:school']],
    place: { emma: 'route', jake: [47.5762, -122.1489] },
  },
  {
    id: 'wander', member: 'emma', startMin: 11 * 60 + 38, mult: 90,
    title: 'Leaves campus at lunch',
    desc: 'During school hours, Emma walks off campus toward Factoria Marketplace. T-Life sends an urgent alert, then a distance alert once she\'s more than 1 mile from home.',
    expect: [['Left School during school hours', 'school:school', 'crit'], ['More than 1 mi from Home', 'distance', 'warn']],
    place: { emma: 'route', jake: [47.5762, -122.1489] },
  },
  {
    id: 'ride', member: 'jake', startMin: 15 * 60 + 18, mult: 30,
    title: 'Teen driver speeding on I-90',
    desc: 'Jake (16, just licensed) leaves the school pickup loop and gets on I-90 East. Parents get a speed alert once he passes 65 mph, then a drive summary when he stops.',
    expect: [['Left School', 'leave:school'], ['Speed over 65 mph', 'speed', 'crit'], ['More than 1 mi from Home', 'distance', 'warn'], ['Drive summary', 'summary']],
    place: { emma: [47.557936, -122.160054], jake: 'route' },
  },
];

const S = {
  speed: { on: true, limit: 65 },
  distance: { on: true, anchor: 'home', max: 1.0 },
  schoolHours: { on: true, start: 8 * 60, end: 15 * 60 },
  sound: true,
};

const state = {
  scn: null, route: null, simT: 0, playing: false, mult: 60,
  tour: false, tourTimer: null, unread: 0, tab: 'map', focus: 'emma',
  follow: true, fired: new Set(), lastPingT: -999, lastUi: 0,
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------- geo + format helpers ----------
function hav(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const distTo = (m, z) => hav([m.lat, m.lng], [z.lat, z.lng]);
const fmtMi = (mi) => (mi < 0.1 ? `${Math.round(mi * 5280)} ft` : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`);
function clockMin() { return (state.scn ? state.scn.startMin : 7 * 60 + 44) + state.simT / 60; }
function fmtClock(min, withAmPm = true) {
  const h24 = Math.floor(min / 60) % 24, m = Math.floor(min % 60);
  const h = ((h24 + 11) % 12) + 1;
  return `${h}:${String(m).padStart(2, '0')}${withAmPm ? (h24 < 12 ? ' AM' : ' PM') : ''}`;
}
function fmtDur(sec) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${String(s).padStart(2, '0')}`; }

// ---------- map ----------
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([47.5605, -122.156], 15);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, className: 'basemap', attribution: 'Tiles © Esri · Esri, HERE, Garmin, © OpenStreetMap contributors',
}).addTo(map);
map.attributionControl.setPrefix(false);
map.on('dragstart', () => { state.follow = false; $('#recenterBtn').classList.add('off'); });

const zoneLayers = {};
for (const z of Object.values(ZONES)) {
  const circle = L.circle([z.lat, z.lng], { radius: z.r, color: z.color, weight: 2, fillColor: z.color, fillOpacity: 0.12 }).addTo(map);
  const label = L.marker([z.lat, z.lng], {
    interactive: false, keyboard: false,
    icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="zone-label" style="--zc:${z.color}"><span class="zi">${ICONS[z.id]}</span><b>${z.short}</b></div>` }),
  }).addTo(map);
  zoneLayers[z.id] = { circle, label };
}
const distRing = L.circle([0, 0], { radius: 1, color: '#f59e0b', weight: 1.5, dashArray: '6 6', fill: false, interactive: false }).addTo(map);
const trail = L.polyline([], { color: MAG, weight: 5, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(map);

for (const m of Object.values(MEMBERS)) {
  m.lat = ZONES.home.lat; m.lng = ZONES.home.lng; m.mph = 0; m.inside = {};
  m.marker = L.marker([m.lat, m.lng], {
    zIndexOffset: 1000,
    icon: L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22], html: `<div class="pin idle" style="--c:${m.color}"><span class="pulse"></span><div class="pin-av">${m.initial}</div><div class="pin-speed"></div></div>` }),
  }).addTo(map);
  m.marker.on('click', () => setFocus(m.id, true));
}

function updateDistRing() {
  const a = ZONES[S.distance.anchor];
  distRing.setLatLng([a.lat, a.lng]).setRadius(S.distance.max * M_PER_MI);
  distRing.setStyle({ opacity: S.distance.on ? 0.9 : 0 });
}

// ---------- route sim ----------
function buildRoute(key) {
  const { coords, mph } = ROUTES[key];
  const cum = [0], seg = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const v = mph[i] ?? mph[mph.length - 1];
    cum.push(cum[i] + hav(coords[i], coords[i + 1]) / (Math.max(v, 1) * 0.44704));
    seg.push(v);
  }
  return { coords, cum, seg, total: cum[cum.length - 1], idx: 0 };
}
function sample(rt, t) {
  let i = rt.idx;
  if (t < rt.cum[i]) i = 0;
  while (i < rt.cum.length - 2 && rt.cum[i + 1] < t) i++;
  rt.idx = i;
  const a = rt.coords[i], b = rt.coords[i + 1];
  const span = rt.cum[i + 1] - rt.cum[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (t - rt.cum[i]) / span)) : 1;
  const done = t >= rt.total;
  let mph = done ? 0 : rt.seg[i];
  if (!done && mph > 10) mph += Math.sin(t / 6) * 1.2;
  return { lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, mph, i };
}

function activeMember() { return state.scn ? MEMBERS[state.scn.member] : MEMBERS.emma; }

function resetMemberRuntime(m) {
  Object.assign(m, { mph: 0, speedOver: 0, underFor: 0, speedAlerted: false, distAlerted: false, topSpeed: 0, speedingAlerts: 0, alertFlag: false, tripMiles: 0 });
  m.inside = {};
  for (const z of Object.values(ZONES)) m.inside[z.id] = distTo(m, z) <= z.r;
  const a = ZONES[S.distance.anchor];
  m.distAlerted = S.distance.on && distTo(m, a) / M_PER_MI > S.distance.max;
}

function loadScenario(idx, { autoplay = false } = {}) {
  const scn = SCENARIOS[idx];
  state.scn = scn; state.route = buildRoute(scn.id); state.simT = 0; state.fired = new Set();
  state.lastPingT = -999;
  setMult(scn.mult);
  for (const [id, where] of Object.entries(scn.place)) {
    const m = MEMBERS[id];
    const p = where === 'route' ? state.route.coords[0] : where;
    m.lat = p[0]; m.lng = p[1];
    m.marker.setLatLng(p);
    resetMemberRuntime(m);
  }
  trail.setLatLngs([]);
  state.follow = true; $('#recenterBtn').classList.remove('off');
  setFocus(scn.member, false);
  fitScenario();
  setPlaying(false);
  renderScenarios();
  log(`<span class="k">SCENARIO</span> ${idx + 1} · ${scn.title}`);
  renderAll(true);
  if (autoplay) setPlaying(true);
}

function fitScenario() {
  const b = L.latLngBounds(state.route.coords);
  for (const z of Object.values(ZONES)) b.extend([z.lat, z.lng]);
  map.invalidateSize();
  map.fitBounds(b, { paddingTopLeft: [30, 60], paddingBottomRight: [30, 250], maxZoom: 16, animate: false });
}

function step(dtSim) {
  const rt = state.route; if (!rt) return;
  const m = activeMember();
  const p = sample(rt, state.simT);
  const prev = [m.lat, m.lng];
  m.lat = p.lat; m.lng = p.lng; m.mph = Math.max(0, p.mph);
  m.tripMiles += hav(prev, [m.lat, m.lng]) / M_PER_MI;
  m.topSpeed = Math.max(m.topSpeed, m.mph);
  m.battery = Math.max(5, m.battery - dtSim / 900);
  m.marker.setLatLng([m.lat, m.lng]);
  trail.setLatLngs(rt.coords.slice(0, p.i + 1).concat([[m.lat, m.lng]]));
  if (state.follow && state.focus === m.id) {
    const inner = map.getBounds().pad(-0.22);
    if (!inner.contains([m.lat, m.lng])) map.panTo([m.lat, m.lng], { animate: true, duration: 0.6 });
  }
  if (state.simT - state.lastPingT >= 60) {
    state.lastPingT = state.simT;
    log(`<span class="k">PING</span> ${m.id} ${m.lat.toFixed(5)},${m.lng.toFixed(5)} ${m.mph.toFixed(0)} mph`);
  }
  evaluate(m, dtSim);
}

// ---------- rules engine ----------
function inSchoolHours() { const c = clockMin(); return c >= S.schoolHours.start && c < S.schoolHours.end; }

function evaluate(m, dtSim) {
  for (const z of Object.values(ZONES)) {
    const d = distTo(m, z);
    const was = m.inside[z.id];
    const now = was ? d <= z.r + 15 : d <= z.r;
    if (now === was) continue;
    m.inside[z.id] = now;
    if (now) {
      log(`<span class="k">GEOFENCE_ENTER</span> ${m.id} → ${z.id} (r=${z.r}m)`);
      if (z.arrive) notify({ m, kind: 'arrive', key: `arrive:${z.id}`, level: 'info',
        title: `${m.name} arrived at ${z.name}`, body: `Arrived at ${fmtClock(clockMin())}.` });
    } else {
      log(`<span class="k">GEOFENCE_EXIT</span> ${m.id} ← ${z.id} (r=${z.r}m)`);
      if (z.id === 'school' && S.schoolHours.on && inSchoolHours()) {
        m.alertFlag = true;
        notify({ m, kind: 'school', key: 'school:school', level: 'crit',
          title: `${m.name} left school during school hours`, body: `Left ${z.name} at ${fmtClock(clockMin())}. Tap to see her live location.` });
      } else if (z.leave) {
        notify({ m, kind: 'leave', key: `leave:${z.id}`, level: 'info',
          title: `${m.name} left ${z.name}`, body: `Left at ${fmtClock(clockMin())}.` });
      }
    }
  }

  if (S.speed.on && m.mph > S.speed.limit) {
    m.speedOver += dtSim; m.underFor = 0;
    if (!m.speedAlerted && m.speedOver >= 5) {
      m.speedAlerted = true; m.speedingAlerts++; m.alertFlag = true;
      log(`<span class="c">SPEED_THRESHOLD</span> ${m.id} ${m.mph.toFixed(0)} mph > ${S.speed.limit}`);
      notify({ m, kind: 'speed', key: 'speed', level: 'crit',
        title: `Speed alert: ${m.name} is going ${Math.round(m.mph)} mph`, body: `Over your ${S.speed.limit} mph limit. Tap to see the live map.` });
    }
  } else {
    m.speedOver = 0;
    if (m.speedAlerted) { m.underFor += dtSim; if (m.underFor > 120) m.speedAlerted = false; }
  }

  const a = ZONES[S.distance.anchor];
  const dmi = distTo(m, a) / M_PER_MI;
  if (S.distance.on && dmi > S.distance.max && !m.distAlerted) {
    m.distAlerted = true;
    log(`<span class="a">DISTANCE_THRESHOLD</span> ${m.id} ${dmi.toFixed(2)} mi from ${a.id} > ${S.distance.max}`);
    notify({ m, kind: 'distance', key: 'distance', level: 'warn',
      title: `${m.name} is ${fmtMi(dmi)} from ${a.short}`, body: `Past your ${fmtMi(S.distance.max)} limit from ${a.name}.` });
  }
  if (dmi < S.distance.max * 0.9) m.distAlerted = false;
}

function finishScenario() {
  setPlaying(false);
  const m = activeMember();
  m.mph = 0;
  if (state.scn.id === 'ride') {
    notify({ m, kind: 'summary', key: 'summary', level: m.speedingAlerts ? 'warn' : 'info',
      title: `${m.name}'s drive summary`,
      body: `${m.tripMiles.toFixed(1)} mi · top speed ${Math.round(m.topSpeed)} mph · ${m.speedingAlerts} speed alert${m.speedingAlerts === 1 ? '' : 's'}. Tap to see the route.` });
  }
  log(`<span class="k">SCENARIO_END</span> ${state.scn.id} at ${fmtClock(clockMin())}`);
  renderAll(true);
  if (state.tour) {
    const next = SCENARIOS.indexOf(state.scn) + 1;
    if (next < SCENARIOS.length) state.tourTimer = setTimeout(() => loadScenario(next, { autoplay: true }), 3500);
    else setTour(false);
  }
}

// ---------- notifications ----------
let audioCtx;
function chime(level) {
  if (!S.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = level === 'crit' ? [880, 660, 880] : [784, 1046];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      const t = audioCtx.currentTime + i * 0.13;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.4);
    });
  } catch (e) { /* audio unavailable */ }
}

const ACT_ICON = {
  arrive: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z"/></svg>',
  leave: '<svg viewBox="0 0 24 24"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zM19 19H5V5h6V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-6h-2v6z"/></svg>',
  speed: '<svg viewBox="0 0 24 24"><path d="M12 4a10 10 0 00-8.66 15h17.32A10 10 0 0012 4zm4.2 4.4l-3 7.2a1.5 1.5 0 11-2.1-2.1l5.1-5.1z"/></svg>',
  distance: '<svg viewBox="0 0 24 24"><path d="M21 12l-4-4v3H7V8l-4 4 4 4v-3h10v3z"/></svg>',
  school: ICONS.school,
  summary: '<svg viewBox="0 0 24 24"><path d="M18.9 6a1.5 1.5 0 00-1.4-1h-11a1.5 1.5 0 00-1.4 1L3 12v8a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-8l-2.1-6zM6.5 16a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm11 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM5 11l1.5-4.5h11L19 11H5z"/></svg>',
};
const activity = [];

function notify({ m, kind, key, level, title, body }) {
  state.fired.add(key);
  const time = fmtClock(clockMin());
  activity.unshift({ m, kind, level, title, body, time });
  renderActivity();
  if (state.tab !== 'activity') { state.unread++; renderBadge(); }

  const stack = $('#notifStack');
  const el = document.createElement('div');
  el.className = `notif lvl-${level}`;
  el.innerHTML = `<div class="n-icon">T</div><div class="n-body"><div class="n-top"><b>T-LIFE</b><span>now</span></div>
    <div class="n-title">${level === 'crit' ? '<span class="lvl-pill">URGENT</span>' : ''}${title}</div><div class="n-text">${body}</div></div>`;
  el.addEventListener('click', () => { dismiss(el); setTab('map'); setFocus(m.id, true); });
  stack.prepend(el);
  while (stack.children.length > 3) stack.lastElementChild.remove();
  setTimeout(() => dismiss(el), level === 'crit' ? 9000 : 6500);

  log(`<span class="a">PUSH</span> → Mom's iPhone: "${title}"`);
  chime(level);
  const pipe = $('#pipeline');
  pipe.classList.remove('flow'); void pipe.offsetWidth; pipe.classList.add('flow');
  if (level === 'crit') { const ph = $('#phone'); ph.classList.remove('shake'); void ph.offsetWidth; ph.classList.add('shake'); }
  renderScenarios();
}
function dismiss(el) { if (!el.isConnected || el.classList.contains('out')) return; el.classList.add('out'); setTimeout(() => el.remove(), 350); }

// ---------- log ----------
function log(html) {
  const el = document.createElement('div');
  el.innerHTML = `<span class="t">${fmtClock(clockMin(), false).padStart(5, ' ')}</span> ${html}`;
  const box = $('#log');
  box.prepend(el);
  while (box.children.length > 80) box.lastElementChild.remove();
}

// ---------- rendering ----------
function renderScenarios() {
  $('#scenarioList').innerHTML = SCENARIOS.map((s, i) => {
    const m = MEMBERS[s.member];
    const on = state.scn === s;
    const chips = s.expect.map(([label, key, lvl]) =>
      `<span class="chip ${lvl || ''} ${on && state.fired.has(key) ? 'fired' : ''}">${label}</span>`).join('');
    return `<button class="scn ${on ? 'on' : ''}" data-i="${i}">
      <span class="scn-num">${i + 1}</span>
      <div class="scn-meta"><span>${fmtClock(s.startMin)}</span>·<span class="who"><i style="background:${m.color}"></i>${m.name}, ${m.age}</span></div>
      <div class="scn-title">${s.title}</div>
      <div class="scn-desc">${s.desc}</div>
      <div class="scn-expect">${chips}</div></button>`;
  }).join('');
  $$('.scn').forEach((b) => b.addEventListener('click', () => { setTour(false); loadScenario(+b.dataset.i); }));
}

function statusFor(m) {
  const zone = Object.values(ZONES).find((z) => m.inside[z.id]);
  if (S.speed.on && m.mph > S.speed.limit) return { text: `Speeding · ${Math.round(m.mph)} mph`, cls: 'crit' };
  if (m.mph > 8) return { text: `Driving · ${Math.round(m.mph)} mph`, cls: 'moving' };
  if (m.mph > 0.5) return { text: zone ? `Walking at ${zone.short}` : `Walking · ${m.mph.toFixed(0)} mph`, cls: 'moving' };
  if (zone) return { text: `At ${zone.short}`, cls: '' };
  return { text: 'Stopped', cls: m.alertFlag ? 'crit' : '' };
}

function renderChips() {
  $('#memberChips').innerHTML = Object.values(MEMBERS).map((m) => {
    const st = statusFor(m);
    return `<button class="mchip ${state.focus === m.id ? 'on' : ''} ${m.alertFlag ? 'alert' : ''}" data-id="${m.id}">
      <span class="av" style="background:${m.color}">${m.initial}</span><span>${m.name}<small>${st.text}</small></span></button>`;
  }).join('');
  $$('.mchip').forEach((b) => b.addEventListener('click', () => setFocus(b.dataset.id, true)));
}

function renderSheet() {
  const m = MEMBERS[state.focus];
  const st = statusFor(m);
  const anchor = ZONES[S.distance.anchor];
  const dmi = distTo(m, anchor) / M_PER_MI;
  const over = S.speed.on && m.mph > S.speed.limit;
  const far = S.distance.on && dmi > S.distance.max;
  $('#sheet').innerHTML = `
    <div class="sh-top">
      <div class="sh-av" style="background:${m.color}">${m.initial}</div>
      <div><div class="sh-name">${m.name}</div><div class="sh-dev">${m.device}</div></div>
      <div class="sh-status"><span class="status-pill ${st.cls}">${st.text}</span><div class="sh-upd">Updated just now</div></div>
    </div>
    <div class="sh-stats">
      <div class="stat ${over ? 'crit' : ''}"><small>Speed</small><b>${Math.round(m.mph)}<i>mph</i></b></div>
      <div class="stat ${far ? 'warn' : ''}"><small>From ${anchor.short}</small><b>${dmi < 0.1 ? Math.round(dmi * 5280) : dmi.toFixed(1)}<i>${dmi < 0.1 ? 'ft' : 'mi'}</i></b></div>
      <div class="stat"><small>Battery</small><b>${Math.round(m.battery)}<i>%</i></b></div>
    </div>
    <div class="sh-actions"><button>Call ${m.name}</button><button>${m.id === 'emma' ? 'Ring watch' : 'Ring phone'}</button><button>Directions</button></div>`;
}

function renderMarkers() {
  for (const m of Object.values(MEMBERS)) {
    const el = m.marker.getElement(); if (!el) continue;
    const pin = el.querySelector('.pin');
    const moving = m.mph > 0.5;
    pin.classList.toggle('idle', !moving && state.focus !== m.id);
    pin.classList.toggle('moving', m.mph > 8);
    pin.classList.toggle('over', S.speed.on && m.mph > S.speed.limit);
    pin.querySelector('.pin-speed').textContent = `${Math.round(m.mph)} mph`;
  }
}

function renderHood() {
  const m = activeMember();
  const dHome = distTo(m, ZONES.home) / M_PER_MI, dSchool = distTo(m, ZONES.school) / M_PER_MI;
  const anchor = ZONES[S.distance.anchor];
  const dA = distTo(m, anchor) / M_PER_MI;
  const over = S.speed.on && m.mph > S.speed.limit;
  const zone = Object.values(ZONES).find((z) => m.inside[z.id]);
  $('#telemetry').innerHTML = `
    <div class="tm"><small>Tracking</small><b>${m.name}</b></div>
    <div class="tm"><small>Speed</small><b class="${over ? 'crit' : ''}">${m.mph.toFixed(1)} mph</b></div>
    <div class="tm wide"><small>GPS fix · ${m.device}</small><b>${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</b></div>
    <div class="tm"><small>To Home</small><b>${fmtMi(dHome)}</b></div>
    <div class="tm"><small>To School</small><b>${fmtMi(dSchool)}</b></div>
    <div class="tm"><small>Current zone</small><b class="${zone ? 'ok' : ''}">${zone ? zone.short : 'None'}</b></div>
    <div class="tm"><small>Battery</small><b>${Math.round(m.battery)}%</b></div>`;

  const rule = (name, sub, stateTxt, cls) => `<div class="rule ${cls === 'hit' ? 'hit' : ''}"><div class="r-name">${name}<small>${sub}</small></div><span class="r-state ${cls}">${stateTxt}</span></div>`;
  const zoneRule = (z) => rule(`Geofence: ${z.short}`, `radius ${z.r} m · ${fmtMi(distTo(m, z) / M_PER_MI)} away`,
    m.inside[z.id] ? 'INSIDE' : 'OUTSIDE', m.inside[z.id] ? '' : 'off');
  const sh = inSchoolHours();
  $('#rules').innerHTML = [
    zoneRule(ZONES.home), zoneRule(ZONES.school),
    S.speed.on ? rule(`Speed over ${S.speed.limit} mph`, `now ${m.mph.toFixed(0)} mph · top ${Math.round(m.topSpeed)} mph`, over ? 'ALERT' : 'OK', over ? 'hit' : '')
      : rule('Speed alerts', 'turned off', 'OFF', 'off'),
    S.distance.on ? rule(`More than ${fmtMi(S.distance.max)} from ${anchor.short}`, `now ${fmtMi(dA)}`, dA > S.distance.max ? 'ALERT' : 'OK', dA > S.distance.max ? 'warn' : '')
      : rule('Distance alerts', 'turned off', 'OFF', 'off'),
    S.schoolHours.on ? rule('School-hours watch', `8:00 AM – 3:00 PM · ${sh ? 'active now' : 'outside hours'}`, sh ? 'ARMED' : 'IDLE', sh ? '' : 'off')
      : rule('School-hours watch', 'turned off', 'OFF', 'off'),
  ].join('');
}

function renderProgress() {
  const rt = state.route; if (!rt) return;
  const pct = Math.min(100, (state.simT / rt.total) * 100);
  $('#progressBar').style.width = `${pct}%`;
  $('#progressLeft').textContent = `${fmtClock(clockMin())}`;
  $('#progressRight').textContent = `${fmtDur(state.simT)} / ${fmtDur(rt.total)} trip time`;
}

function renderClock() {
  const c = clockMin();
  $('#topClock').textContent = fmtClock(c);
  $('#sbTime').textContent = fmtClock(c, false);
}

function renderActivity() {
  const box = $('#activityList');
  if (!activity.length) { box.innerHTML = '<div class="empty">No activity yet. Press <b>Play</b> to start a scenario.</div>'; return; }
  box.innerHTML = activity.map((a) => `<div class="act"><div class="act-ico ${a.kind}">${ACT_ICON[a.kind] || '•'}</div>
    <div class="act-main"><div class="act-title">${a.title}</div><div class="act-text">${a.body}</div></div><div class="act-time">${a.time}</div></div>`).join('');
}
function renderBadge() { const b = $('#actBadge'); b.textContent = state.unread; b.classList.toggle('show', state.unread > 0); }

function renderPlaces() {
  $('#placesList').innerHTML = Object.values(ZONES).map((z) => `
    <div class="card" data-zone="${z.id}">
      <div class="card-row"><div class="card-ico" style="background:${z.color}">${ICONS[z.id]}</div>
        <div class="card-main"><div class="card-title">${z.name}</div><div class="card-sub">${z.addr}</div></div></div>
      <div class="slider-row"><input type="range" min="50" max="500" step="25" value="${z.r}" data-k="r"><div class="slider-val"><b>${z.r}</b> m</div></div>
      <div class="place-toggles">
        <label><input type="checkbox" data-k="arrive" ${z.arrive ? 'checked' : ''}> Arrivals</label>
        <label><input type="checkbox" data-k="leave" ${z.leave ? 'checked' : ''}> Departures</label>
      </div>
    </div>`).join('');
  $$('#placesList .card').forEach((card) => {
    const z = ZONES[card.dataset.zone];
    const range = $('input[type=range]', card);
    paintRange(range);
    range.addEventListener('input', () => {
      z.r = +range.value; $('.slider-val b', card).textContent = z.r; paintRange(range);
      zoneLayers[z.id].circle.setRadius(z.r);
      settingsChanged();
    });
    $$('input[type=checkbox]', card).forEach((cb) => cb.addEventListener('change', () => { z[cb.dataset.k] = cb.checked; }));
  });
}

function renderAll(force) {
  const now = performance.now();
  if (!force && now - state.lastUi < 90) return;
  state.lastUi = now;
  renderClock(); renderProgress(); renderChips(); renderSheet(); renderMarkers(); renderHood();
}

// ---------- controls ----------
function setPlaying(p) {
  if (p && state.route && state.simT >= state.route.total) { state.simT = 0; loadScenario(SCENARIOS.indexOf(state.scn), { autoplay: true }); return; }
  state.playing = p;
  document.body.classList.toggle('playing', p);
  $('#playLabel').textContent = p ? 'Pause' : (state.simT > 0 && state.simT < (state.route?.total || 0) ? 'Resume' : 'Play');
  if (p && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function setMult(x) { state.mult = x; $$('#speedSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.mult === x)); }
function setTour(on) {
  state.tour = on; clearTimeout(state.tourTimer);
  $('#tourBtn').classList.toggle('on', on);
  $('#tourBtn').textContent = on ? 'Stop story' : 'Run full story';
}
function setTab(tab) {
  state.tab = tab;
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === tab));
  $('#appTitle').textContent = { map: 'Family', places: 'Places', alerts: 'Alerts', activity: 'Activity' }[tab];
  $('.member-chips').style.display = tab === 'map' ? '' : 'none';
  if (tab === 'activity') { state.unread = 0; renderBadge(); }
  if (tab === 'map') setTimeout(() => map.invalidateSize(), 0);
}
function setFocus(id, pan) {
  state.focus = id;
  if (pan) { const m = MEMBERS[id]; state.follow = true; $('#recenterBtn').classList.remove('off'); map.panTo([m.lat, m.lng]); }
  renderAll(true);
}
function settingsChanged() {
  updateDistRing();
  const m = activeMember();
  if (state.route && state.simT > 0) evaluate(m, state.playing ? 0 : 5);
  renderAll(true);
}
function paintRange(r) { r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`); }

$('#playBtn').addEventListener('click', () => setPlaying(!state.playing));
$('#resetBtn').addEventListener('click', () => { setTour(false); loadScenario(SCENARIOS.indexOf(state.scn)); });
$$('#speedSeg button').forEach((b) => b.addEventListener('click', () => setMult(+b.dataset.mult)));
$('#tourBtn').addEventListener('click', () => {
  if (state.tour) { setTour(false); setPlaying(false); return; }
  setTour(true); loadScenario(0, { autoplay: true });
});
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#recenterBtn').addEventListener('click', () => { setFocus(state.focus, true); });
$('#addPlaceBtn').addEventListener('click', () => { const b = $('#addPlaceBtn'); b.textContent = 'Coming soon: drop a pin to add a place'; setTimeout(() => (b.textContent = '+ Add a place'), 2200); });
$('#soundBtn').addEventListener('click', () => { S.sound = !S.sound; $('#soundBtn').textContent = S.sound ? 'Sound on' : 'Sound off'; });
$('#fsBtn').addEventListener('click', toggleFs);
function toggleFs() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); }

const speedLimit = $('#speedLimit'), distMax = $('#distMax');
speedLimit.addEventListener('input', () => { S.speed.limit = +speedLimit.value; $('#speedLimitVal').textContent = S.speed.limit; paintRange(speedLimit); updateExpectLabels(); settingsChanged(); });
distMax.addEventListener('input', () => { S.distance.max = +distMax.value; $('#distMaxVal').textContent = S.distance.max.toFixed(S.distance.max % 1 ? 2 : 1).replace(/0$/, ''); paintRange(distMax); updateExpectLabels(); settingsChanged(); });
$('#speedOn').addEventListener('change', (e) => { S.speed.on = e.target.checked; settingsChanged(); });
$('#distOn').addEventListener('change', (e) => { S.distance.on = e.target.checked; settingsChanged(); });
$('#schoolOn').addEventListener('change', (e) => { S.schoolHours.on = e.target.checked; settingsChanged(); });
$$('#anchorSeg button').forEach((b) => b.addEventListener('click', () => {
  S.distance.anchor = b.dataset.anchor;
  $$('#anchorSeg button').forEach((x) => x.classList.toggle('on', x === b));
  activeMember().distAlerted = false;
  updateExpectLabels(); settingsChanged();
}));
function updateExpectLabels() {
  const a = ZONES[S.distance.anchor].short;
  for (const s of SCENARIOS) for (const e of s.expect) {
    if (e[1] === 'speed') e[0] = `Speed over ${S.speed.limit} mph`;
    if (e[1] === 'distance') e[0] = `More than ${fmtMi(S.distance.max)} from ${a}`;
  }
  renderScenarios();
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  else if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) { setTour(false); loadScenario(+e.code.slice(-1) - 1); }
  else if (e.key === 'r' || e.key === 'R') { setTour(false); loadScenario(SCENARIOS.indexOf(state.scn)); }
  else if (e.key === 'f' || e.key === 'F') toggleFs();
});

// ---------- phone scaling ----------
const PHONE_W = 412, PHONE_H = 868;
function fitPhone() {
  const wrap = $('#deviceWrap');
  const availH = wrap.clientHeight - 40, availW = wrap.clientWidth - 20;
  const s = Math.max(0.5, Math.min(availH / PHONE_H, availW / PHONE_W, 1.1));
  $('#phone').style.transform = `scale(${s})`;
  Object.assign($('#phoneScaler').style, { width: `${PHONE_W * s}px`, height: `${PHONE_H * s}px` });
  map.invalidateSize();
}
window.addEventListener('resize', fitPhone);

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (state.playing && state.route) {
    const dtSim = dt * state.mult;
    state.simT = Math.min(state.route.total, state.simT + dtSim);
    step(dtSim);
    if (state.simT >= state.route.total) finishScenario();
    renderAll(false);
  }
  requestAnimationFrame(frame);
}

// ---------- init ----------
[speedLimit, distMax].forEach(paintRange);
renderPlaces();
updateDistRing();
fitPhone();
log('<span class="k">READY</span> T-Life Family Safety rules engine online');
loadScenario(0);
requestAnimationFrame(frame);
})();
