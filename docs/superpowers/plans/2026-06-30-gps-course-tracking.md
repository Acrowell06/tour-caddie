# GPS Course Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded Riviera CC coordinates in the prototype with a live course data pipeline — Overpass API → localStorage cache → dynamic F/C/B distances and shot tracking for any golf course.

**Architecture:** `tc-course.js` owns all data fetching and caching. `rounds.html` detects the course via GPS/search, loads hole data on "Play with GPS", and stores it in `sessionStorage`. Each active-round page (`s2.html`, `p3.html`, `p5.html`) reads from `sessionStorage` on init and falls back to hardcoded coords when no data exists.

**Tech Stack:** Vanilla JS, Leaflet 1.9.4, Overpass API (`overpass-api.de`), Nominatim (`nominatim.openstreetmap.org`), `localStorage` (30-day TTL cache), `sessionStorage` (round-scoped state), `navigator.geolocation.watchPosition`.

## Global Constraints

- No build step — plain `<script src="...">` tags only; no ES modules
- `tc-course.js` must load before page scripts (`<script src="tc-course.js"></script>` before `<script src="tc-utils.js"></script>` in each active-round page)
- All fetch calls must handle network failure gracefully and fall through to fallback/degraded mode
- Fallback hardcoded coords must remain in `s2.html`, `p3.html`, `p5.html` as a safety net
- Tee colours stored in `sessionStorage` as lowercase keys: `tips`, `gold`, `blue`, `white`, `red`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `pages/tc-course.js` | Overpass fetch, OSM parse, Nominatim search, localStorage cache |
| Modify | `pages/rounds.html` | Real course search (Nominatim), GPS nearby (Overpass), load hole data on Start Round |
| Modify | `pages/s2.html` | Dynamic hole coords from sessionStorage, watchPosition, degraded mode, green auto-suggest |
| Modify | `pages/p3.html` | Same refactor as s2.html for hole 2 (par 3) |
| Modify | `pages/p5.html` | Same refactor as s2.html for hole 9 (par 5) |
| Modify | `pages/tc.css` | `.no-course-banner` style |

---

## Task 1: tc-course.js — Course Data Module

**Files:**
- Create: `pages/tc-course.js`

**Interfaces:**
- Produces: `window.TcCourse` object with methods:
  - `TcCourse.loadNear(lat, lng)` → `Promise<{holes, geoKey}|null>`
  - `TcCourse.searchByName(query)` → `Promise<Array<{name, lat, lng}>>`
  - `TcCourse.nearbyCourses(lat, lng)` → `Promise<Array<{name, lat, lng, dist}>>`
  - `TcCourse.haversineYds(a, b)` → `number` (a,b = `{lat,lng}`)
  - `TcCourse.getCache(geoKey)` → `{holes, geoKey}|null`
  - `TcCourse.setCache(geoKey, data)` → `void`

**Hole object shape produced by `loadNear`:**
```js
{
  number: 7,            // 1-18
  par: 4,               // 3/4/5 or null
  handicap: 5,          // 1-18 or null
  tees: {
    tips:  { lat, lng },
    gold:  { lat, lng },
    blue:  { lat, lng },
    white: { lat, lng },
    red:   { lat, lng }
  },
  green: {              // null if OSM has no green polygon
    center: { lat, lng },
    front:  { lat, lng },
    back:   { lat, lng }
  }
}
```

- [ ] **Step 1: Create `pages/tc-course.js` with cache, haversine, and parseOverpass**

