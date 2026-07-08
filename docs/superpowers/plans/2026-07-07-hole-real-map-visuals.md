# Hole View Real Map Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `hole.html`'s two hand-drawn illustrated SVG visuals (the fake Green View and the fake Hole Summary map) with the real Leaflet satellite map, using data that already exists (real per-hole green geometry, real per-shot GPS coordinates).

**Architecture:** Green View stops being a second, separate SVG-based rendering/interaction system and becomes the same Leaflet map (`lmap`) re-centered/re-zoomed on the real mapped green, reusing the exact drag-a-marker flow Hole View already has. Hole Summary gets its own small, non-interactive Leaflet map, auto-framed to the hole, with shots revealed on a staggered timer instead of drawn all at once.

**Tech Stack:** Plain HTML/CSS/JS, Leaflet 1.9.4 (already loaded on this page), no build step, no test framework — verification is a manual browser walkthrough (established pattern for this codebase).

## Global Constraints

- No automated test suite exists in this codebase — every verification step in this plan is a manual browser walkthrough, run via a local static file server.
- No changes to element ordering elsewhere on the page (hole nav, score bar, undo bar, FCB strip, GPS bar, shot log, toggles, Hole Out button) — out of scope, confirmed during brainstorming.
- No new Supabase columns, migrations, or capture steps — every input needed (green front/center/back, per-shot lat/lng) already exists.
- The hole-out target stays fixed at the already-mapped green center (`GREEN_CTR`) — no daily/round-specific pin placement.
- DEGRADED-mode behavior (holes missing a real green) must be unchanged — Green View's toggle button stays disabled exactly as it is today.
- Shot reveal animation on the Hole Summary is a staggered sequential reveal (line + marker per shot, timed apart) — not a curved flight-arc animation.

---

### Task 1: Green View becomes the real map

**Files:**
- Modify: `pages/hole.html` (markup ~lines 143-211, and the script section covering `greenSVGToLatLng`, `hGreenDragCfg`/`hGreenDrag`/`makePannable`/`addTapToPlace`/cup-ring listener setup, `hSetView`, `hMark`, `hCancelGPS`, `hConfirmGPS`, `updateGreenDragReference`, `hHoleOut`, `hHoleOutFromMap`, the flag/tee marker setup, and the `lmap.on('click', ...)` handler)
- Modify: `pages/tc-utils.js` (remove `px2`, `addShotMarker`, `addShotLine`, `makeDraggable`, `makePannable`, `addTapToPlace` — confirmed unused anywhere except the code this task deletes)

**Interfaces:**
- Consumes: `lmap` (the existing Leaflet map instance), `TEE_LL`, `GREEN_CTR`, `GREEN_FRT`, `GREEN_BCK`, `_holeData`, `DEGRADED`, `hLoggedShots`, `hShotCount`, `haversineYds`, `makeShotIcon(num, holed)`, `placePendingAt(ll)`, `removePendingMarker()`, `hPendingLatLng`, `updateDistanceBar(ll)`, `inferLie(shotIndex, fromLL)` — all already defined earlier in `hole.html`, unchanged by this task.
- Produces: shot objects pushed onto `hLoggedShots` still carry `{ leafletMarker, leafletLine, latlng, x, y, svgId: 'h-leaflet' }` (the `x`/`y`/`svgId` fields are kept in this task purely so the *not-yet-rewritten* `buildSummaryMap()` in Task 2 keeps working unchanged until Task 2 replaces it — Task 2 removes these fields once it no longer needs them). `hViewMode` (`'hole'` | `'green'`) is unchanged as a concept, but no longer toggles between two DOM elements — it now only re-frames `lmap`.

- [ ] **Step 1: Remove the illustrated Green View SVG markup**

In `pages/hole.html`, find this block (inside `<div class="map" ...>`, right after the `#h-leaflet` div):

```html
    <!-- Green close-up SVG (overlays Leaflet when in green mode) -->
    <svg viewBox="0 0 320 242" id="h-green-svg" xmlns="http://www.w3.org/2000/svg"
         style="display:none;touch-action:none;position:absolute;top:0;left:0;width:100%;height:100%;z-index:2;">
      <rect width="320" height="242" fill="#060D06"/>
      <ellipse cx="160" cy="121" rx="148" ry="118" fill="#12361A"/>
      <ellipse cx="160" cy="121" rx="137" ry="109" fill="#1A5820"/>
      <ellipse cx="160" cy="121" rx="127" ry="101" fill="#1D6523" opacity="0.8"/>
      <ellipse cx="160" cy="100" rx="112" ry="106" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1" stroke-dasharray="3,3"/>
      <ellipse cx="160" cy="100" rx="74" ry="70" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="3,3"/>
      <ellipse cx="160" cy="100" rx="37" ry="35" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="3,3"/>
      <text x="235" y="103" font-size="8" fill="rgba(255,255,255,0.2)" font-weight="600">20 ft</text>
      <text x="197" y="103" font-size="8" fill="rgba(255,255,255,0.25)" font-weight="600">10 ft</text>
      <ellipse cx="255" cy="95" rx="20" ry="12" fill="#2A2510" opacity="0.7"/>
      <text x="255" y="99" text-anchor="middle" font-size="7" fill="rgba(200,180,80,0.4)">bunker</text>
      <circle cx="160" cy="100" r="5.5" fill="#0A0A0F" stroke="rgba(255,255,255,0.35)" stroke-width="1.2"/>
      <line x1="160" y1="100" x2="160" y2="63" stroke="rgba(255,255,255,0.88)" stroke-width="1.5"/>
      <polygon points="160,63 175,71 160,79" fill="#E74C3C"/>
      <!-- Tappable hole-out zone (rendered above pin so it catches taps) -->
      <circle id="h-cup-ring" cx="160" cy="100" r="22" fill="rgba(46,204,113,0.05)" stroke="rgba(46,204,113,0.25)" stroke-width="1.5" stroke-dasharray="4,3" style="cursor:pointer;"/>
      <text x="160" y="131" text-anchor="middle" font-size="8" fill="rgba(46,204,113,0.45)" font-weight="700" pointer-events="none">⛳ hole out</text>
      <!-- Green pending marker -->
      <g id="h-gpen" style="opacity:0;pointer-events:none;" class="draggable-marker">
        <circle cx="160" cy="145" r="18" fill="rgba(241,196,15,0.08)"/>
        <circle cx="160" cy="145" r="11" fill="rgba(241,196,15,0.25)" stroke="rgba(241,196,15,0.9)" stroke-width="2"/>
        <text id="h-gpen-num" x="160" y="149" text-anchor="middle" font-size="10" fill="white" font-weight="800">1</text>
        <text id="h-gylbl" x="174" y="146" font-size="10" fill="rgba(241,196,15,1)" font-weight="800"
              paint-order="stroke" stroke="rgba(10,10,15,0.95)" stroke-width="3.5" stroke-linejoin="round">18 ft</text>
      </g>
    </svg>
```

