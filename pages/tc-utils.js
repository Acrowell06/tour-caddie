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
    <div id="rco-sheet" style="position:absolute;left:0;right:0;bottom:0;background:var(--bg);border-radius:20px 20px 0 0;border-top:1px solid var(--border);padding:0 0 30px;transform:translateY(100%);transition:transform 0.34s cubic-bezier(0.4,0,0.2,1);">
      <div style="width:36px;height:4px;background:rgb(var(--ink-rgb) / 0.15);border-radius:2px;margin:10px auto 14px;"></div>
      <div style="font-size:16px;font-weight:900;padding:0 16px 14px;letter-spacing:-0.3px;">Start a Round</div>
      <div style="padding:0 12px;display:flex;flex-direction:column;gap:8px;">
        <button id="rco-inapp" style="width:100%;background:var(--accent);border:none;border-radius:12px;padding:15px 16px;font-size:14px;font-weight:900;color:var(--text-on-accent);cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;gap:12px;box-sizing:border-box;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-on-accent)" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/><path d="M12 6v6l4 2"/></svg>
          <div style="text-align:left;">
            <div>Play In-App</div>
            <div style="font-size:10px;font-weight:600;opacity:0.55;margin-top:2px;">Log shots hole-by-hole with GPS</div>
          </div>
        </button>
        <button id="rco-scan" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:15px 16px;font-size:14px;font-weight:900;color:var(--text);cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;gap:12px;box-sizing:border-box;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--ink-rgb) / 0.7)" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <div style="text-align:left;">
            <div>Scan Scorecard</div>
            <div style="font-size:10px;font-weight:600;opacity:0.4;margin-top:2px;">Photo of paper card → auto-import</div>
          </div>
        </button>
      </div>
    </div>`;
  wrap.appendChild(ov);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.getElementById('rco-bd').style.background = 'rgb(var(--shadow-rgb) / 0.65)';
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