```js
/* tc-course.js — Course data via OpenStreetMap */
window.TcCourse = (() => {
  const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
  const TEE_MAP = { black:'tips', tips:'tips', gold:'gold', blue:'blue', white:'white', red:'red', yellow:'gold' };

  function haversineYds(a, b) {
    const R = 6378137, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(s)) / 0.9144;
  }

  function getCache(geoKey) {
    try {
      const raw = localStorage.getItem('tc_course_' + geoKey);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem('tc_course_' + geoKey); return null; }
      return data;
    } catch { return null; }
  }

  function setCache(geoKey, data) {
    try { localStorage.setItem('tc_course_' + geoKey, JSON.stringify({ ts: Date.now(), data })); } catch {}
  }

  function parseOverpass(json) {
    const nodeMap = {}, wayMap = {};
    for (const el of json.elements) {
      if (el.type === 'node') nodeMap[el.id] = { lat: el.lat, lng: el.lon, tags: el.tags || {} };
      if (el.type === 'way')  wayMap[el.id]  = { nodeIds: el.nodes, tags: el.tags || {} };
    }
    const holes = {};
    for (const el of json.elements) {
      if (el.type !== 'relation' || el.tags?.golf !== 'hole') continue;
      const num = parseInt(el.tags.ref);
      if (!num || num < 1 || num > 18) continue;
      const tees = {};
      let greenData = null, firstTeeLL = null;
      for (const m of (el.members || [])) {
        if (m.type === 'node' && (m.role === 'tee' || m.role?.startsWith('tee'))) {
          const n = nodeMap[m.ref];
          if (!n) continue;
          const key = TEE_MAP[(n.tags.colour || n.tags.tee || 'white').toLowerCase()] || 'white';
          tees[key] = { lat: n.lat, lng: n.lng };
          if (!firstTeeLL) firstTeeLL = { lat: n.lat, lng: n.lng };
        }
        if (m.type === 'way' && m.role === 'green') {
          const w = wayMap[m.ref];
          if (!w) continue;
          const pts = w.nodeIds.map(id => nodeMap[id]).filter(Boolean);
          if (!pts.length) continue;
          const center = {
            lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
            lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length
          };
          const ref = firstTeeLL || center;
          let front = pts[0], back = pts[0], minD = Infinity, maxD = -Infinity;
          for (const p of pts) {
            const d = haversineYds(ref, p);
            if (d < minD) { minD = d; front = p; }
            if (d > maxD) { maxD = d; back = p; }
          }
          greenData = { center, front: { lat: front.lat, lng: front.lng }, back: { lat: back.lat, lng: back.lng } };
        }
      }
      // Fill missing tee colours from any available tee
      const anyTee = Object.values(tees)[0];
      if (anyTee) { for (const k of ['tips','gold','blue','white','red']) { if (!tees[k]) tees[k] = anyTee; } }
      holes[num] = {
        number: num,
        par: parseInt(el.tags.par) || null,
        handicap: parseInt(el.tags.handicap) || null,
        tees,
        green: greenData
      };
    }
    return Object.values(holes).sort((a, b) => a.number - b.number);
  }

  async function fetchOverpass(query) {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: 'data=' + encodeURIComponent(query)
    });
    if (!r.ok) throw new Error('Overpass ' + r.status);
    return r.json();
  }

  async function loadNear(lat, lng) {
    const geoKey = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
    const cached = getCache(geoKey);
    if (cached) return cached;
    const q = `[out:json][timeout:25];(relation["golf"="hole"](around:1000,${lat},${lng}););out body;>;out skel qt;`;
    const json = await fetchOverpass(q);
    const holes = parseOverpass(json);
    if (!holes.length) return null;
    const result = { holes, geoKey };
    setCache(geoKey, result);
    return result;
  }

  async function searchByName(query) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ' golf course')}&format=json&limit=6`;
    const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!r.ok) return [];
    const results = await r.json();
    return results.map(x => ({
      name: x.display_name.split(',').slice(0, 2).join(',').trim(),
      lat: parseFloat(x.lat),
      lng: parseFloat(x.lon)
    }));
  }

  async function nearbyCourses(lat, lng) {
    const q = `[out:json][timeout:10];(way["leisure"="golf_course"](around:5000,${lat},${lng});relation["leisure"="golf_course"](around:5000,${lat},${lng}););out center tags;`;
    const json = await fetchOverpass(q);
    return json.elements
      .filter(el => el.tags?.name)
      .map(el => {
        const elLat = el.center?.lat ?? el.lat;
        const elLng = el.center?.lon ?? el.lon;
        const distMi = (haversineYds({ lat, lng }, { lat: elLat, lng: elLng }) / 1760).toFixed(1);
        return { name: el.tags.name, lat: elLat, lng: elLng, dist: distMi + ' mi' };
      })
      .sort((a, b) => parseFloat(a.dist) - parseFloat(b.dist));
  }

  return { loadNear, searchByName, nearbyCourses, haversineYds, getCache, setCache, parseOverpass };
})();
```

- [ ] **Step 2: Verify in browser console**

Open any page in the prototype, open DevTools console, then:
```js
// Paste tc-course.js content into console or open file directly
// Then test haversine:
TcCourse.haversineYds({lat:34.0462,lng:-118.5090},{lat:34.0496,lng:-118.5085})
// Expected: ~130–145 (yards from Riviera H7 tee to green)

