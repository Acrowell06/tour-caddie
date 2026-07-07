/* ===== TOUR CADDIE — SHARED UTILITIES ===== */

const ORDER = ['login','home','rounds','scan-scorecard','stats','courses','profile','scanner','hole'];
const PAGES = { login:'login.html', home:'home.html', rounds:'rounds.html', 'scan-scorecard':'scan-scorecard.html', stats:'stats.html', courses:'courses.html', profile:'profile.html', scanner:'scanner.html', hole:'hole.html' };

function navigate(key) {
  const cur = document.body.dataset.page;
  const dir = ORDER.indexOf(key) >= ORDER.indexOf(cur) ? 'fwd' : 'back';
  const wrap = document.getElementById('wrap');
  wrap.style.animation = (dir === 'fwd' ? 'slideOutLeft' : 'slideOutRight') +
    ' 0.34s cubic-bezier(0.4,0,0.2,1) forwards';
  setTimeout(() => { window.location.href = PAGES[key] + '?dir=' + dir; }, 320);
}

document.addEventListener('DOMContentLoaded', () => {
  const dir = new URLSearchParams(location.search).get('dir');
  if (!dir) return;
  const wrap = document.getElementById('wrap');
  wrap.style.animation = (dir === 'fwd' ? 'slideInRight' : 'slideInLeft') +
    ' 0.38s cubic-bezier(0.4,0,0.2,1) forwards';
});

/* ── START ROUND CHOICE SHEET ── */
function openRoundChoice(onInApp) {
  const wrap = document.getElementById('wrap');
  const ov = document.createElement('div');
  ov.id = 'rco-ov';
  ov.style.cssText = 'position:absolute;inset:0;z-index:500;';
  ov.innerHTML = `
    <div id="rco-bd" style="position:absolute;inset:0;background:rgba(0,0,0,0);transition:background 0.3s;"></div>
    <div id="rco-sheet" style="position:absolute;left:0;right:0;bottom:0;background:#0A0A0F;border-radius:20px 20px 0 0;border-top:1px solid #1E1E2E;padding:0 0 30px;transform:translateY(100%);transition:transform 0.34s cubic-bezier(0.4,0,0.2,1);">
      <div style="width:36px;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin:10px auto 14px;"></div>
      <div style="font-size:16px;font-weight:900;padding:0 16px 14px;letter-spacing:-0.3px;">Start a Round</div>
      <div style="padding:0 12px;display:flex;flex-direction:column;gap:8px;">
        <button id="rco-inapp" style="width:100%;background:#2ECC71;border:none;border-radius:12px;padding:15px 16px;font-size:14px;font-weight:900;color:#000;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;gap:12px;box-sizing:border-box;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/><path d="M12 6v6l4 2"/></svg>
          <div style="text-align:left;">
            <div>Play In-App</div>
            <div style="font-size:10px;font-weight:600;opacity:0.55;margin-top:2px;">Log shots hole-by-hole with GPS</div>
          </div>
        </button>
        <button id="rco-scan" style="width:100%;background:#141420;border:1px solid #1E1E2E;border-radius:12px;padding:15px 16px;font-size:14px;font-weight:900;color:#fff;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;gap:12px;box-sizing:border-box;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <div style="text-align:left;">
            <div>Scan Scorecard</div>
            <div style="font-size:10px;font-weight:600;opacity:0.4;margin-top:2px;">Photo of paper card → auto-import</div>
          </div>
        </button>
      </div>
    </div>`;
  wrap.appendChild(ov);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.getElementById('rco-bd').style.background = 'rgba(0,0,0,0.65)';
    document.getElementById('rco-sheet').style.transform = 'translateY(0)';
  }));
  function close(cb) {
    const bd = document.getElementById('rco-bd');
    const sh = document.getElementById('rco-sheet');
    if (bd) bd.style.background = 'rgba(0,0,0,0)';
    if (sh) sh.style.transform = 'translateY(100%)';
    setTimeout(() => { ov.remove(); if (cb) cb(); }, 340);
  }
  document.getElementById('rco-bd').addEventListener('click', () => close());
  document.getElementById('rco-inapp').addEventListener('click', () => close(onInApp));
  document.getElementById('rco-scan').addEventListener('click', () => close(() => navigate('scanner')));
}