Delete this entire block. Nothing replaces it — Green View now reuses `#h-leaflet` (the div directly above it), just re-framed.

- [ ] **Step 2: Add real-world-scaled distance rings around the green**

Find the flag marker setup (right after the static tee marker):

```js
// Flag marker — tap to hole out. Skipped entirely when DEGRADED: GREEN_CTR
// is a fabricated offset in that case, and showing a flag there would look
// like a real (but wrong) green location rather than "we don't know".
const hFlagMarker = DEGRADED ? null : L.marker([GREEN_CTR.lat, GREEN_CTR.lng], {
  icon: L.divIcon({
    html: '<div style="display:flex;flex-direction:column;align-items:flex-start;cursor:pointer;"><div style="width:2px;height:18px;background:rgba(255,255,255,0.9);"></div><div style="background:#E74C3C;border-radius:4px;padding:2px 7px;font-size:9px;font-weight:800;color:white;white-space:nowrap;cursor:pointer;margin-top:2px;">⛳ Hole Out</div></div>',
    iconSize: [80, 40], iconAnchor: [1, 0], className: ''
  })
}).addTo(lmap);
if (hFlagMarker) hFlagMarker.on('click', hHoleOutFromMap);
```

Add this immediately after it:

```js
// Real-world-scaled distance-reference rings around the green (10ft/20ft),
// replacing the illustrated concentric rings the old fake Green View drew
// by hand — these are true meter-radius circles centered on the actual
// mapped green, so quick distance intuition isn't lost switching to a plain
// satellite photo. Skipped when DEGRADED for the same reason as the flag.
if (!DEGRADED) {
  const FT_TO_M = 0.3048;
  [10, 20].forEach(ft => {
    L.circle([GREEN_CTR.lat, GREEN_CTR.lng], {
      radius: ft * FT_TO_M,
      color: 'rgba(255,255,255,0.35)', weight: 1, dashArray: '3,3',
      fill: false, interactive: false
    }).addTo(lmap);
  });
}
```

- [ ] **Step 3: Allow tap-to-place in both view modes**

Find:

```js
lmap.on('click', e => {
  if (!document.getElementById('h-gpsbar').classList.contains('show')) return;
  if (hViewMode !== 'hole') return;
  placePendingAt(e.latlng);
});
```

Replace with:

```js
lmap.on('click', e => {
  if (!document.getElementById('h-gpsbar').classList.contains('show')) return;
  placePendingAt(e.latlng);
});
```

- [ ] **Step 4: Rewrite `hSetView` to re-frame the map instead of swapping elements**

Find:

```js
/* ── VIEW TOGGLE ── */
let hViewMode = 'hole';
function hSetView(mode) {
  hViewMode = mode;
  document.getElementById('h-view-hole').classList.toggle('active',  mode === 'hole');
  document.getElementById('h-view-green').classList.toggle('active', mode === 'green');
  document.getElementById('h-leaflet').style.display   = mode === 'hole'  ? '' : 'none';
  document.getElementById('h-green-svg').style.display = mode === 'green' ? '' : 'none';
  if (mode === 'hole') lmap.invalidateSize();
  if (mode === 'green') {
    const n = document.getElementById('h-gpen-num');
    if (n) n.textContent = hShotCount + 1;
  }
  hCancelGPS();
}
```

Replace with:

```js
/* ── VIEW TOGGLE ──
   Both modes now show the same Leaflet map — this only re-frames it. */
let hViewMode = 'hole';
function hSetView(mode) {
  hViewMode = mode;
  document.getElementById('h-view-hole').classList.toggle('active',  mode === 'hole');
  document.getElementById('h-view-green').classList.toggle('active', mode === 'green');
  lmap.invalidateSize();
  if (mode === 'green' && _holeData?.green) {
    lmap.fitBounds(
      L.latLngBounds([[GREEN_FRT.lat, GREEN_FRT.lng], [GREEN_BCK.lat, GREEN_BCK.lng]]),
      { padding: [40, 40], maxZoom: 21 }
    );
  } else if (mode === 'hole') {
    lmap.fitBounds(
      L.latLngBounds([[TEE_LL.lat, TEE_LL.lng], [GREEN_CTR.lat, GREEN_CTR.lng]]),
      { padding: [30, 30] }
    );
  }
  hCancelGPS();
}
```

- [ ] **Step 5: Simplify `hMark` to always use the Leaflet pending-marker flow**

Find:

```js
function hMark() {
  if (hViewMode === 'green') updateGreenDragReference();
  const btn = document.getElementById('h-markbtn');
  btn.textContent = '📍 GPS Dropped…';
  btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none';
  document.getElementById('h-gpsbar').classList.add('show');
  if (hViewMode === 'green') {
    const p = document.getElementById('h-gpen');
    p.style.opacity = '1'; p.style.pointerEvents = 'all';
    p.setAttribute('transform', '');
    hGreenDrag.showInitial();
  } else {
    placePendingAt(lmap.getCenter());
  }
}
```

Replace with:

```js
function hMark() {
  const btn = document.getElementById('h-markbtn');
  btn.textContent = '📍 GPS Dropped…';
  btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none';
  document.getElementById('h-gpsbar').classList.add('show');
  placePendingAt(lmap.getCenter());
}
```

- [ ] **Step 6: Simplify `hCancelGPS` (remove `#h-gpen`/`hGreenDrag` references)**

Find:

```js
function hCancelGPS() {
  removePendingMarker();
  document.getElementById('h-gpen').style.opacity = '0';
  document.getElementById('h-gpen').style.pointerEvents = 'none';
  document.getElementById('h-gpsbar').classList.remove('show');
  hGreenDrag.reset();
  const btn = document.getElementById('h-markbtn');
  btn.textContent = '📍 Mark Shot';
  btn.style.opacity = ''; btn.style.pointerEvents = '';
}
```

Replace with:

```js
function hCancelGPS() {
  removePendingMarker();
  document.getElementById('h-gpsbar').classList.remove('show');
  const btn = document.getElementById('h-markbtn');
  btn.textContent = '📍 Mark Shot';
  btn.style.opacity = ''; btn.style.pointerEvents = '';
}
```