// Test parseOverpass with minimal fixture:
const fixture = { elements: [] };
const result = TcCourse.parseOverpass(fixture);
console.assert(Array.isArray(result) && result.length === 0, 'empty parse ok');

// Test cache round-trip:
TcCourse.setCache('test_key', { holes: [], geoKey: 'test_key' });
const c = TcCourse.getCache('test_key');
console.assert(c?.geoKey === 'test_key', 'cache round-trip ok');
localStorage.removeItem('tc_course_test_key');
```

- [ ] **Step 3: Commit**

```bash
git add pages/tc-course.js
git commit -m "feat: add tc-course.js — Overpass fetch, OSM parse, localStorage cache"
```

---

## Task 2: rounds.html — Course Detection & Data Loading

**Files:**
- Modify: `pages/rounds.html`

**Interfaces:**
- Consumes: `TcCourse.searchByName`, `TcCourse.nearbyCourses`, `TcCourse.loadNear` from Task 1
- Produces: `sessionStorage.tc_active_round` =
  ```js
  { course: {name, lat, lng}, tee: 'white', holes: 18, holes_data: [...] }
  ```

- [ ] **Step 1: Add `<script src="tc-course.js"></script>` before `tc-utils.js` in rounds.html**

Find this in rounds.html:
```html
<script src="tc-utils.js"></script>
```

Replace with:
```html
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
```

- [ ] **Step 2: Replace the static `COURSES` and `NEARBY` arrays and `filterCourses`/`renderCourseTab` functions**

Find the block starting at `const COURSES = [` through the end of `function filterCourses(val) { ... }` (~lines 365–557). Replace it with:

```js
const COURSES_FAV = [
  { name:'Riviera CC',           location:'Pacific Palisades, CA', lat:34.0462, lng:-118.5090, fav:true  },
  { name:'Pebble Beach',         location:'Pebble Beach, CA',      lat:36.5686, lng:-121.9489, fav:true  },
  { name:'Torrey Pines (South)', location:'La Jolla, CA',          lat:32.8983, lng:-117.2517, fav:true  },
  { name:'Augusta National',     location:'Augusta, GA',           lat:33.5021, lng:-82.0202,  fav:false },
  { name:'TPC Sawgrass',         location:'Ponte Vedra Beach, FL', lat:30.1975, lng:-81.3965,  fav:false },
  { name:'Bethpage Black',       location:'Farmingdale, NY',       lat:40.7282, lng:-73.4562,  fav:false },
];
const TEES = [
  { name:'Black',  color:'#1a1a2e', yds:7322, rating:76.1, slope:145 },
  { name:'Blue',   color:'#1a3a8f', yds:6982, rating:74.2, slope:140 },
  { name:'White',  color:'#e0e0e0', yds:6451, rating:71.8, slope:133 },
  { name:'Gold',   color:'#c9a227', yds:5980, rating:69.4, slope:125 },
  { name:'Red',    color:'#c0392b', yds:5320, rating:70.2, slope:128 },
];

function today() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}

/* ── Course tab rendering ── */
function renderCourse(body) {
  body.innerHTML = `
    <div class="setup-step-title">Find Course</div>
    <div class="setup-step-sub">Search by name, pick a favorite, or detect nearby</div>
    <div class="ctabs" id="ctabs">
      <div class="ctab on" onclick="switchCourseTab('search',this)">Search</div>
      <div class="ctab"    onclick="switchCourseTab('favorites',this)">Favorites</div>
      <div class="ctab"    onclick="switchCourseTab('nearby',this)">Nearby</div>
    </div>
    <div id="course-content"></div>
  `;
  sel.courseTab = sel.courseTab || 'search';
  renderCourseTab(sel.courseTab);
}