/* ── MATH ── */
function px2(x1, y1, x2, y2) { return Math.sqrt((x1-x2)**2 + (y1-y2)**2); }

/* ── UI HELPERS ── */
function showToast(id, msg, ms = 2800) {
  const t = document.getElementById(id);
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}

function tt(el) {
  const cls = ['t-g','t-y','t-r'];
  if (cls.some(c => el.classList.contains(c))) cls.forEach(c => el.classList.remove(c));
  else el.classList.add('t-g');
}

function sp(el, id) {
  if (el.classList.contains('pb-off')) return;
  document.querySelectorAll('#' + id + ' .pb').forEach(b => b.classList.remove('pb-on'));
  el.classList.add('pb-on');
}

/* ── SVG SHOT MARKERS + LINES ── */
function addShotMarker(svgId, x, y, num) {
  const svg = document.getElementById(svgId);
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('data-shot', num);

  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', '9');
  circle.setAttribute('fill', 'rgba(46,204,113,0.15)');
  circle.setAttribute('stroke', 'rgba(46,204,113,0.55)'); circle.setAttribute('stroke-width', '1.5');

  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', x); text.setAttribute('y', y + 4);
  text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-size', '10');
  text.setAttribute('fill', 'white'); text.setAttribute('font-weight', '800');
  text.textContent = num;

  g.appendChild(circle); g.appendChild(text);
  svg.appendChild(g);
  return g;
}

function addShotLine(svgId, x1, y1, x2, y2) {
  const svg = document.getElementById(svgId);
  const ns = 'http://www.w3.org/2000/svg';
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y1);
  line.setAttribute('x2', x2); line.setAttribute('y2', y2);
  line.setAttribute('stroke', 'rgba(255,255,255,0.4)');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-dasharray', '4,3');
  svg.appendChild(line);
  return line;
}

