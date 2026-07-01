# Manual Tee & Green Marking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let golfers manually mark a hole's tee and green on the satellite map when OSM course data is missing, and remember that mark for future rounds at the same course.

**Architecture:** `tc-course.js` gains two small functions (`geoKeyFor`, `saveManualHole`) so manual marks are stored in the exact same cache and data shape as OSM-sourced holes — nothing downstream needs to know the difference. `rounds.html` starts persisting the course's `geoKey` into round state (it currently computes one but throws it away). `hole.html` gains a new "Mark This Hole" panel that appears instead of the normal shot-tracking UI whenever the active hole is degraded, walks the golfer through whichever of tee/green-front/green-center/green-back is actually missing using a single draggable Leaflet pin, then saves and reloads into the now-non-degraded normal tracking screen.

**Tech Stack:** Vanilla JS, Leaflet 1.9.4 (already loaded on `hole.html`), `localStorage` (via existing `TcCourse` cache), `sessionStorage` (`tc_active_round`). No build step, no new dependencies.

## Global Constraints

- No build step — plain `<script>` tags only; no ES modules.
- Manual marks must produce data in the exact same shape `TcCourse` already produces: `{ number, par, handicap, tees, green: { center, front, back } }`. No new/parallel data format.
- A tee mark is written only under the tee color that was selected for the current round (`_round.tee` in `hole.html`) — never copied to the other four tee-color keys.
- A green mark applies to all tee colors (write once to `hole.green`, not per-color).
- Reuse existing UI primitives — the same Leaflet map/marker mechanics already used for shot placement in `hole.html` — no new interaction paradigm or library.
- The marking flow must be skippable at every step, discarding all progress in that attempt (no partial saves), falling back to today's plain degraded behavior (banner, no distances, shot tracking still works).

---

### Task 1: tc-course.js — `geoKeyFor()` and `saveManualHole()`

**Files:**
- Modify: `pages/tc-course.js`

**Interfaces:**
- Produces: `TcCourse.geoKeyFor(lat, lng)` → `string`; `TcCourse.saveManualHole(geoKey, holeNumber, patch)` → `void`, where `patch = { teeColor?: string, teeLL?: {lat,lng}, green?: {front:{lat,lng}, center:{lat,lng}, back:{lat,lng}} }`.
- Consumes: existing `getCache(geoKey)` / `setCache(geoKey, data)` in the same file (both already defined, unchanged).

- [ ] **Step 1: Add `geoKeyFor` and use it inside `loadNear`**

Find in `pages/tc-course.js`:
```js
  function centroid(pts) {
```

Insert immediately before it:
```js
  function geoKeyFor(lat, lng) {
    return `${lat.toFixed(3)}_${lng.toFixed(3)}`;
  }

  function centroid(pts) {
```

Find:
```js
  async function loadNear(lat, lng) {
    try {
      const geoKey = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
      const cached = getCache(geoKey);
```

Replace with:
```js
  async function loadNear(lat, lng) {
    try {
      const geoKey = geoKeyFor(lat, lng);
      const cached = getCache(geoKey);
```

- [ ] **Step 2: Add `saveManualHole`**

Find:
```js
  async function searchByName(query) {
```

Insert immediately before it:
```js
  // Merges a manually-marked tee and/or green into the cached course entry
  // for geoKey, in the exact same shape loadNear()/parseOverpass() already
  // produce, so nothing downstream needs to know a hole's data came from a
  // user's own pin drop instead of OpenStreetMap. Creates a stub hole entry
  // if this hole wasn't in the cache at all (e.g. the course had zero OSM
  // coverage for it).
  function saveManualHole(geoKey, holeNumber, patch) {
    if (!geoKey || !holeNumber) return;
    try {
      const cached = getCache(geoKey) || { holes: [], geoKey };
      let hole = cached.holes.find(h => h.number === holeNumber);
      if (!hole) {
        hole = { number: holeNumber, par: null, handicap: null, tees: {}, green: null };
        cached.holes.push(hole);
        cached.holes.sort((a, b) => a.number - b.number);
      }
      if (patch.teeColor && patch.teeLL) {
        hole.tees = { ...hole.tees, [patch.teeColor]: patch.teeLL };
      }
      if (patch.green) {
        hole.green = patch.green;
      }
      setCache(geoKey, cached);
    } catch {}
  }

  async function searchByName(query) {
```

- [ ] **Step 3: Expose both on the returned API**