function switchCourseTab(tab, el) {
  sel.courseTab = tab;
  document.querySelectorAll('#ctabs .ctab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  renderCourseTab(tab);
}

function renderCourseTab(tab) {
  const cont = document.getElementById('course-content');
  if (!cont) return;
  if (tab === 'search') {
    cont.innerHTML = `<input class="course-search-inp" id="course-inp" placeholder="🔍  Search courses…">
      <div id="course-list"></div>`;
    renderCourseList(COURSES_FAV, document.getElementById('course-list'));
    const inp = document.getElementById('course-inp');
    let debounce;
    inp.addEventListener('input', () => {
      clearTimeout(debounce);
      const val = inp.value.trim();
      if (!val) { renderCourseList(COURSES_FAV, document.getElementById('course-list')); return; }
      debounce = setTimeout(async () => {
        const list = document.getElementById('course-list');
        if (!list) return;
        list.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--muted);">Searching…</div>';
        try {
          const results = await TcCourse.searchByName(val);
          if (!results.length) {
            list.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--dim);">No courses found</div>';
          } else {
            renderCourseList(results.map(r => ({ ...r, location: '' })), list);
          }
        } catch {
          list.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--dim);">Search unavailable</div>';
          renderCourseList(COURSES_FAV, list);
        }
      }, 600);
    });
  } else if (tab === 'favorites') {
    cont.innerHTML = '<div id="course-list"></div>';
    renderCourseList(COURSES_FAV.filter(c => c.fav), document.getElementById('course-list'));
  } else {
    cont.innerHTML = `
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">📍 Detecting nearby courses…</div>
      <div id="course-list"><div style="padding:12px;font-size:11px;color:var(--dim);">Checking location…</div></div>`;
    navigator.geolocation?.getCurrentPosition(async pos => {
      const list = document.getElementById('course-list');
      if (!list) return;
      try {
        const courses = await TcCourse.nearbyCourses(pos.coords.latitude, pos.coords.longitude);
        if (!courses.length) {
          list.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--dim);">No courses detected nearby</div>';
        } else {
          renderCourseList(courses.map(c => ({ ...c, location: c.dist })), list);
        }
      } catch {
        list.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--dim);">Location unavailable</div>';
      }
    }, () => {
      const list = document.getElementById('course-list');
      if (list) list.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--dim);">Location permission denied</div>';
    }, { enableHighAccuracy: false, timeout: 8000 });
  }
}