/* ── DRAGGABLE GPS MARKERS ── */
function makeDraggable(groupId, svgId, cfg) {
  const svg   = document.getElementById(svgId);
  const group = document.getElementById(groupId);
  if (!svg || !group) return {
    reset() {}, showInitial() {},
    getPosition() { return { x: cfg.baseX, y: cfg.baseY }; },
    setPosition() {}
  };

  let tx = 0, ty = 0, dragging = false, startPt = null, origTx = 0, origTy = 0;

  function toSVG(cx, cy) {
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function refreshPill() {
    const d   = px2(cfg.baseX + tx, cfg.baseY + ty, cfg.pinX, cfg.pinY);
    const val = Math.max(1, Math.round(d * cfg.scale));
    const pill = document.getElementById(cfg.pillId);
    if (pill) pill.textContent = cfg.format(val);
    if (cfg.labelId) {
      const lbl = document.getElementById(cfg.labelId);
      if (lbl) lbl.textContent = cfg.labelFormat(val);
    }
  }

  group.addEventListener('pointerdown', e => {
    dragging = true; group.setPointerCapture(e.pointerId);
    startPt = toSVG(e.clientX, e.clientY);
    origTx = tx; origTy = ty; e.preventDefault();
  });
  group.addEventListener('pointermove', e => {
    if (!dragging || !startPt) return;
    const p = toSVG(e.clientX, e.clientY);
    tx = origTx + (p.x - startPt.x); ty = origTy + (p.y - startPt.y);
    group.setAttribute('transform', `translate(${tx},${ty})`);
    refreshPill();
    if (cfg.onMove) cfg.onMove(cfg.baseX + tx, cfg.baseY + ty);
    e.preventDefault();
  });
  group.addEventListener('pointerup',     () => { dragging = false; });
  group.addEventListener('pointercancel', () => { dragging = false; });

  return {
    reset() {
      tx = 0; ty = 0; group.setAttribute('transform', '');
      const pill = document.getElementById(cfg.pillId);
      if (pill) pill.textContent = cfg.originalText;
      if (cfg.labelId) {
        const lbl = document.getElementById(cfg.labelId);
        if (lbl) {
          const d = px2(cfg.baseX, cfg.baseY, cfg.pinX, cfg.pinY);
          lbl.textContent = cfg.labelFormat(Math.max(1, Math.round(d * cfg.scale)));
        }
      }
    },
    showInitial() { refreshPill(); },
    getPosition() { return { x: cfg.baseX + tx, y: cfg.baseY + ty }; },
    setPosition(x, y) {
      tx = x - cfg.baseX; ty = y - cfg.baseY;
      group.setAttribute('transform', `translate(${tx},${ty})`);
      refreshPill();
    }
  };
}

/* ── MAP PAN + PINCH ZOOM ── */
function makePannable(svgId, gpsBarId) {
  const svg = document.getElementById(svgId);
  if (!svg) return;

  let panX = 0, panY = 0, viewW = 320, viewH = 242;
  const ptrs = new Map();  // active pointers
  let panning = false, startCX, startCY, origPX, origPY;
  let pinching = false, pinchDist0 = 0, pinchW0 = 0, pinchH0 = 0;
  let pinchMidSVG = null, pinchMidScr = null;

  function r()    { return svg.getBoundingClientRect(); }
  function vb()   { return `${panX} ${panY} ${viewW} ${viewH}`; }
  function d2(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  function mid(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }
  function scr2svg(sx, sy) {
    const rc = r();
    return { x: panX + ((sx - rc.left) / rc.width) * viewW,
             y: panY + ((sy - rc.top)  / rc.height) * viewH };
  }

  svg.addEventListener('pointerdown', e => {
    if (e.target.closest('.draggable-marker')) return;
    if (gpsBarId && document.getElementById(gpsBarId)?.classList.contains('show')) return;
    ptrs.set(e.pointerId, e);
    svg.setPointerCapture(e.pointerId);

    if (ptrs.size === 1) {
      panning = true; pinching = false;
      startCX = e.clientX; startCY = e.clientY;
      origPX = panX; origPY = panY;
    } else if (ptrs.size === 2) {
      panning = false; pinching = true;
      const [a, b] = [...ptrs.values()];
      pinchDist0 = d2(a, b);
      pinchW0 = viewW; pinchH0 = viewH;
      const m = mid(a, b);
      pinchMidSVG = scr2svg(m.x, m.y);
      pinchMidScr = m;
    }
    e.preventDefault();
  });

  svg.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, e);

    if (panning && ptrs.size === 1) {
      const s = viewW / r().width;
      panX = origPX - (e.clientX - startCX) * s;
      panY = origPY - (e.clientY - startCY) * s;
      svg.setAttribute('viewBox', vb());
    } else if (pinching && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const ratio = pinchDist0 / d2(a, b);  // >1 = zoom in (fingers spreading)
      viewW = Math.max(120, Math.min(320, pinchW0 * ratio));
      viewH = viewW * (242 / 320);
      const m   = mid(a, b);
      const rc  = r();
      panX = pinchMidSVG.x - ((m.x - rc.left) / rc.width)  * viewW;
      panY = pinchMidSVG.y - ((m.y - rc.top)  / rc.height) * viewH;
      svg.setAttribute('viewBox', vb());
    }
    e.preventDefault();
  });

  function onEnd(e) {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinching = false;
    if (ptrs.size === 0) { panning = false; return; }
    if (ptrs.size === 1) {
      // One finger lifted during pinch — resume pan from remaining finger
      const rem = [...ptrs.values()][0];
      panning = true;
      startCX = rem.clientX; startCY = rem.clientY;
      origPX = panX; origPY = panY;
    }
  }
  svg.addEventListener('pointerup',     onEnd);
  svg.addEventListener('pointercancel', onEnd);
}