- [ ] **Step 7: Update `refreshHolePill` to show feet for short distances (matches `hConfirmGPS`'s existing convention, needed now that putts are placed the same way as any other shot)**

Find:

```js
function refreshHolePill() {
  const prev = hLoggedShots.at(-1);
  const fromLL = prev?.latlng ?? TEE_LL;
  const yds = Math.max(1, Math.round(haversineYds(fromLL, hPendingLatLng)));
  const pill = document.getElementById('h-dpill');
  if (pill) pill.textContent = prev ? `↑ ${yds} yds` : `↑ ${yds} yds from tee · Dr`;
}
```

Replace with:

```js
function refreshHolePill() {
  const prev = hLoggedShots.at(-1);
  const fromLL = prev?.latlng ?? TEE_LL;
  const yds = Math.max(1, Math.round(haversineYds(fromLL, hPendingLatLng)));
  const label = yds >= 10 ? `${yds} yds` : `${Math.round(yds * 3)} ft`;
  const pill = document.getElementById('h-dpill');
  if (pill) pill.textContent = prev ? `↑ ${label}` : `↑ ${label} from tee · Dr`;
}
```

- [ ] **Step 8: Remove the green-SVG drag/pan/tap-to-place setup**

Find:

```js
const hGreenDragCfg = {
  baseX: 160, baseY: 145, pinX: 160, pinY: 235,
  scale: 10 / (37 * 3),
  pillId: 'h-dpill', format: v => `🟢 ${v} yds`,
  originalText: '🟢 On Green — drag to place',
  labelId: 'h-gylbl', labelFormat: v => `${v} yds`
};
const hGreenDrag = makeDraggable('h-gpen', 'h-green-svg', hGreenDragCfg);

makePannable('h-green-svg', 'h-gpsbar');
addTapToPlace('h-green-svg', 'h-gpsbar', () => hGreenDrag);

document.getElementById('h-cup-ring').addEventListener('pointerdown', e => {
  e.stopPropagation(); e.preventDefault(); hHoleOut();
});
```

Delete this entire block (no replacement — `lmap` already supports pan/pinch-zoom natively, and tap-to-place is handled by the `lmap.on('click', ...)` handler from Step 3).

- [ ] **Step 9: Remove `greenSVGToLatLng` and `updateGreenDragReference`**

Find:

```js
// Green SVG (pin at 160,100, scale 10ft per 37px) → GPS.
function greenSVGToLatLng(gx, gy) {
  const ftPerPx = 10 / 37;
  const dEast  = (gx - 160) * ftPerPx;
  const dSouth = (gy - 100) * ftPerPx;
  return {
    lat: GREEN_CTR.lat - dSouth * 0.3048 / 111320,
    lng: GREEN_CTR.lng + dEast  * 0.3048 / (111320 * Math.cos(GREEN_CTR.lat * Math.PI / 180))
  };
}
```

Delete this function entirely.

Find:

```js
function updateGreenDragReference() {
  const prevGreen = [...hLoggedShots].reverse().find(s => s.svgId === 'h-green-svg');
  if (prevGreen) {
    hGreenDragCfg.pinX = prevGreen.x; hGreenDragCfg.pinY = prevGreen.y;
    hGreenDragCfg.scale = 10 / (37 * 3);
    hGreenDragCfg.format = v => `🟢 ${v} yds from last ball`;
    hGreenDragCfg.labelFormat = v => `${v} yds`;
    hGreenDragCfg.originalText = '🟢 Drag to place';
    hGreenDragCfg.onMove = null;
  } else {
    const prevLL = hLoggedShots.at(-1)?.latlng ?? TEE_LL;
    const approxYds = Math.max(1, Math.round(TcCourse.haversineYds(prevLL, GREEN_CTR)));
    hGreenDragCfg.pinX = 160; hGreenDragCfg.pinY = 100;
    hGreenDragCfg.scale = 10 / (37 * 3);
    hGreenDragCfg.format = () => `🟢 ~${approxYds} yds`;
    hGreenDragCfg.labelFormat = () => `~${approxYds}`;
    hGreenDragCfg.originalText = `🟢 ~${approxYds} yds`;
    hGreenDragCfg.onMove = (gx, gy) => {
      const yds = Math.max(1, Math.round(haversineYds(prevLL, greenSVGToLatLng(gx, gy))));
      const pill = document.getElementById('h-dpill');
      if (pill) pill.textContent = `🟢 ${yds} yds`;
      const lbl = document.getElementById('h-gylbl');
      if (lbl) lbl.textContent = `${yds} yds`;
    };
  }
}
```

Delete this function entirely (its only caller was `hMark`'s green branch, already removed in Step 5).

- [ ] **Step 10: Unify `hConfirmGPS` — remove the green/hole branching**

Find:

```js
function hConfirmGPS() {
  hShotCount++;
  if (hShotCount === 1) hStartLiveGPS();
  let ydsLabel = '';
  let inferredLie;

  if (hViewMode === 'green') {
    const pos  = hGreenDrag.getPosition();
    const prev = hLoggedShots.at(-1) ?? null;

    // Green SVG elements (unchanged)
    const line = prev?.svgId === 'h-green-svg'
      ? addShotLine('h-green-svg', prev.x, prev.y, pos.x, pos.y) : null;
    const el = addShotMarker('h-green-svg', pos.x, pos.y, hShotCount);

    // Mirror onto Leaflet map
    const shotLL = greenSVGToLatLng(pos.x, pos.y);
    const fromLL = prev?.latlng ?? TEE_LL;
    const leafletLine = L.polyline([[fromLL.lat, fromLL.lng], [shotLL.lat, shotLL.lng]],
      { color: 'rgba(255,255,255,0.5)', weight: 2, dashArray: '5,4' }).addTo(lmap);
    const leafletMarker = L.marker([shotLL.lat, shotLL.lng],
      { icon: makeShotIcon(hShotCount, false) }).addTo(lmap);

    inferredLie = inferLie(hLoggedShots.length, fromLL);

    hLoggedShots.push({ el, line, leafletMarker, leafletLine, latlng: shotLL,
                         x: pos.x, y: pos.y, svgId: 'h-green-svg' });
    document.getElementById('h-gpen').style.opacity = '0';
    document.getElementById('h-gpen').style.pointerEvents = 'none';
    const gpenNum = document.getElementById('h-gpen-num');
    if (gpenNum) gpenNum.textContent = hShotCount + 1;
    hGreenDrag.reset();

    ['h-fcb-front','h-fcb-center','h-fcb-back'].forEach(id =>
      document.getElementById(id).textContent = '—');

    ydsLabel = prev?.svgId === 'h-green-svg'
      ? `${Math.max(1, Math.round(haversineFt(prev.latlng, shotLL)))} ft`
      : `${Math.max(1, Math.round(haversineYds(fromLL, shotLL)))} yds`;
  } else {
    // Hole view — Leaflet
    const ll     = hPendingLatLng;
    const prev   = hLoggedShots.at(-1) ?? null;
    const fromLL = prev?.latlng ?? TEE_LL;
    const yds    = Math.max(1, Math.round(haversineYds(fromLL, ll)));
    ydsLabel     = yds >= 10 ? `${yds} yds` : `${Math.round(yds * 3)} ft`;

    const leafletLine = L.polyline([[fromLL.lat, fromLL.lng], [ll.lat, ll.lng]],
      { color: 'rgba(255,255,255,0.5)', weight: 2, dashArray: '5,4' }).addTo(lmap);
    const leafletMarker = L.marker([ll.lat, ll.lng],
      { icon: makeShotIcon(hShotCount, false) }).addTo(lmap);

    const svgPos = latLngToSumSVG(ll);
    inferredLie = inferLie(hLoggedShots.length, fromLL);
    hLoggedShots.push({ leafletMarker, leafletLine, latlng: ll,
                         x: svgPos.x, y: svgPos.y, svgId: 'h-leaflet' });
    removePendingMarker();
    updateDistanceBar(ll);
  }

  document.getElementById('h-gpsbar').classList.remove('show');
```

Replace with:

```js
function hConfirmGPS() {
  hShotCount++;
  if (hShotCount === 1) hStartLiveGPS();

  const ll     = hPendingLatLng;
  const prev   = hLoggedShots.at(-1) ?? null;
  const fromLL = prev?.latlng ?? TEE_LL;
  const yds    = Math.max(1, Math.round(haversineYds(fromLL, ll)));
  const ydsLabel = yds >= 10 ? `${yds} yds` : `${Math.round(yds * 3)} ft`;

  const leafletLine = L.polyline([[fromLL.lat, fromLL.lng], [ll.lat, ll.lng]],
    { color: 'rgba(255,255,255,0.5)', weight: 2, dashArray: '5,4' }).addTo(lmap);
  const leafletMarker = L.marker([ll.lat, ll.lng],
    { icon: makeShotIcon(hShotCount, false) }).addTo(lmap);

  const svgPos = latLngToSumSVG(ll);
  const inferredLie = inferLie(hLoggedShots.length, fromLL);
  hLoggedShots.push({ leafletMarker, leafletLine, latlng: ll,
                       x: svgPos.x, y: svgPos.y, svgId: 'h-leaflet' });
  removePendingMarker();
  updateDistanceBar(ll);

  document.getElementById('h-gpsbar').classList.remove('show');
```

(Everything below this point in the function — the shot-number/chip updates, undo-context text, club picker invocation — is unchanged; only the branching above it is removed. `latLngToSumSVG`, `x`/`y`/`svgId` are kept here deliberately — Task 2 removes them once `buildSummaryMap` no longer needs pixel positions.)

- [ ] **Step 11: Remove the fake-green branch of `hHoleOut`, keep only the real-map version**

Find:

```js
/* ── HOLE OUT (tap pin on green) ── */
function hHoleOut() {
  if (document.getElementById('h-gpsbar').classList.contains('show')) return;
  if (hViewMode !== 'green') return;

  hStopLiveGPS();
  hShotCount++;

  const prev = hLoggedShots.at(-1) ?? null;
  const line = prev?.svgId === 'h-green-svg'
    ? addShotLine('h-green-svg', prev.x, prev.y, 160, 100) : null;
  const markerEl = addShotMarker('h-green-svg', 160, 100, hShotCount);

  // Mirror onto Leaflet map
  const fromLL = prev?.latlng ?? TEE_LL;
  const leafletLine = L.polyline([[fromLL.lat, fromLL.lng], [GREEN_CTR.lat, GREEN_CTR.lng]],
    { color: 'rgba(255,255,255,0.5)', weight: 2, dashArray: '5,4' }).addTo(lmap);
  const leafletMarker = L.marker([GREEN_CTR.lat, GREEN_CTR.lng],
    { icon: makeShotIcon(hShotCount, true) }).addTo(lmap);

  hLoggedShots.push({ el: markerEl, line, leafletMarker, leafletLine,
                       latlng: GREEN_CTR, x: 160, y: 100, svgId: 'h-green-svg', holed: true });

  hShotLog.push({ num: hShotCount, club: 'Putter', yds: 'MADE ⛳', holed: true, lie: 'green' });
  renderShotLog();

  const snum = document.getElementById('h-shot-num');
  if (snum) { snum.textContent = '✓'; snum.style.color = 'var(--green)'; }
  const chip = document.getElementById('h-shot-chip');
  if (chip) { chip.textContent = '✓'; chip.style.color = 'var(--green)'; }

  document.getElementById('h-undo-ctx').innerHTML = `<strong>Holed out — Shot ${hShotCount}</strong>`;
  document.getElementById('h-undo-btn').classList.remove('dim');
  document.getElementById('h-dpill').textContent = `⛳ Holed! Shot ${hShotCount}`;

  const ring = document.getElementById('h-cup-ring');
  if (ring) {
    ring.setAttribute('fill', 'rgba(46,204,113,0.18)');
    ring.setAttribute('stroke', 'rgba(46,204,113,0.8)');
  }

  showToast('h-toast', `⛳ Holed out! Shot ${hShotCount}`, 3000);
  setTimeout(showSheet, 900);
}

/* ── HOLE OUT (tap flag on hole map) ── */
function hHoleOutFromMap() {
  if (document.getElementById('h-gpsbar').classList.contains('show')) return;
  if (hViewMode !== 'hole') return;
  if (hLoggedShots.length === 0) return;
  if (hLoggedShots.some(s => s.holed)) return;
```

Replace with:

```js
/* ── HOLE OUT (tap the flag marker — works from either zoom level, since
   the flag marker is the same persistent object on `lmap` in both) ── */
function hHoleOutFromMap() {
  if (document.getElementById('h-gpsbar').classList.contains('show')) return;
  if (hLoggedShots.length === 0) return;
  if (hLoggedShots.some(s => s.holed)) return;
```

(The rest of `hHoleOutFromMap` below this point is unchanged. `hHoleOut()` — the fake-green cup-ring version — is now deleted in full; its only caller was the cup-ring listener removed in Step 8.)

- [ ] **Step 12: Verify no remaining references to the deleted green-SVG system**

Run:

```bash
grep -n "h-green-svg\|h-gpen\|h-cup-ring\|h-gylbl\|hGreenDrag\|greenSVGToLatLng\|updateGreenDragReference" pages/hole.html
```

Expected: no output (empty). If anything prints, find and remove/update it before continuing — likely a spot this plan's line-based search missed due to prior edits shifting content slightly.

- [ ] **Step 13: Remove the now-unused SVG-drag utilities from `tc-utils.js`**

First confirm nothing outside `hole.html` still uses them:

```bash
grep -rn "makeDraggable\|makePannable\|addTapToPlace\|addShotMarker\|addShotLine" pages/ --include=*.html --include=*.js
```

Expected: no matches outside `tc-utils.js`'s own definitions (this task just removed every call site in `hole.html`).

In `pages/tc-utils.js`, find and delete these five function definitions in full (they become fully dead once the calls above are removed):

```js
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
```

Also remove the now-unused `px2` helper (only ever used by `makeDraggable`, just deleted):

```js
/* ── MATH ── */
function px2(x1, y1, x2, y2) { return Math.sqrt((x1-x2)**2 + (y1-y2)**2); }
```

Delete this too.

- [ ] **Step 14: Manual verification — play a hole and check Green View**

Start a local static server from the `pages/` directory and open the app in a browser:

```bash
cd pages && python -m http.server 8420 --bind 127.0.0.1
```

Then, at `http://localhost:8420/login.html`: sign in → start a round at a course with a real mapped green (one you've already played/marked before) → reach a hole → confirm:
1. Tapping "🟢 Green" zooms the *same* satellite map tight on the green (no fake illustration appears).
2. The 10ft/20ft dashed rings are visible around the green center.
3. Tapping "📍 Mark Shot" then dragging the marker and confirming logs a shot at the correct real position; short (<10yd) distances show in feet.
4. Tapping the flag marker holes out correctly, from *both* Hole View and Green View zoom levels.
5. Tapping "⛳ Hole" zooms back out to the tee-to-green framing.
6. Play a hole at a course with **no** real mapped green (or a brand-new/unmapped hole) — confirm the "🟢 Green" toggle is still visually disabled, exactly as before this change.

- [ ] **Step 15: Commit**

```bash
git add pages/hole.html pages/tc-utils.js
git commit -m "feat: Green View shows the real satellite map instead of an illustrated SVG"
```

---

### Task 2: Hole Summary becomes a real, animated map

**Files:**
- Modify: `pages/hole.html` (CSS `.sum-map-wrap` rule; the `#sum-svg` markup block; `buildSummaryMap()`; `latLngToSumSVG`/`greenToHoleSVG` removal; the `x`/`y`/`svgId` fields in `hConfirmGPS`/`hHoleOutFromMap`; the `svgId` checks in `undoLastHole`, `autoDetectGIR`, `confirmClub`)

**Interfaces:**
- Consumes: `hLoggedShots` (now storing only `{ leafletMarker, leafletLine, latlng, holed? }` per shot — `x`/`y`/`svgId` removed by this task), `TEE_LL`, `GREEN_CTR`, `DEGRADED`, `makeShotIcon(num, holed)`, `hShotCount`, `hShotLog`, `PAR`.
- Produces: `buildSummaryMap()` keeps the same external contract (`showSheet()` still just calls it with no arguments) but now builds a small non-interactive Leaflet map (`#sum-leaflet`) instead of drawing into `#sum-svg`.

- [ ] **Step 1: Replace the CSS rule for the summary map container**

Find:

```css
.sum-map-wrap { padding:6px 10px 4px; }
.sum-map-wrap svg { width:100%; height:130px; border-radius:10px; display:block; }
```

Replace with:

```css
.sum-map-wrap { padding:6px 10px 4px; }
.sum-map-wrap #sum-leaflet { width:100%; height:130px; border-radius:10px; overflow:hidden; }
/* Marker fade/scale-in for the staggered shot reveal on the summary map. */
#sum-leaflet .leaflet-marker-icon { transition: opacity 0.3s ease, transform 0.3s ease; }
```

- [ ] **Step 2: Replace the illustrated summary SVG markup with a Leaflet container**

Find (the full `.sum-map-wrap` block, including its large hand-drawn `<svg id="sum-svg">`):

```html
    <!-- Mini hole map with all shots rendered dynamically -->
    <div class="sum-map-wrap">
      <svg viewBox="0 0 320 242" id="sum-svg" xmlns="http://www.w3.org/2000/svg">
        <!-- Bird's-eye overhead terrain -->
        <rect width="320" height="242" fill="#0C1A0C"/>
        <ellipse cx="55"  cy="225" rx="42" ry="22" fill="#0A1609"/>
        <ellipse cx="66"  cy="190" rx="36" ry="21" fill="#0B1B0A"/>
        <ellipse cx="50"  cy="155" rx="40" ry="23" fill="#0A1609"/>
        <ellipse cx="70"  cy="118" rx="32" ry="20" fill="#0B1A0A"/>
        <ellipse cx="52"  cy="83"  rx="38" ry="21" fill="#0A1609"/>
        <ellipse cx="72"  cy="50"  rx="30" ry="17" fill="#0B1B0A"/>
        <ellipse cx="90"  cy="22"  rx="22" ry="13" fill="#0A1609"/>
        <ellipse cx="254" cy="218" rx="40" ry="21" fill="#0A1609"/>
        <ellipse cx="244" cy="183" rx="33" ry="20" fill="#0B1B0A"/>
        <ellipse cx="256" cy="148" rx="38" ry="21" fill="#0A1609"/>
        <ellipse cx="242" cy="112" rx="30" ry="18" fill="#0B1A0A"/>
        <ellipse cx="252" cy="78"  rx="34" ry="19" fill="#0A1609"/>
        <ellipse cx="238" cy="44"  rx="26" ry="15" fill="#0B1B0A"/>
        <path d="M108 235 C106 195 102 155 105 112 C108 69 124 40 131 24 L169 24 C176 40 190 69 191 112 C192 155 188 195 186 235 Z" fill="#183818"/>
        <path d="M127 235 C126 195 124 155 126 112 C128 69 134 42 131 24 L169 24 C166 42 172 69 170 112 C170 155 168 195 167 235 Z" fill="#286428"/>
        <path d="M136 235 C135 198 133 162 134 122 C135 80 139 50 150 28 L150 28 C161 50 163 80 162 122 C161 162 159 198 158 235 Z" fill="#2E7030" opacity="0.45"/>
        <ellipse cx="97" cy="65" rx="20" ry="12" fill="#0A1E3A"/>
        <ellipse cx="97" cy="65" rx="16" ry="9" fill="#0D2545" opacity="0.8"/>
        <text x="97" y="69" text-anchor="middle" font-size="8" fill="rgba(52,152,219,0.55)">💧</text>
        <ellipse cx="193" cy="123" rx="17" ry="11" fill="#7A6428"/>
        <ellipse cx="150" cy="24" rx="19" ry="13" fill="#1A7A1A"/>
        <ellipse cx="150" cy="24" rx="15" ry="9" fill="#22A022" opacity="0.9"/>
        <line x1="150" y1="24" x2="150" y2="7" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/>
        <polygon points="150,7 162,13 150,19" fill="#E74C3C"/>
        <rect x="146" y="230" width="18" height="9" rx="4" fill="#2A3A1A"/>
        <circle cx="155" cy="234" r="7" fill="rgba(10,10,15,0.85)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
        <text x="155" y="238" text-anchor="middle" font-size="8" fill="rgba(255,255,255,0.55)" font-weight="700">T</text>
        <!-- dynamic shot lines + markers injected here by buildSummaryMap() -->
      </svg>
    </div>
```

Replace with:

```html
    <!-- Mini hole map — real satellite view, shots revealed by buildSummaryMap() -->
    <div class="sum-map-wrap">
      <div id="sum-leaflet"></div>
    </div>
```

- [ ] **Step 3: Rewrite `buildSummaryMap()` to build a real, auto-framed, animated Leaflet map**

Find:

```js
function buildSummaryMap() {
  const svg = document.getElementById('sum-svg');
  svg.querySelectorAll('[data-sum]').forEach(el => el.remove());
  const ns = 'http://www.w3.org/2000/svg';

  function mk(tag, attrs) {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.setAttribute('data-sum', '1');
    return el;
  }

  const positions = hLoggedShots.map(s => {
    if (s.svgId === 'h-green-svg') {
      const h = greenToHoleSVG(s.x, s.y);
      return { x: h.x, y: h.y, holed: s.holed };
    }
    return { x: s.x, y: s.y, holed: s.holed };
  });

  // Lines: tee → shot 1, then shot-to-shot
  if (positions.length > 0) {
    svg.appendChild(mk('line', { x1:155, y1:234, x2:positions[0].x, y2:positions[0].y,
      stroke:'rgba(255,255,255,0.45)', 'stroke-width':'1.5', 'stroke-dasharray':'4,3' }));
  }
  for (let i = 1; i < positions.length; i++) {
    svg.appendChild(mk('line', { x1:positions[i-1].x, y1:positions[i-1].y,
      x2:positions[i].x, y2:positions[i].y,
      stroke:'rgba(255,255,255,0.45)', 'stroke-width':'1.5', 'stroke-dasharray':'4,3' }));
  }

  // Markers
  positions.forEach((p, i) => {
    const gold = p.holed;
    svg.appendChild(mk('circle', { cx:p.x, cy:p.y, r:'8',
      fill: gold ? 'rgba(241,196,15,0.25)' : 'rgba(46,204,113,0.2)',
      stroke: gold ? 'rgba(241,196,15,0.9)' : 'rgba(46,204,113,0.7)',
      'stroke-width':'1.5' }));
    const t = mk('text', { x:p.x, y:p.y + 3.5, 'text-anchor':'middle',
      'font-size':'8', fill:'white', 'font-weight':'800' });
    t.textContent = gold ? '⛳' : (i + 1);
    svg.appendChild(t);
  });

  // Shot chips strip
```

Replace with:

```js
let sumMap = null;

function buildSummaryMap() {
  const container = document.getElementById('sum-leaflet');
  if (sumMap) { sumMap.remove(); sumMap = null; }

  const thisMap = L.map(container, {
    zoomControl: false, attributionControl: false,
    dragging: false, touchZoom: false, scrollWheelZoom: false,
    doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false
  });
  sumMap = thisMap;

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19 }
  ).addTo(thisMap);

  const shotPositions = hLoggedShots.map(s => s.latlng).filter(Boolean);
  const boundsPoints = [
    [TEE_LL.lat, TEE_LL.lng],
    [GREEN_CTR.lat, GREEN_CTR.lng],
    ...shotPositions.map(ll => [ll.lat, ll.lng])
  ];
  thisMap.fitBounds(L.latLngBounds(boundsPoints), { padding: [18, 18] });

  // Static tee marker — shown immediately, never animated.
  L.marker([TEE_LL.lat, TEE_LL.lng], {
    icon: L.divIcon({
      html: '<div style="background:rgba(10,10,15,0.85);border:1.5px solid rgba(255,255,255,0.4);width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:rgba(255,255,255,0.7);font-family:Inter,sans-serif;">T</div>',
      iconSize: [16, 16], iconAnchor: [8, 8], className: ''
    }),
    interactive: false
  }).addTo(thisMap);

  // Static flag marker — shown immediately (skipped if DEGRADED, same
  // reasoning as the live map's flag marker: GREEN_CTR would be fabricated).
  if (!DEGRADED) {
    L.marker([GREEN_CTR.lat, GREEN_CTR.lng], {
      icon: L.divIcon({
        html: '<div style="display:flex;flex-direction:column;align-items:center;"><div style="width:2px;height:14px;background:rgba(255,255,255,0.9);"></div><div style="background:#E74C3C;border-radius:3px;padding:1px 5px;font-size:9px;">⛳</div></div>',
        iconSize: [24, 30], iconAnchor: [1, 30], className: ''
      }),
      interactive: false
    }).addTo(thisMap);
  }

  // Shots reveal one at a time — tee-to-shot1, then shot-to-shot, each firing
  // a bit after the previous. `thisMap` is captured in this closure and
  // compared against the module-level `sumMap` before each reveal fires, so
  // a stale timer from a previous hole (if the sheet is rebuilt quickly)
  // can never draw onto a map that's already been replaced.
  const points = [{ latlng: TEE_LL }, ...hLoggedShots.filter(s => s.latlng)];
  points.forEach((pt, i) => {
    if (i === 0) return; // the tee point itself, already drawn above
    const from = points[i - 1].latlng;
    const to = pt.latlng;
    setTimeout(() => {
      if (sumMap !== thisMap) return;
      L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
        color: 'rgba(241,196,15,0.5)', weight: 2, dashArray: '4,3'
      }).addTo(thisMap);

      const marker = L.marker([to.lat, to.lng], {
        icon: makeShotIcon(i, pt.holed), interactive: false, opacity: 0
      }).addTo(thisMap);
      const iconEl = marker.getElement();
      if (iconEl) {
        iconEl.style.transform = 'scale(0.4)';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          marker.setOpacity(1);
          iconEl.style.transform = 'scale(1)';
        }));
      } else {
        marker.setOpacity(1);
      }
    }, i * 450);
  });

  // Shot chips strip
```

- [ ] **Step 4: Remove the now-unused `x`/`y`/`svgId` bookkeeping from `hConfirmGPS`**

Find:

```js
  const svgPos = latLngToSumSVG(ll);
  const inferredLie = inferLie(hLoggedShots.length, fromLL);
  hLoggedShots.push({ leafletMarker, leafletLine, latlng: ll,
                       x: svgPos.x, y: svgPos.y, svgId: 'h-leaflet' });
  removePendingMarker();
```

Replace with:

```js
  const inferredLie = inferLie(hLoggedShots.length, fromLL);
  hLoggedShots.push({ leafletMarker, leafletLine, latlng: ll });
  removePendingMarker();
```

- [ ] **Step 5: Remove the now-unused `x`/`y`/`svgId` bookkeeping from `hHoleOutFromMap`**

Find:

```js
  hLoggedShots.push({ leafletMarker, leafletLine, latlng: GREEN_CTR,
                       x: 150, y: 24, svgId: 'h-leaflet', holed: true });
```

Replace with:

```js
  hLoggedShots.push({ leafletMarker, leafletLine, latlng: GREEN_CTR, holed: true });
```

- [ ] **Step 6: Simplify `undoLastHole`'s now-meaningless `svgId` check**

Find:

```js
  const nowLast = hLoggedShots.at(-1);
  if (nowLast?.svgId === 'h-leaflet' && nowLast.latlng) {
    updateDistanceBar(nowLast.latlng);
  } else {
```

Replace with:

```js
  const nowLast = hLoggedShots.at(-1);
  if (nowLast?.latlng) {
    updateDistanceBar(nowLast.latlng);
  } else {
```

- [ ] **Step 7: Simplify `autoDetectGIR`'s now-meaningless `svgId` branch**

Find:

```js
function autoDetectGIR(shot) {
  const row = document.getElementById('trow-green');
  if (shot.svgId === 'h-leaflet') {
    if (TcCourse.haversineYds(shot.latlng, GREEN_CTR) <= 18) { autoSetTog(row, 0, 't-g'); return 'GIR'; }
    autoSetTog(row, 1, 't-r'); return 'GIR-Miss';
  }
  // Green SVG shot
  const dx = (shot.x - 160) / 120, dy = (shot.y - 100) / 110;
  if (dx*dx + dy*dy <= 1) { autoSetTog(row, 0, 't-g'); return 'GIR'; }
  autoSetTog(row, 1, 't-r'); return 'GIR-Miss';
}
```

Replace with:

```js
function autoDetectGIR(shot) {
  const row = document.getElementById('trow-green');
  if (TcCourse.haversineYds(shot.latlng, GREEN_CTR) <= 18) { autoSetTog(row, 0, 't-g'); return 'GIR'; }
  autoSetTog(row, 1, 't-r'); return 'GIR-Miss';
}
```

- [ ] **Step 8: Simplify `confirmClub`'s now-meaningless `svgId` branch**

Find:

```js
    if (selectedClub === 'Putter') {
      // Putter: recalculate from confirmed ball position to pin, in feet.
      // Uses 10/37 ft/px — from 10ft ring (rx=37) in the green SVG.
      const cur = hLoggedShots.at(-1);
      if (cur && cur.svgId === 'h-green-svg') {
        dist = `${Math.max(1, Math.round(px2(cur.x, cur.y, 160, 100) * (10 / 37)))} ft`;
      } else if (cur && cur.latlng) {
        dist = `${Math.max(1, Math.round(haversineFt(cur.latlng, GREEN_CTR)))} ft`;
      } else if (dist.endsWith('yds')) {
        dist = `${Math.round(parseFloat(dist) * 3)} ft`;
      }
    }
```

Replace with:

```js
    if (selectedClub === 'Putter') {
      // Putter: recalculate from confirmed ball position to pin, in feet.
      const cur = hLoggedShots.at(-1);
      if (cur && cur.latlng) {
        dist = `${Math.max(1, Math.round(haversineFt(cur.latlng, GREEN_CTR)))} ft`;
      } else if (dist.endsWith('yds')) {
        dist = `${Math.round(parseFloat(dist) * 3)} ft`;
      }
    }
```

- [ ] **Step 9: Remove `latLngToSumSVG` and `greenToHoleSVG` — fully unused now**

Find:

```js
// GPS → approximate hole-summary-SVG coords (tee=155,234 / green=150,24).
function latLngToSumSVG(ll) {
  const t = Math.min(1, haversineYds(TEE_LL, ll) / haversineYds(TEE_LL, GREEN_CTR));
  return { x: 155 + (150 - 155) * t, y: 234 + (24 - 234) * t };
}
```

Delete this function entirely.

Find:

```js
// greenToHoleSVG still used for summary map (green SVG shots → summary SVG positions).
function greenToHoleSVG(gx, gy) {
  return { x: 150 + (gx - 160) * (19 / 74), y: 24 + (gy - 100) * (13 / 70) };
}
```

Delete this function entirely.

- [ ] **Step 10: Verify no remaining references to the removed pixel-position system**

Run:

```bash
grep -n "sum-svg\|latLngToSumSVG\|greenToHoleSVG\|svgId" pages/hole.html
```

Expected: no output (empty).

- [ ] **Step 11: Syntax-check the file**

```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('pages/hole.html', 'utf8');
const scripts = [...content.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```

Expected: every block prints `OK`.

- [ ] **Step 12: Manual verification — hole out and check the Hole Summary**

Using the same local server as Task 1 (`cd pages && python -m http.server 8420 --bind 127.0.0.1`), play a full hole (2+ shots) at a course with a real mapped green, then hole out. Confirm:
1. The summary sheet shows a real satellite view auto-framed to the tee, every shot, and the green — not the old illustrated fairway.
2. Shots and their connecting lines appear one at a time, staggered (not all at once).
3. The final shot (the hole-out) shows the ⛳ marker style, matching the live map's convention.
4. The score row, putts, and stats chips below the map still populate correctly (these were untouched by this task).
5. Undo a shot from the score sheet's "↩ Edit", hole out again — confirm the summary map rebuilds cleanly (no leftover markers from the previous attempt, no console errors about "Map container is already initialized").
6. Finish a full round and confirm nothing downstream (scorecard, round completion) regressed — this task didn't touch `hSaveAndNext`/`TcRounds.syncHole`, but confirm no unrelated breakage.

- [ ] **Step 13: Commit**

```bash
git add pages/hole.html
git commit -m "feat: Hole Summary shows a real, staggered-reveal map instead of an illustrated SVG"
```
