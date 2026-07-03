# Weather Conditions & True Wind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded wind reading on the hole-tracking dial (`8 mph`, fixed `rotate(225)`) with live Open-Meteo wind data shown relative to the hole's playing direction, and add a live conditions banner (temp/condition/wind) to the home screen.

**Architecture:** A new set of pure/shared functions in `pages/tc-utils.js` (already loaded by every page) handles the Open-Meteo fetch, localStorage caching, and small math/formatting helpers. `home.html` calls these once on load using device GPS to populate a fixed banner under its header. `hole.html` calls them once per round using the course's tee coordinate, computes wind direction relative to the tee→green bearing, and drives the existing (currently hardcoded) wind dial markup.

**Tech Stack:** Vanilla JS, no build step, [Open-Meteo](https://open-meteo.com) current-weather REST API (free, no key, CORS-enabled), `localStorage` (15-min TTL cache), `navigator.geolocation.getCurrentPosition`.

## Global Constraints

- No build step — plain `<script src="...">` tags only; no ES modules, no bundler.
- No backend, no API key — all weather calls are direct client-side `fetch()` to `api.open-meteo.com`.
- `pages/tc-utils.js` must continue to load before each page's inline `<script>` block (already the case in `home.html` and `hole.html` — do not reorder).
- Cache key prefix `tc_wx_` with 15-minute (`15 * 60 * 1000` ms) TTL, mirroring the existing `tc_course_*` cache pattern in `pages/tc-course.js`.
- On any failure (geolocation denied, network error, non-200 response) the affected UI must hide/stay hidden — never fabricate a temperature, condition, or wind value.
- This codebase has no automated test runner (no `package.json`, no test framework) — verification is done by hand via browser DevTools console (`console.assert`), matching the existing convention used in `docs/superpowers/plans/2026-06-30-gps-course-tracking.md`.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `pages/tc-utils.js` | `fetchWeather`, `bearingDeg`, `compassLetter`, `windBucketLabel`, `WMO_CODES` — shared weather fetch/cache/math, used by both pages |
| Modify | `pages/home.html` | Fixed conditions banner under the header, populated from device GPS |
| Modify | `pages/hole.html` | Replace hardcoded wind dial with live, relative-to-hole-direction wind data |

---

## Task 1: tc-utils.js — Weather Utilities

**Files:**
- Modify: `pages/tc-utils.js`

**Interfaces:**
- Produces:
  - `async function fetchWeather(lat, lng)` → `Promise<{tempF, weatherCode, windMph, windDirDeg}|null>`
  - `function bearingDeg(a, b)` → `number` (0–360, `a`/`b` = `{lat, lng}`)
  - `function compassLetter(deg)` → `string` (`'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW'`)
  - `function windBucketLabel(relativeAngle)` → `string` (`'INTO'|'HELPING'|'L→R'|'R→L'`)
  - `const WMO_CODES` → `{ [code:number]: { text: string, icon: string } }`

- [ ] **Step 1: Append weather utilities to the end of `pages/tc-utils.js`**

Find the end of the file (the last function currently defined):

```js
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
```

Append immediately after it:

```js

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
```

- [ ] **Step 2: Verify pure helpers in browser console**

Open any page that loads `tc-utils.js` (e.g. `pages/home.html`) in a browser, open DevTools console, and paste:

```js
console.assert(Math.round(bearingDeg({lat:34.00,lng:-118.00},{lat:34.01,lng:-118.00})) === 0,  'due north bearing ~0');
console.assert(Math.round(bearingDeg({lat:34.00,lng:-118.00},{lat:34.00,lng:-117.99})) === 90, 'due east bearing ~90');
console.assert(compassLetter(0)   === 'N',  'compass 0 = N');
console.assert(compassLetter(90)  === 'E',  'compass 90 = E');
console.assert(compassLetter(360) === 'N',  'compass 360 wraps to N');
console.assert(windBucketLabel(0)   === 'INTO',    'bucket 0 = INTO');
console.assert(windBucketLabel(90)  === 'R→L',     'bucket 90 = R→L');
console.assert(windBucketLabel(180) === 'HELPING', 'bucket 180 = HELPING');
console.assert(windBucketLabel(270) === 'L→R',     'bucket 270 = L→R');
console.assert(windBucketLabel(316) === 'INTO',    'bucket 316 wraps to INTO');
console.assert(WMO_CODES[0].text === 'Clear', 'WMO 0 = Clear');
console.log('All assertions passed if no red "Assertion failed" lines appear above.');
```

Expected: no `Assertion failed` messages logged.

- [ ] **Step 3: Verify `fetchWeather` network + cache round-trip in browser console**

In the same console:

```js
const wx1 = await fetchWeather(34.0462, -118.5090);
console.log('wx1:', wx1);
console.assert(wx1 && typeof wx1.tempF === 'number' && typeof wx1.windDirDeg === 'number', 'fetchWeather returned expected shape');
console.assert(localStorage.getItem('tc_wx_34.05_-118.51') !== null, 'cache entry was written');

// Second call should hit the cache — open the Network tab first and confirm
// no new request to api.open-meteo.com fires for this call:
const wx2 = await fetchWeather(34.0462, -118.5090);
console.assert(JSON.stringify(wx1) === JSON.stringify(wx2), 'cached call returns identical data');

localStorage.removeItem('tc_wx_34.05_-118.51'); // cleanup
```

Expected: `wx1` logs an object with `tempF`, `weatherCode`, `windMph`, `windDirDeg`; both assertions pass; Network tab shows only one request to `api.open-meteo.com` across both calls.

- [ ] **Step 4: Commit**

```bash
git add pages/tc-utils.js
git commit -m "feat: add shared weather fetch/cache utilities (Open-Meteo)"
```

---

## Task 2: home.html — Weather Conditions Banner

**Files:**
- Modify: `pages/home.html`

**Interfaces:**
- Consumes: `fetchWeather(lat, lng)`, `WMO_CODES`, `compassLetter(deg)` from Task 1

- [ ] **Step 1: Add `.wx-strip` CSS**

Find in `pages/home.html`:

```css
.add-widget-btn:active { transform:scale(0.98); }

/* ─── PGA LEADERBOARD STRIP ─── */
```

Replace with:

```css
.add-widget-btn:active { transform:scale(0.98); }

/* ─── WEATHER CONDITIONS STRIP ─── */
.wx-strip { display:none; align-items:center; gap:6px; padding:2px 16px 8px; font-size:11px; font-weight:600; color:var(--muted); flex-shrink:0; }
.wx-strip.show { display:flex; }

/* ─── PGA LEADERBOARD STRIP ─── */
```

- [ ] **Step 2: Insert the banner element under the header**

Find:

```html
    <button id="edit-btn" onclick="toggleEdit()"
      style="background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.22);border-radius:8px;
             padding:5px 13px;font-size:11px;font-weight:700;color:var(--green);cursor:pointer;
             font-family:Inter,sans-serif;transition:all 0.15s;margin-bottom:2px;">
      Edit
    </button>
  </div>

  <!-- Scrollable widget area -->
```

Replace with:

```html
    <button id="edit-btn" onclick="toggleEdit()"
      style="background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.22);border-radius:8px;
             padding:5px 13px;font-size:11px;font-weight:700;color:var(--green);cursor:pointer;
             font-family:Inter,sans-serif;transition:all 0.15s;margin-bottom:2px;">
      Edit
    </button>
  </div>

  <!-- Weather conditions strip — hidden until device location + fetch succeed -->
  <div class="wx-strip" id="wx-strip"></div>

  <!-- Scrollable widget area -->
```

- [ ] **Step 3: Add `initWeatherBanner()` and call it on load**

Find:

```js
/* ══ INIT ══ */
renderWidgets();
renderLeaderboard();
```

Replace with:

```js
/* ══ WEATHER BANNER ══ */
function initWeatherBanner() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async pos => {
    const wx = await fetchWeather(pos.coords.latitude, pos.coords.longitude);
    if (!wx) return;
    const wmo = WMO_CODES[wx.weatherCode] || { text: 'Unknown', icon: '🌡️' };
    const strip = document.getElementById('wx-strip');
    if (!strip) return;
    strip.textContent = `${wmo.icon} ${wx.tempF}° · ${wmo.text} · Wind ${wx.windMph} ${compassLetter(wx.windDirDeg)}`;
    strip.classList.add('show');
  }, () => {}, { enableHighAccuracy: false, timeout: 8000 });
}

/* ══ INIT ══ */
renderWidgets();
renderLeaderboard();
initWeatherBanner();
```

- [ ] **Step 4: Verify in browser**

Serve the `pages/` directory over HTTP (geolocation requires a secure context — `file://` may block it in some browsers), e.g.:

```bash
cd pages && python3 -m http.server 8080
```

Open `http://localhost:8080/home.html`:
- Allow the location permission prompt → within a few seconds, a small line should appear under "John Doe" reading something like `⛅ 72° · Partly Cloudy · Wind 8 NW`.
- Reload and deny the location permission → the strip stays absent (no empty box, no placeholder text).
- Open DevTools → Application → Local Storage → confirm a `tc_wx_<lat>_<lng>` key exists.

- [ ] **Step 5: Commit**

```bash
git add pages/home.html
git commit -m "feat: home.html — live weather conditions strip from device GPS"
```

---

## Task 3: hole.html — Live Relative Wind Dial

**Files:**
- Modify: `pages/hole.html`

**Interfaces:**
- Consumes: `fetchWeather(lat, lng)`, `bearingDeg(a, b)`, `windBucketLabel(relativeAngle)` from Task 1; existing `TEE_LL`, `GREEN_CTR`, `DEGRADED` constants already defined in `hole.html`

- [ ] **Step 1: Replace the hardcoded wind dial markup**

Find in `pages/hole.html`:

```html
    <!-- Wind indicator (HTML overlay — stays fixed, not in SVG) -->
    <div class="wind-ov">
      <svg width="34" height="34" viewBox="-17 -17 34 34" style="display:block;">
        <!-- Dial background -->
        <circle r="16" fill="rgba(10,10,15,0.88)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
        <!-- Cardinal tick marks -->
        <line x1="0" y1="-16" x2="0" y2="-13" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <line x1="16"  y1="0" x2="13"  y2="0" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <line x1="0"  y1="16" x2="0"  y2="13" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <line x1="-16" y1="0" x2="-13" y2="0" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <!-- Cardinal labels -->
        <text x="0"   y="-9"  text-anchor="middle" font-size="5.5" fill="rgba(255,255,255,0.55)" font-weight="700">N</text>
        <text x="9.5" y="3.5" text-anchor="middle" font-size="5.5" fill="rgba(255,255,255,0.3)"  font-weight="700">E</text>
        <text x="0"   y="13"  text-anchor="middle" font-size="5.5" fill="rgba(255,255,255,0.3)"  font-weight="700">S</text>
        <text x="-9.5" y="3.5" text-anchor="middle" font-size="5.5" fill="rgba(255,255,255,0.3)" font-weight="700">W</text>
        <!-- Wind arrow — rotate(225) = SW direction (wind coming from SW) -->
        <g transform="rotate(225)">
          <line x1="0" y1="5" x2="0" y2="-8" stroke="rgba(241,196,15,0.95)" stroke-width="2" stroke-linecap="round"/>
          <polygon points="0,-12 -3,-7 3,-7" fill="rgba(241,196,15,0.95)"/>
          <!-- Tail feathers -->
          <line x1="-3" y1="5" x2="3" y2="5" stroke="rgba(241,196,15,0.6)" stroke-width="1.5" stroke-linecap="round"/>
        </g>
      </svg>
      <div class="wind-spd">8 mph</div>
    </div>
```

Replace with:

```html
    <!-- Wind indicator (HTML overlay — stays fixed, not in SVG). Hidden by
         default; initWindDial() reveals it once live wind data resolves. -->
    <div class="wind-ov" id="h-wind-ov" style="display:none;">
      <svg width="34" height="34" viewBox="-17 -17 34 34" style="display:block;">
        <!-- Dial background -->
        <circle r="16" fill="rgba(10,10,15,0.88)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
        <!-- 90-degree tick marks (relative-to-hole dial has no cardinal labels) -->
        <line x1="0" y1="-16" x2="0" y2="-13" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <line x1="16"  y1="0" x2="13"  y2="0" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <line x1="0"  y1="16" x2="0"  y2="13" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <line x1="-16" y1="0" x2="-13" y2="0" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <!-- Wind arrow — rotation set by initWindDial() to the live relative angle -->
        <g id="h-wind-arrow" transform="rotate(0)">
          <line x1="0" y1="5" x2="0" y2="-8" stroke="rgba(241,196,15,0.95)" stroke-width="2" stroke-linecap="round"/>
          <polygon points="0,-12 -3,-7 3,-7" fill="rgba(241,196,15,0.95)"/>
          <!-- Tail feathers -->
          <line x1="-3" y1="5" x2="3" y2="5" stroke="rgba(241,196,15,0.6)" stroke-width="1.5" stroke-linecap="round"/>
        </g>
      </svg>
      <div class="wind-spd" id="h-wind-spd">— mph</div>
    </div>
```

- [ ] **Step 2: Add `initWindDial()` after the DEGRADED-mode init block**

Find in `pages/hole.html`:

```js
  // Green View has nothing real to show without a mapped green — disable it
  // instead of presenting a distance-to-pin view anchored to nowhere.
  const greenBtn = document.getElementById('h-view-green');
  if (greenBtn) {
    greenBtn.style.opacity = '0.35';
    greenBtn.style.pointerEvents = 'none';
    greenBtn.title = 'No green location for this hole';
  }
}

/* ── DISTANCE + COORDINATE UTILITIES ── */
```

Replace with:

```js
  // Green View has nothing real to show without a mapped green — disable it
  // instead of presenting a distance-to-pin view anchored to nowhere.
  const greenBtn = document.getElementById('h-view-green');
  if (greenBtn) {
    greenBtn.style.opacity = '0.35';
    greenBtn.style.pointerEvents = 'none';
    greenBtn.title = 'No green location for this hole';
  }
}

/* ── LIVE WIND DIAL — relative to this hole's tee-to-green direction.
   Requires a real green (for bearing), so it's skipped entirely when
   DEGRADED, same reasoning as the flag marker above. ── */
async function initWindDial() {
  if (DEGRADED) return;
  const wx = await fetchWeather(TEE_LL.lat, TEE_LL.lng);
  if (!wx) return;
  const holeBearing   = bearingDeg(TEE_LL, GREEN_CTR);
  const relativeAngle = ((wx.windDirDeg - holeBearing) % 360 + 360) % 360;
  const arrow = document.getElementById('h-wind-arrow');
  const spd   = document.getElementById('h-wind-spd');
  const ov    = document.getElementById('h-wind-ov');
  if (arrow) arrow.setAttribute('transform', `rotate(${relativeAngle})`);
  if (spd)   spd.textContent = `${wx.windMph} mph · ${windBucketLabel(relativeAngle)}`;
  if (ov)    ov.style.display = 'flex';
}
initWindDial();

/* ── DISTANCE + COORDINATE UTILITIES ── */
```

- [ ] **Step 3: Verify degraded (hidden) path in browser**

Serve `pages/` over HTTP (see Task 2 Step 4) and open `http://localhost:8080/hole.html` directly, with no prior round set up:

```js
console.log('DEGRADED:', DEGRADED); // expect true — no sessionStorage round data
```

Confirm the wind widget (top-left of the map) is **not visible** — `document.getElementById('h-wind-ov').style.display` should read `"none"`.

- [ ] **Step 4: Verify live path in browser**

In the same page's console, inject a fake active round with real tee/green coordinates, then reload:

```js
sessionStorage.setItem('tc_active_round', JSON.stringify({
  course: { name: 'Test Course', lat: 34.0462, lng: -118.5090 },
  tee: 'white',
  holeSequence: [1],
  currentHoleIdx: 0,
  holes_data: [{
    number: 1, par: 4, handicap: 1,
    tees: { white: { lat: 34.0462, lng: -118.5090 } },
    green: {
      center: { lat: 34.0496, lng: -118.5085 },
      front:  { lat: 34.0493, lng: -118.5085 },
      back:   { lat: 34.0499, lng: -118.5085 }
    }
  }]
}));
location.reload();
```

After reload, confirm in console:

```js
console.log('DEGRADED:', DEGRADED); // expect false
```

Within a few seconds, the wind widget should become visible with a real `windMph` value and one of `INTO` / `HELPING` / `L→R` / `R→L` next to it (not the old static `8 mph`). Clean up afterward:

```js
sessionStorage.removeItem('tc_active_round');
```

- [ ] **Step 5: Commit**

```bash
git add pages/hole.html
git commit -m "feat: hole.html — live wind dial relative to hole direction (replaces hardcoded 8mph)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Open-Meteo fetch, no API key | Task 1 — `fetchWeather` |
| 15-min localStorage cache, `tc_wx_*` keys | Task 1 — `getWeatherCache`/`setWeatherCache`, `WX_CACHE_TTL` |
| WMO weather code → text/icon | Task 1 — `WMO_CODES` |
| Home screen: device GPS → fetch → banner | Task 2 — `initWeatherBanner` |
| Home screen: banner shows temp + condition + wind (true compass) | Task 2 Step 3 — uses `compassLetter` |
| Home screen: hide gracefully on denial/failure | Task 2 Step 3 — early `return` on no geolocation / null `wx` |
| Home screen: banner is fixed, not part of widget grid | Task 2 Step 2 — inserted outside `#widget-grid` |
| Hole dial: fetch once per round using tee coord | Task 3 Step 2 — `fetchWeather(TEE_LL.lat, TEE_LL.lng)`, cached via Task 1 |
| Hole dial: relative-to-hole-direction (not true compass) | Task 3 Step 2 — `bearingDeg` + `relativeAngle` |
| Hole dial: remove cardinal labels | Task 3 Step 1 — `<text>` N/E/S/W elements removed |
| Hole dial: INTO/HELPING/L→R/R→L descriptor | Task 1 — `windBucketLabel`; Task 3 Step 2 — used in `spd.textContent` |
| Hole dial: hide widget on failure/DEGRADED | Task 3 Step 2 — early `return` when `DEGRADED` or `wx` is null |
| No fabricated values on failure anywhere | Task 1 (`fetchWeather` returns `null`), Task 2 Step 3, Task 3 Step 2 |

**Placeholder scan:** No `TBD`/`TODO` strings; every step has complete, runnable code.

**Type consistency:** `fetchWeather` return shape (`tempF`, `weatherCode`, `windMph`, `windDirDeg`) is identical across Task 1's definition, Task 2's consumption, and Task 3's consumption. `bearingDeg`/`windBucketLabel`/`compassLetter` signatures match between definition and call sites.