function renderCourseList(list, container) {
  container.innerHTML = '';
  list.forEach(c => {
    const row = document.createElement('div');
    const isSelected = sel.course && sel.course.name === c.name;
    row.className = 'course-row' + (isSelected ? ' selected' : '');
    row.innerHTML = `
      <div class="cr-icon">⛳</div>
      <div class="cr-info">
        <div class="cr-name">${c.name}</div>
        <div class="cr-sub">${c.location || ''}</div>
      </div>
      <div class="cr-right ${c.fav ? 'fav' : ''}">${c.fav ? '★' : ''}</div>
      <div class="cr-check">✓</div>`;
    row.onclick = () => {
      sel.course = c;
      document.querySelectorAll('.course-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      document.getElementById('setup-next-btn').disabled = false;
    };
    container.appendChild(row);
  });
}
```

- [ ] **Step 3: Update `stepNext()` to load hole data before navigating to s2**

Find:
```js
function stepNext() {
  if (!canAdvance()) return;
  if (stepIdx === steps.length - 1) { closeSetup(); navigate('s2'); return; }
  stepIdx++;
  renderStep();
}
```

Replace with:
```js
function stepNext() {
  if (!canAdvance()) return;
  if (stepIdx === steps.length - 1) {
    closeSetup();
    startRound();
    return;
  }
  stepIdx++;
  renderStep();
}

async function startRound() {
  const nextBtn = document.getElementById('setup-next-btn');
  if (nextBtn) { nextBtn.textContent = '⛳ Loading…'; nextBtn.disabled = true; }

  const roundData = {
    course: sel.course,
    tee: (sel.tee || 'white').toLowerCase(),
    holes: sel.holes === '9' ? 9 : 18,
    holes_data: null
  };

  if (sel.course?.lat && sel.course?.lng) {
    try {
      const data = await TcCourse.loadNear(sel.course.lat, sel.course.lng);
      if (data) roundData.holes_data = data.holes;
    } catch {}
  }

  sessionStorage.setItem('tc_active_round', JSON.stringify(roundData));
  navigate('s2');
}
```

- [ ] **Step 4: Verify in browser**

Open rounds.html → tap "⛳ Start Round" → "Play In-App" → wizard opens.
- Search tab: type "Riviera" → Nominatim results appear after ~600ms debounce
- Favorites tab: shows COURSES_FAV favorites immediately
- Nearby tab: browser asks for location permission; if granted, queries nearby golf courses
- Select any course → Continue through steps → "⛳ Play with GPS" taps loads data, navigates to s2.html
- Open DevTools → Application → Session Storage → confirm `tc_active_round` key exists with `course`, `tee`, `holes`, and `holes_data` (may be null if Overpass has no data for the selected coords)

- [ ] **Step 5: Commit**

```bash
git add pages/rounds.html
git commit -m "feat: rounds wizard — real course search via Nominatim + GPS nearby via Overpass"
```

---

## Task 3: s2.html — Dynamic GPS & Live Distance

**Files:**
- Modify: `pages/s2.html`
- Modify: `pages/tc.css`

**Interfaces:**
- Consumes: `sessionStorage.tc_active_round` from Task 2 (`holes_data[6]` = hole 7 at index 6)
- Consumes: `TcCourse.haversineYds` from Task 1
- Produces: Updated shot tracking using real course coords; live F/C/B from `watchPosition`

- [ ] **Step 1: Add `<script src="tc-course.js"></script>` in s2.html before `tc-utils.js`**

Find:
```html
<script src="tc-utils.js"></script>
```
Replace with:
```html
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
```

- [ ] **Step 2: Replace the hardcoded GPS constants block**

Find:
```js
/* ── GPS REFERENCE POINTS (Riviera CC Hole 7, approximate) ── */
const H7_TEE         = { lat: 34.0462, lng: -118.5090 };
const H7_GREEN       = { lat: 34.0496, lng: -118.5085 };
const H7_GREEN_FRONT = { lat: 34.0493, lng: -118.5085 };
const H7_GREEN_BACK  = { lat: 34.0499, lng: -118.5085 };
```

Replace with:
```js
/* ── GPS REFERENCE POINTS — loaded from active round, fallback to Riviera H7 ── */
const _round    = (() => { try { return JSON.parse(sessionStorage.getItem('tc_active_round') || 'null'); } catch { return null; } })();
const _holeData = _round?.holes_data?.find(h => h.number === 7) ?? null;
const _tee      = _round?.tee ?? 'white';

const TEE_LL    = _holeData?.tees?.[_tee]     ?? { lat: 34.0462, lng: -118.5090 };
const GREEN_CTR = _holeData?.green?.center     ?? { lat: 34.0496, lng: -118.5085 };
const GREEN_FRT = _holeData?.green?.front      ?? { lat: 34.0493, lng: -118.5085 };
const GREEN_BCK = _holeData?.green?.back       ?? { lat: 34.0499, lng: -118.5085 };
const DEGRADED  = !_holeData?.green;
```

- [ ] **Step 3: Rename all usages of the old constants throughout s2.html**

These are the exact replacements to make (use find-replace):

| Old | New |
|-----|-----|
| `H7_TEE` | `TEE_LL` |
| `H7_GREEN` (not FRONT/BACK) | `GREEN_CTR` |
| `H7_GREEN_FRONT` | `GREEN_FRT` |
| `H7_GREEN_BACK` | `GREEN_BCK` |

Affected locations:
- `greenSVGToLatLng` — uses `H7_GREEN.lat` / `H7_GREEN.lng` → `GREEN_CTR.lat` / `GREEN_CTR.lng`
- `latLngToSumSVG` — uses `H7_TEE`, `H7_GREEN` → `TEE_LL`, `GREEN_CTR`
- `updateDistanceBar` — uses `H7_GREEN_FRONT`, `H7_GREEN`, `H7_GREEN_BACK` → `GREEN_FRT`, `GREEN_CTR`, `GREEN_BCK`
- Leaflet map center: change `[34.0479, -118.5088]` → `[(TEE_LL.lat + GREEN_CTR.lat)/2, (TEE_LL.lng + GREEN_CTR.lng)/2]`
- Tee marker: `[H7_TEE.lat, H7_TEE.lng]` → `[TEE_LL.lat, TEE_LL.lng]`
- Flag marker: `[H7_GREEN.lat, H7_GREEN.lng]` → `[GREEN_CTR.lat, GREEN_CTR.lng]`
- `s2PendingLatLng` init: `H7_TEE.lat + 0.0007` → `TEE_LL.lat + 0.0007`
- `refreshHolePill`: `prev?.latlng ?? H7_TEE` → `prev?.latlng ?? TEE_LL`
- `s2ConfirmGPS` green view: `fromLL = prev?.latlng ?? H7_TEE` → `prev?.latlng ?? TEE_LL`
- `s2ConfirmGPS` hole view: `fromLL = prev?.latlng ?? H7_TEE` → `prev?.latlng ?? TEE_LL`
- `undoLastS2`: `updateDistanceBar(nowLast.latlng)` already dynamic — no change needed
- `autoDetectFIR`: `haversineYds(H7_TEE, H7_GREEN)` → `TcCourse.haversineYds(TEE_LL, GREEN_CTR)` and `H7_TEE` → `TEE_LL`, `H7_GREEN` → `GREEN_CTR`
- `autoDetectGIR`: `haversineYds(shot.latlng, H7_GREEN)` → `TcCourse.haversineYds(shot.latlng, GREEN_CTR)`
- `updateGreenDragReference`: `haversineYds(prevLL, H7_GREEN)` → `TcCourse.haversineYds(prevLL, GREEN_CTR)` and `prev?.latlng ?? H7_TEE` → `prev?.latlng ?? TEE_LL`
- `greenSVGToLatLng`: the `onMove` callback references `H7_GREEN` via `greenSVGToLatLng` already — the function itself references `GREEN_CTR` after Step 3

- [ ] **Step 4: Add watchPosition for live GPS after shot 1, and green auto-suggest**

Find this block in s2.html (near the top of the `<script>`):
```js
/* ── GPS FLOW ── */
let s2ShotCount = 0;
const s2LoggedShots = [];
const s2ShotLog = [];
```

Add immediately after that block:
```js
/* ── LIVE GPS WATCH ── */
let s2WatchId = null;
let s2GreenSuggestShown = false;

function s2StartLiveGPS() {
  if (!navigator.geolocation || DEGRADED || s2WatchId !== null) return;
  s2WatchId = navigator.geolocation.watchPosition(pos => {
    const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    updateDistanceBar(ll);
    if (!s2GreenSuggestShown && TcCourse.haversineYds(ll, GREEN_CTR) < 50) {
      s2GreenSuggestShown = true;
      showToast('s2-toast', '🟢 Near the green — switch to Green View?', 4000);
    }
  }, null, { enableHighAccuracy: true, maximumAge: 3000 });
}

function s2StopLiveGPS() {
  if (s2WatchId !== null) { navigator.geolocation.clearWatch(s2WatchId); s2WatchId = null; }
}
```

- [ ] **Step 5: Call `s2StartLiveGPS()` after shot 1 is confirmed in `s2ConfirmGPS`**

Find in `s2ConfirmGPS`, the section that fires after confirming a hole-view shot — specifically find:
```js
  document.getElementById('s2-gpsbar').classList.remove('show');
```

The line before it that removes the GPS bar. Right after the `s2ShotCount++` line (very top of `s2ConfirmGPS`), add:
```js
  if (s2ShotCount === 1) s2StartLiveGPS();
```

So the start of `s2ConfirmGPS` becomes:
```js
function s2ConfirmGPS() {
  s2ShotCount++;
  if (s2ShotCount === 1) s2StartLiveGPS();
  let ydsLabel = '';
  ...
```

- [ ] **Step 6: Stop watchPosition when hole is completed (on "Hole Out")**

Find the existing `s2HoleOut` function (or `showSheet`) in s2.html. At the start of whichever function is called when the user taps "Hole Out → Summary", add:
```js
s2StopLiveGPS();
```

- [ ] **Step 7: Add degraded mode banner and suppress F/C/B when DEGRADED**

Find in s2.html the local haversineYds/haversineFt function declarations:
```js
function haversineYds(a, b) {
```

Before that line, add:
```js
/* ── DEGRADED MODE INIT ── */
if (DEGRADED) {
  ['s2-fcb-front','s2-fcb-center','s2-fcb-back'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
}
```

- [ ] **Step 8: Add `.no-course-banner` style to tc.css**

Open `pages/tc.css`. At the end of the file add:
```css
/* ── No-course degraded banner ── */
.no-course-banner {
  background: rgba(231,76,60,0.07);
  border-bottom: 1px solid rgba(231,76,60,0.2);
  color: rgba(231,76,60,0.7);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3px;
  padding: 5px 12px;
  text-align: center;
  flex-shrink: 0;
}
```

Then in Step 7's `if (DEGRADED)` block, add after the forEach:
```js
  const banner = document.createElement('div');
  banner.className = 'no-course-banner';
  banner.textContent = 'No course data — shot tracking only';
  const fcbStrip = document.querySelector('.fcb-strip');
  if (fcbStrip) fcbStrip.parentNode.insertBefore(banner, fcbStrip);
```

- [ ] **Step 9: Verify in browser**

Test path A (with course data): Go through rounds wizard, select "Riviera CC", complete wizard → s2.html loads → open DevTools console → run:
```js
console.log('TEE_LL:', TEE_LL);
console.log('GREEN_CTR:', GREEN_CTR);
console.log('DEGRADED:', DEGRADED);
// Expected: coords should match what was fetched for Riviera if Overpass returned data
// If Overpass returned no data, should show fallback Riviera coords and DEGRADED=true
```

Test path B (degraded): Open s2.html directly (bypass wizard) → no `tc_active_round` in sessionStorage → F/C/B shows "—", red banner appears, map still loads with fallback Riviera coords, shot marking still works.

Test path C (live GPS): On a real device, complete wizard and confirm shot 1 → check that F/C/B values start updating (requires geolocation permission).

- [ ] **Step 10: Commit**

```bash
git add pages/s2.html pages/tc.css
git commit -m "feat: s2.html — dynamic course coords from sessionStorage + watchPosition live GPS + degraded mode"
```

---

## Task 4: p3.html + p5.html — Apply Same Refactor

**Files:**
- Modify: `pages/p3.html`
- Modify: `pages/p5.html`

**Interfaces:**
- Consumes: same `sessionStorage.tc_active_round` as Task 3
- p3.html uses hole 2 → `holes_data.find(h => h.number === 2)`
- p5.html uses hole 9 → `holes_data.find(h => h.number === 9)`

The refactor pattern is identical to Task 3. For each file:

- [ ] **Step 1: Add `<script src="tc-course.js"></script>` before `tc-utils.js` in p3.html**

Find in p3.html:
```html
<script src="tc-utils.js"></script>
```
Replace with:
```html
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
```

- [ ] **Step 2: Replace hardcoded GPS constants in p3.html**

In p3.html, find the block that defines the tee/green constants for hole 2 (the const names will differ but the pattern is the same hardcoded lat/lng block). Replace the entire block with:
```js
/* ── GPS REFERENCE POINTS — loaded from active round, fallback to Riviera H2 ── */
const _round    = (() => { try { return JSON.parse(sessionStorage.getItem('tc_active_round') || 'null'); } catch { return null; } })();
const _holeData = _round?.holes_data?.find(h => h.number === 2) ?? null;
const _tee      = _round?.tee ?? 'white';

const TEE_LL    = _holeData?.tees?.[_tee]     ?? { lat: 34.0471, lng: -118.5102 };
const GREEN_CTR = _holeData?.green?.center     ?? { lat: 34.0468, lng: -118.5095 };
const GREEN_FRT = _holeData?.green?.front      ?? { lat: 34.0466, lng: -118.5095 };
const GREEN_BCK = _holeData?.green?.back       ?? { lat: 34.0470, lng: -118.5095 };
const DEGRADED  = !_holeData?.green;
```

(Use p3.html's existing fallback coords as the `?? { lat, lng }` values — open p3.html, find the current tee/green lat/lng values, and use those as the fallbacks.)

- [ ] **Step 3: Apply same constant renames and watchPosition additions to p3.html**

Apply every change from Task 3 Steps 3–8 to p3.html, using p3-specific element IDs (e.g. `p3-fcb-front`, `p3-toast`, `p3-gpsbar`, etc. — match whatever prefix p3.html uses). The live GPS variable names should use `p3` prefix to avoid collisions:
- `p3WatchId`, `p3GreenSuggestShown`, `p3StartLiveGPS()`, `p3StopLiveGPS()`

- [ ] **Step 4: Repeat Steps 1–3 for p5.html (hole 9)**

Replace constants block with:
```js
const _round    = (() => { try { return JSON.parse(sessionStorage.getItem('tc_active_round') || 'null'); } catch { return null; } })();
const _holeData = _round?.holes_data?.find(h => h.number === 9) ?? null;
const _tee      = _round?.tee ?? 'white';

const TEE_LL    = _holeData?.tees?.[_tee]     ?? { lat: 34.0468, lng: -118.5078 };
const GREEN_CTR = _holeData?.green?.center     ?? { lat: 34.0495, lng: -118.5073 };
const GREEN_FRT = _holeData?.green?.front      ?? { lat: 34.0492, lng: -118.5073 };
const GREEN_BCK = _holeData?.green?.back       ?? { lat: 34.0498, lng: -118.5073 };
const DEGRADED  = !_holeData?.green;
```

Use `p5` prefix for all watchPosition variables/functions.

- [ ] **Step 5: Verify p3.html and p5.html in browser**

Navigate: rounds wizard → Play with GPS → s2.html → complete hole → p3.html → complete hole → p5.html.
At each hole: confirm TEE_LL and GREEN_CTR are logged correctly in console. Confirm degraded mode banner appears only if no course data.

- [ ] **Step 6: Commit**

```bash
git add pages/p3.html pages/p5.html
git commit -m "feat: p3.html + p5.html — same dynamic GPS refactor as s2.html"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| GPS auto-detect course on rounds open | Task 2 — Nearby tab |
| Name search via Nominatim | Task 2 — Search tab |
| Overpass fetch for unknown courses | Task 1 — `loadNear` |
| localStorage cache 30-day TTL | Task 1 — `getCache`/`setCache` |
| sessionStorage for round duration | Task 2 — `startRound()` |
| Degraded mode — F/C/B shows "—" | Task 3 Step 7 |
| Degraded mode — banner | Task 3 Steps 7-8 |
| Shot tracking works in degraded mode | Task 3 — fallback coords always set |
| Tee colour match from wizard | Task 2 — `tee: sel.tee.toLowerCase()` + Task 3 — `_tee` |
| Shot 1 distance from selected tee | Task 3 — `TEE_LL` used as `fromLL` when `s2LoggedShots.length === 0` |
| Shots 2+ from live GPS | Task 3 Steps 4-5 — `watchPosition` starts after shot 1 |
| F/C/B from current position | Task 3 Step 4 — watchPosition callback calls `updateDistanceBar` |
| Green auto-suggest < 50 yards | Task 3 Step 4 — `haversineYds(ll, GREEN_CTR) < 50` |
| watchPosition stops at hole out | Task 3 Step 6 |
| Hole transition resets GPS state | Each hole is a separate page — state resets naturally on navigation |
| p3/p5 same treatment | Task 4 |
| green front = closest to tee, back = farthest | Task 1 — `parseOverpass` greenFrontBack logic |
| Fill missing tee colours from any available | Task 1 — `parseOverpass` anyTee fill loop |