Find:
```js
  return { loadNear, searchByName, nearbyCourses, haversineYds, getCache, setCache, parseOverpass, parseOverpassWays };
```

Replace with:
```js
  return { loadNear, searchByName, nearbyCourses, haversineYds, getCache, setCache, parseOverpass, parseOverpassWays, geoKeyFor, saveManualHole };
```

- [ ] **Step 4: Verify with Node**

Run:
```bash
node -e "
global.window = {};
const fs = require('fs');
eval(fs.readFileSync('pages/tc-course.js', 'utf8'));
const T = window.TcCourse;
console.log('geoKeyFor:', T.geoKeyFor(34.05123, -118.5099)); // expect 34.051_-118.510

T.saveManualHole('test_key', 7, { teeColor: 'white', teeLL: { lat: 1, lng: 2 } });
let cached = T.getCache('test_key');
console.log('after tee mark, hole 7:', JSON.stringify(cached.holes.find(h => h.number === 7)));
// expect: {\"number\":7,\"par\":null,\"handicap\":null,\"tees\":{\"white\":{\"lat\":1,\"lng\":2}},\"green\":null}

T.saveManualHole('test_key', 7, { green: { front: {lat:1,lng:2}, center: {lat:1,lng:3}, back: {lat:1,lng:4} } });
cached = T.getCache('test_key');
console.log('after green mark, hole 7 green:', JSON.stringify(cached.holes.find(h => h.number === 7).green));
console.log('white tee preserved:', JSON.stringify(cached.holes.find(h => h.number === 7).tees));

localStorage.removeItem('tc_course_test_key');
"
```
Expected output (three console lines): the geoKey string `34.051_-118.510`, the hole-7 object with only the `white` tee color filled in and `green:null`, then the green object with front/center/back, and the tees object still showing only `white` (proving the green step didn't disturb the tee, and vice versa).

Note: this repo has no `localStorage` in plain Node, so this step actually requires a `localStorage` shim. Use this fuller harness instead if the above errors with `localStorage is not defined`:
```bash
node -e "
global.window = {};
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const fs = require('fs');
eval(fs.readFileSync('pages/tc-course.js', 'utf8'));
const T = window.TcCourse;
console.log('geoKeyFor:', T.geoKeyFor(34.05123, -118.5099));
T.saveManualHole('test_key', 7, { teeColor: 'white', teeLL: { lat: 1, lng: 2 } });
console.log(JSON.stringify(T.getCache('test_key').holes.find(h => h.number === 7)));
T.saveManualHole('test_key', 7, { green: { front: {lat:1,lng:2}, center: {lat:1,lng:3}, back: {lat:1,lng:4} } });
console.log(JSON.stringify(T.getCache('test_key').holes.find(h => h.number === 7)));
"
```

- [ ] **Step 5: Commit**

```bash
git add pages/tc-course.js
git commit -m "feat: tc-course.js — geoKeyFor() and saveManualHole() for manual tee/green marks"
```

---

### Task 2: rounds.html — persist `geoKey` into round state

**Files:**
- Modify: `pages/rounds.html`

**Interfaces:**
- Consumes: `TcCourse.geoKeyFor(lat, lng)` from Task 1.
- Produces: `sessionStorage.tc_active_round.geoKey` — a string, present whenever `sel.course.lat`/`sel.course.lng` are set, even if `TcCourse.loadNear` found no OSM data at all for the course.

- [ ] **Step 1: Compute and store `geoKey` unconditionally on course coords, not only when `loadNear` succeeds**

Find in `pages/rounds.html`:
```js
  if (sel.course?.lat && sel.course?.lng) {
    try {
      const data = await TcCourse.loadNear(sel.course.lat, sel.course.lng);
      if (data) roundData.holes_data = data.holes ?? null;
    } catch {}
  }
```

Replace with:
```js
  if (sel.course?.lat && sel.course?.lng) {
    roundData.geoKey = TcCourse.geoKeyFor(sel.course.lat, sel.course.lng);
    try {
      const data = await TcCourse.loadNear(sel.course.lat, sel.course.lng);
      if (data) roundData.holes_data = data.holes ?? null;
    } catch {}
  }
```

(`geoKey` is computed from the course's coordinates directly rather than only from `data.geoKey`, so a course with zero OSM coverage at all — `data` is `null` — still gets a `geoKey` to save manual marks against.)

- [ ] **Step 2: Verify syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('pages/rounds.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```
Expected: `block 0 OK`.

- [ ] **Step 3: Commit**

```bash
git add pages/rounds.html
git commit -m "feat: rounds.html — persist course geoKey into round state"
```

---

### Task 3: hole.html — Mark-This-Hole panel markup

**Files:**
- Modify: `pages/hole.html`

**Interfaces:**
- Produces: a hidden-by-default `#mark-hole-panel` element with child elements `#mh-step-title`, `#mh-step-sub`, `#mh-confirm-btn` (onclick `mhConfirmStep()`, defined in Task 4) and a "Skip" element (onclick `mhSkip()`, defined in Task 4). All existing shot-tracking UI elements gain a shared `normal-tracking-ui` class so Task 4's JS can show/hide them as one group.

This task only adds markup/classes — the page will not visually change yet (Task 4 wires up the JS that actually shows the panel and defines `mhConfirmStep`/`mhSkip`; without that JS, `#mark-hole-panel` stays hidden and nothing references the new class).

- [ ] **Step 1: Tag the undo bar**

Find:
```html
  <!-- Undo bar -->
  <div class="undo-bar">
```

Replace with:
```html
  <!-- Undo bar -->
  <div class="undo-bar normal-tracking-ui">
```

- [ ] **Step 2: Tag the shot-tracking chrome inside `.map`**

Find:
```html
    <div class="map-view-toggle">
      <div class="mvt-btn active" id="h-view-hole" onclick="hSetView('hole')">⛳ Hole</div>
      <div class="mvt-btn" id="h-view-green" onclick="hSetView('green')">🟢 Green</div>
    </div>
    <div class="dpill" id="h-dpill">📍 Mark your tee shot</div>
    <div class="mbtns">
      <div class="mbtn mbtn-g" id="h-markbtn" onclick="hMark()">📍 Mark Shot</div>
    </div>
    <div class="mchips">
```

Replace with:
```html
    <div class="map-view-toggle normal-tracking-ui">
      <div class="mvt-btn active" id="h-view-hole" onclick="hSetView('hole')">⛳ Hole</div>
      <div class="mvt-btn" id="h-view-green" onclick="hSetView('green')">🟢 Green</div>
    </div>
    <div class="dpill normal-tracking-ui" id="h-dpill">📍 Mark your tee shot</div>
    <div class="mbtns normal-tracking-ui">
      <div class="mbtn mbtn-g" id="h-markbtn" onclick="hMark()">📍 Mark Shot</div>
    </div>
    <div class="mchips normal-tracking-ui">
```

Find:
```html
    <div class="wind-ov" id="h-wind-ov" style="display:none;">
```

Replace with:
```html
    <div class="wind-ov normal-tracking-ui" id="h-wind-ov" style="display:none;">
```

- [ ] **Step 3: Tag the F/C/B strip, GPS bar, shot log, toggles, spacer, and CTA button — and add the new panel right after `.map`**

Find:
```html
  <!-- F/C/B distance strip -->
  <div class="fcb-strip">
```

Replace with:
```html
  <!-- Mark This Hole panel — shown instead of the shot-tracking UI below
       whenever mhShouldMark() is true (wired up in the next task) -->
  <div id="mark-hole-panel" style="display:none;flex-direction:column;flex:1;">
    <div style="padding:14px 16px 4px;">
      <div id="mh-step-title" style="font-size:16px;font-weight:900;">Mark the Tee</div>
      <div id="mh-step-sub" style="font-size:12px;color:var(--muted);margin-top:4px;line-height:1.4;">Drag the pin to where you're standing, or tap the map.</div>
    </div>
    <div class="spacer"></div>
    <div style="padding:0 16px 16px;display:flex;flex-direction:column;gap:10px;">
      <button class="cta cta-gold" id="mh-confirm-btn" onclick="mhConfirmStep()">Confirm Tee</button>
      <div style="text-align:center;font-size:12px;color:var(--dim);cursor:pointer;" onclick="mhSkip()">Skip — just track shots</div>
    </div>
  </div>

  <!-- F/C/B distance strip -->
  <div class="fcb-strip normal-tracking-ui">
```

Find:
```html
  <!-- GPS bar -->
  <div class="gps-bar" id="h-gpsbar">
```

Replace with:
```html
  <!-- GPS bar -->
  <div class="gps-bar normal-tracking-ui" id="h-gpsbar">
```

Find:
```html
  <!-- Shot log -->
  <div class="shot-log" id="h-shot-log">
```

Replace with:
```html
  <!-- Shot log -->
  <div class="shot-log normal-tracking-ui" id="h-shot-log">
```

Find:
```html
  <!-- Toggles — FIR row only rendered for par 4/5 (par 3 has no fairway stage) -->
  <div class="tsec">
```

Replace with:
```html
  <!-- Toggles — FIR row only rendered for par 4/5 (par 3 has no fairway stage) -->
  <div class="tsec normal-tracking-ui">
```

Find:
```html
  <div class="spacer"></div>
  <button class="cta cta-gold" onclick="showSheet()">🚩 Hole Out → Summary</button>
</div><!-- /page -->
```

Replace with:
```html
  <div class="spacer normal-tracking-ui"></div>
  <button class="cta cta-gold normal-tracking-ui" onclick="showSheet()">🚩 Hole Out → Summary</button>
</div><!-- /page -->
```

- [ ] **Step 4: Verify syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('pages/hole.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```
Expected: `block 0 OK` (the new markup contains no `<script>` changes yet, so this should behave identically to before this task).

- [ ] **Step 5: Commit**

```bash
git add pages/hole.html
git commit -m "feat: hole.html — add Mark This Hole panel markup and normal-tracking-ui tagging"
```

---

### Task 4: hole.html — marking state machine, draggable pin, save & reload

**Files:**
- Modify: `pages/hole.html`

**Interfaces:**
- Consumes: `TcCourse.saveManualHole(geoKey, holeNumber, patch)` and `TcCourse.geoKeyFor` from Task 1; `_round`, `_holeData`, `_holeNum`, `_tee`, `PAR`, `HDCP`, `DEGRADED`, `HAS_REAL_TEE`, `NO_TEE_DATA`, `TEE_LL`, `lmap` — all already defined earlier in `hole.html`.
- Produces: `mhShouldMark()`, `mhShowPanel()`, `mhHidePanel()`, `mhRenderStep()`, `mhConfirmStep()`, `mhSkip()`, `mhFinish()` — global functions. Triggers automatically on page load via a call at the bottom of the script.

- [ ] **Step 1: Add the state machine, right after `lmap` and its tile layer are created**

Find in `pages/hole.html`:
```js
const lmap = L.map('h-leaflet', {
  center: DEGRADED ? [TEE_LL.lat, TEE_LL.lng] : [(TEE_LL.lat + GREEN_CTR.lat)/2, (TEE_LL.lng + GREEN_CTR.lng)/2],
  zoom: DEGRADED ? (NO_TEE_DATA ? 4 : 16) : 18,
  zoomControl: false, attributionControl: false
});
L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19 }
).addTo(lmap);
```

Insert immediately after it:
```js
/* ── MANUAL TEE/GREEN MARKING ──
   Shown instead of the normal shot-tracking UI whenever this hole is
   missing a real tee (for the tee color being played) or a real green.
   Only asks for whichever piece is actually missing. */
const NEEDS_TEE_MARK   = DEGRADED && !HAS_REAL_TEE;
const NEEDS_GREEN_MARK = DEGRADED && !_holeData?.green;

const markSteps = [];
if (NEEDS_TEE_MARK)   markSteps.push('tee');
if (NEEDS_GREEN_MARK) markSteps.push('green-front', 'green-center', 'green-back');

let markIdx = 0;
const markResults = {};
let markMarker = null;

const MARK_STEP_INFO = {
  'tee':          { title: 'Mark the Tee',           sub: "Drag the pin to where you're standing, or tap the map.", btn: 'Confirm Tee' },
  'green-front':  { title: 'Mark the Green — Front', sub: 'Drag the pin to the front edge of the green.',           btn: 'Confirm Front' },
  'green-center': { title: 'Mark the Green — Center',sub: 'Drag the pin to the middle of the green.',               btn: 'Confirm Center' },
  'green-back':   { title: 'Mark the Green — Back',  sub: 'Drag the pin to the back edge of the green.',            btn: 'Confirm Back' }
};

function mhShouldMark() { return markSteps.length > 0; }

function mhDefaultPositionFor(step) {
  if (step === 'tee') return TEE_LL;
  // Green steps default to a small offset behind the tee (or the previously
  // placed green point), matching the same fallback spacing used elsewhere
  // in this file for synthetic green positions — just a starting point the
  // golfer drags into the real spot.
  const base = markResults['green-center'] || markResults['tee'] || TEE_LL;
  if (step === 'green-front')  return { lat: base.lat + 0.00135, lng: base.lng };
  if (step === 'green-center') return { lat: base.lat + 0.00150, lng: base.lng };
  return { lat: base.lat + 0.00165, lng: base.lng }; // green-back
}

function mhPlacePin(ll) {
  if (markMarker) lmap.removeLayer(markMarker);
  markMarker = L.marker([ll.lat, ll.lng], {
    icon: L.divIcon({
      html: '<div style="background:rgba(241,196,15,0.25);border:2px solid #F1C40F;width:26px;height:26px;border-radius:50%;"></div>',
      iconSize: [26, 26], iconAnchor: [13, 13], className: ''
    }),
    draggable: true
  }).addTo(lmap);
  lmap.setView([ll.lat, ll.lng], 18);
}

function mhPlacePinForStep(step) {
  const fallback = mhDefaultPositionFor(step);
  mhPlacePin(fallback);
  // Tee step: if we truly have no tee data anywhere (not even a course
  // center), prefer the device's live position over the NO_DATA_LL
  // placeholder as soon as it resolves — same geolocation options already
  // used elsewhere in this file for consistency.
  if (step === 'tee' && NO_TEE_DATA && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      mhPlacePin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    }, null, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }
}

function mhRenderStep() {
  const step = markSteps[markIdx];
  const info = MARK_STEP_INFO[step];
  const isLast = markIdx === markSteps.length - 1;
  document.getElementById('mh-step-title').textContent = info.title;
  document.getElementById('mh-step-sub').textContent = info.sub;
  document.getElementById('mh-confirm-btn').textContent = isLast ? 'Confirm & Play Hole' : info.btn;
  hSetView('hole');
  mhPlacePinForStep(step);
}

function mhShowPanel() {
  document.querySelectorAll('.normal-tracking-ui').forEach(el => { el.style.display = 'none'; });
  document.getElementById('mark-hole-panel').style.display = 'flex';
  markIdx = 0;
  mhRenderStep();
}

function mhHidePanel() {
  if (markMarker) { lmap.removeLayer(markMarker); markMarker = null; }
  document.getElementById('mark-hole-panel').style.display = 'none';
  document.querySelectorAll('.normal-tracking-ui').forEach(el => { el.style.display = ''; });
}

function mhConfirmStep() {
  const step = markSteps[markIdx];
  markResults[step] = markMarker.getLatLng();
  markIdx++;
  if (markIdx >= markSteps.length) { mhFinish(); return; }
  mhRenderStep();
}

function mhSkip() {
  mhHidePanel();
}

function mhFinish() {
  const patch = {};
  if (markResults['tee']) {
    patch.teeColor = _tee;
    patch.teeLL = { lat: markResults['tee'].lat, lng: markResults['tee'].lng };
  }
  if (markResults['green-center']) {
    patch.green = {
      front:  { lat: markResults['green-front'].lat,  lng: markResults['green-front'].lng },
      center: { lat: markResults['green-center'].lat, lng: markResults['green-center'].lng },
      back:   { lat: markResults['green-back'].lat,   lng: markResults['green-back'].lng }
    };
  }

  if (_round?.geoKey) {
    TcCourse.saveManualHole(_round.geoKey, _holeNum, patch);
  }

  // Reflect the mark in the current round immediately too, so the reload
  // below sees it without needing a fresh TcCourse.loadNear() round-trip.
  if (_round) {
    const holesData = _round.holes_data ? [..._round.holes_data] : [];
    let entry = holesData.find(h => h.number === _holeNum);
    if (!entry) {
      entry = { number: _holeNum, par: PAR, handicap: HDCP, tees: {}, green: null };
      holesData.push(entry);
      holesData.sort((a, b) => a.number - b.number);
    }
    if (patch.teeColor) entry.tees = { ...entry.tees, [patch.teeColor]: patch.teeLL };
    if (patch.green) entry.green = patch.green;
    _round.holes_data = holesData;
    sessionStorage.setItem('tc_active_round', JSON.stringify(_round));
  }

  location.reload();
}

if (mhShouldMark()) mhShowPanel();
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('pages/hole.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```
Expected: `block 0 OK`.

- [ ] **Step 3: Manual browser verification — full degraded hole (both tee and green missing)**

Serve `pages/` locally (e.g. `python -m http.server 8931` from inside `pages/`) and open `http://127.0.0.1:8931/hole.html`. In the browser console:

```js
sessionStorage.setItem('tc_active_round', JSON.stringify({
  course: { name: 'Test Course', lat: 34.05, lng: -118.5 },
  tee: 'white', holes: 18,
  holes_data: [], // hole 1 not present at all — fully degraded
  holeSequence: [1], currentHoleIdx: 0,
  geoKey: TcCourse.geoKeyFor(34.05, -118.5)
}));
location.reload();
```

Expected:
- The "Mark This Hole" panel appears immediately (not the normal tracking screen).
- Title reads "Mark the Tee"; a yellow pin is visible on the satellite map.
- Tapping "Confirm Tee" advances to "Mark the Green — Front", then Center, then Back; the last step's button reads "Confirm & Play Hole".
- After the last confirm, the page reloads and now shows the **normal** shot-tracking screen (no banner, real F/C/B numbers, no "Mark This Hole" panel).

- [ ] **Step 4: Manual browser verification — persistence across a fresh round**

Still in the console:
```js
JSON.parse(localStorage.getItem('tc_course_' + TcCourse.geoKeyFor(34.05, -118.5))).data.holes
```
Expected: an array containing a hole numbered `1` with a real `tees.white` and a real `green.center/front/back` — the marks just placed.

Then simulate a brand-new round at the same course/hole/tee:
```js
sessionStorage.setItem('tc_active_round', JSON.stringify({
  course: { name: 'Test Course', lat: 34.05, lng: -118.5 },
  tee: 'white', holes: 18,
  holes_data: JSON.parse(localStorage.getItem('tc_course_' + TcCourse.geoKeyFor(34.05, -118.5))).data.holes,
  holeSequence: [1], currentHoleIdx: 0,
  geoKey: TcCourse.geoKeyFor(34.05, -118.5)
}));
location.reload();
```
Expected: normal tracking screen loads directly — the "Mark This Hole" panel does not reappear.

- [ ] **Step 5: Manual browser verification — partial data (tee already real, green missing) only asks for the green**

```js
const geoKey = TcCourse.geoKeyFor(34.05, -118.5);
sessionStorage.setItem('tc_active_round', JSON.stringify({
  course: { name: 'Test Course', lat: 34.05, lng: -118.5 },
  tee: 'white', holes: 18,
  holes_data: [{ number: 1, par: 4, handicap: 1, tees: { white: { lat: 34.05, lng: -118.5 } }, green: null }],
  holeSequence: [1], currentHoleIdx: 0,
  geoKey
}));
location.reload();
```
Expected: the panel opens directly on "Mark the Green — Front" — the tee step is skipped since `tees.white` already exists.

- [ ] **Step 6: Manual browser verification — Skip discards everything**

Repeat Step 3's fully-degraded seed, reload, tap "Confirm Tee" once (to prove skip discards progress even mid-flow), then tap "Skip — just track shots".

Expected: the normal degraded tracking screen appears (banner, no distances) — `localStorage` for this `geoKey` is unchanged (still absent or unaffected), confirmed via:
```js
localStorage.getItem('tc_course_' + TcCourse.geoKeyFor(34.05, -118.5))
```
Expected: `null` (nothing was saved).

- [ ] **Step 7: Commit**

```bash
git add pages/hole.html
git commit -m "feat: hole.html — manual tee/green marking flow for degraded holes"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Trigger only on degraded holes, only for the missing piece(s) | Task 4 — `NEEDS_TEE_MARK`/`NEEDS_GREEN_MARK`/`markSteps` |
| Tee defaults to device GPS, draggable | Task 4 — `mhPlacePinForStep('tee')` |
| Green marked as 3 separate points (front/center/back) | Task 4 — `markSteps` includes all three when needed |
| Skip discards all progress, no partial save | Task 4 — `mhSkip()` calls `mhHidePanel()` only; `mhFinish()` (the only saving path) is never reached |
| Save persists per-course via existing OSM cache shape | Task 1 — `saveManualHole`; Task 4 — `mhFinish()` |
| Tee mark scoped to the played tee color only | Task 4 — `patch.teeColor = _tee` |
| Green mark applies to all tee colors | Task 4 — `entry.green = patch.green` (not keyed by color) |
| No course coords at all → session-only, no persistence | Task 4 — `if (_round?.geoKey)` guards the `saveManualHole` call; the in-session `_round.holes_data` patch still happens either way |
| Confirm & Play Hole reuses existing tracking screen unmodified | Task 4 — `mhFinish()` ends with `location.reload()`, no new tracking code path |