/* ── TAP-TO-PLACE ── */
function addTapToPlace(svgId, gpsBarId, getDragFn) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  svg.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;  // ignore second finger during pinch
    if (!document.getElementById(gpsBarId)?.classList.contains('show')) return;
    if (e.target.closest('.draggable-marker')) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    getDragFn().setPosition(p.x, p.y);
    e.preventDefault();
  });
}

/* ── WEATHER (Open-Meteo — free, no API key) ── */
const WX_CACHE_TTL = 15 * 60 * 1000;

const WMO_CODES = {
  0:  { text: 'Clear',              icon: '☀️' },
  1:  { text: 'Mainly Clear',       icon: '🌤️' },
  2:  { text: 'Partly Cloudy',      icon: '⛅' },
  3:  { text: 'Overcast',           icon: '☁️' },
  45: { text: 'Fog',                icon: '🌫️' },
  48: { text: 'Fog',                icon: '🌫️' },
  51: { text: 'Light Drizzle',      icon: '🌦️' },
  53: { text: 'Drizzle',            icon: '🌦️' },
  55: { text: 'Heavy Drizzle',      icon: '🌦️' },
  56: { text: 'Freezing Drizzle',   icon: '🌦️' },
  57: { text: 'Freezing Drizzle',   icon: '🌦️' },
  61: { text: 'Light Rain',         icon: '🌧️' },
  63: { text: 'Rain',               icon: '🌧️' },
  65: { text: 'Heavy Rain',         icon: '🌧️' },
  66: { text: 'Freezing Rain',      icon: '🌧️' },
  67: { text: 'Freezing Rain',      icon: '🌧️' },
  71: { text: 'Light Snow',         icon: '🌨️' },
  73: { text: 'Snow',               icon: '🌨️' },
  75: { text: 'Heavy Snow',         icon: '🌨️' },
  77: { text: 'Snow Grains',        icon: '🌨️' },
  80: { text: 'Rain Showers',       icon: '🌦️' },
  81: { text: 'Rain Showers',       icon: '🌦️' },
  82: { text: 'Heavy Rain Showers', icon: '🌦️' },
  85: { text: 'Snow Showers',       icon: '🌨️' },
  86: { text: 'Snow Showers',       icon: '🌨️' },
  95: { text: 'Thunderstorm',       icon: '⛈️' },
  96: { text: 'Thunderstorm/Hail',  icon: '⛈️' },
  99: { text: 'Thunderstorm/Hail',  icon: '⛈️' },
};

function getWeatherCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > WX_CACHE_TTL) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function setWeatherCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

async function fetchWeather(lat, lng) {
  const key = 'tc_wx_' + lat.toFixed(2) + '_' + lng.toFixed(2);
  const cached = getWeatherCache(key);
  if (cached) return cached;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const json = await r.json();
    if (!json.current) return null;
    const data = {
      tempF:       Math.round(json.current.temperature_2m),
      weatherCode: json.current.weather_code,
      windMph:     Math.round(json.current.wind_speed_10m),
      windDirDeg:  json.current.wind_direction_10m
    };
    setWeatherCache(key, data);
    return data;
  } catch {
    return null;
  }
}

// Great-circle initial bearing (degrees, 0-360) from point a to point b.
function bearingDeg(a, b) {
  const r = Math.PI / 180;
  const phi1 = a.lat * r, phi2 = b.lat * r;
  const dLambda = (b.lng - a.lng) * r;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// 8-point compass letter for a true-north-relative bearing in degrees.
function compassLetter(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// Caddie-style descriptor for wind direction relative to the hole's playing
// direction (0deg = wind blowing from the target toward the tee = headwind).
function windBucketLabel(relativeAngle) {
  const a = ((relativeAngle % 360) + 360) % 360;
  if (a >= 315 || a < 45)  return 'INTO';
  if (a >= 45  && a < 135) return 'R→L';
  if (a >= 135 && a < 225) return 'HELPING';
  return 'L→R';
}
