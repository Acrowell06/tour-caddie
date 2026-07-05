# Strokes Gained Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute real Strokes Gained (per shot, per category, per round) from shot-level data, replacing every hardcoded mock SG display in `pages/courses.html`, `pages/stats.html`, and `pages/home.html`.

**Architecture:** A new pure-math module `pages/tc-strokesgained.js` (baseline tables + expected-strokes lookup + categorization + the SG formula) is consumed by `pages/tc-rounds.js`, which computes SG once at round completion (the same trigger point that already computes the WHS differential) from the round's full shot history. Getting there first requires closing data gaps: GPS-inferred per-shot lie (captured in `hole.html`'s existing post-shot club-picker sheet, with a manual override tap), and persisted tee/green positions per hole — every shot's "distance to pin before" is the position the PREVIOUS shot landed at (or the tee, for shot 1), so both endpoints of a hole need to be on record, not just the green.

**Tech Stack:** Vanilla JS, existing Supabase schema (extended with 7 new nullable columns). No build step, no ES modules.

## Global Constraints

- No build step — plain `<script src="...">` tags only.
- **Baseline tables are approximate, illustrative reference curves** (based on publicly-known golf-analytics research, not licensed PGA Tour ShotLink data) — every place SG is displayed must communicate this is an estimate (copy like "vs. estimated baseline for your handicap"), never presented as authoritative.
- 4 discrete handicap tiers only (Scratch/Low ≤5, Mid ≤15, High ≤25, Beginner >25) — no continuous interpolation across handicap, matching how the reference research itself is presented as named archetypes, not a continuous function.
- Lie auto-detection covers `tee` (shot 1, always), `green` (within the existing 18-yard `autoDetectGIR` proximity threshold), `fairway` (within the existing 20-yard `autoDetectFIR` lateral-distance threshold), `rough` (everything else geometrically). `bunker`/`water`/`recovery` are **never** auto-detected (no hazard polygon data exists in this app's OSM pipeline) — always available as manual taps only.
- SG is computed **once at round completion** (`writeRoundComplete`), using the full shot history for the round — not incrementally per hole. This matches how the WHS differential is already computed there, not a new pattern.
- A hole's SG contribution requires: a persisted tee position, a persisted green position, and every shot in that hole having a resolvable lie and lat/lng — one missing shot invalidates every downstream shot in that hole (since each shot's distance-to-pin-before is the previous shot's landing spot), and the whole hole is skipped rather than partially counted. Matches the existing all-or-nothing principle already used for tee yardage and the differential's ESC calculation.
- SG is skipped entirely (left `null`) when the golfer has no `profiles.handicap_index` yet (fewer than 3 valid WHS rounds) — never computed against a guessed baseline tier.
- SG computation must never block the round's own `status`/`completed_at` write succeeding — same resilience pattern already fixed once during the WHS engine's review cycle (wrap in try/catch, degrade to "skip SG for this round" on any failure).
- No new Supabase RLS policies needed — all new columns live on `round_holes`/`shots`/`rounds`, already covered by existing policies from the rounds/shots persistence sub-project.

---

### Task 1: Database migration — SG columns

**Files:**
- Create: `supabase/migrations/0004_add_strokes_gained_columns.sql`

**Interfaces:**
- Produces: `round_holes.tee_lat`/`tee_lng`/`green_lat`/`green_lng` (double precision, nullable), `shots.sg_value` (numeric, nullable), `rounds.sg_ott`/`sg_app`/`sg_atg`/`sg_putt`/`sg_total` (numeric, nullable each).
- This task's SQL must be run against the live Supabase project by the user via the dashboard's SQL Editor — no database connection string is available in this session to apply it directly. If you are an agentic implementer with no way to prompt a human synchronously, stop and report NEEDS_CONTEXT asking the controller to relay this step to the user and confirm completion before continuing.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0004_add_strokes_gained_columns.sql

-- round_holes: persist tee AND green positions so distance-to-pin can be
-- computed after the fact from shot positions. Both endpoints of the hole
-- are needed — the tee position is where shot 1's "distance before" comes
-- from; the green position is what every shot's "distance to pin" is
-- measured against. Previously only used transiently client-side during
-- play (from OSM data), then discarded.
alter table public.round_holes add column tee_lat double precision;
alter table public.round_holes add column tee_lng double precision;
alter table public.round_holes add column green_lat double precision;
alter table public.round_holes add column green_lng double precision;

-- shots: per-shot Strokes Gained value (shots.lie already exists,
-- unpopulated by any code until this feature — no migration needed for it).
alter table public.shots add column sg_value numeric;

-- rounds: round-level SG rollup by category, mirroring how
-- rounds.differential already works.
alter table public.rounds add column sg_ott numeric;
alter table public.rounds add column sg_app numeric;
alter table public.rounds add column sg_atg numeric;
alter table public.rounds add column sg_putt numeric;
alter table public.rounds add column sg_total numeric;
```

- [ ] **Step 2: Ask the user to apply the migration**

Tell the user:

> "Open your Supabase project dashboard at https://supabase.com/dashboard/project/cfuxiifpvuzvysjxztax, go to the **SQL Editor**, paste the contents of `supabase/migrations/0004_add_strokes_gained_columns.sql`, and click **Run**. Let me know once it's run successfully (or paste any error it shows)."

Wait for the user's confirmation before proceeding. If they report an error, read it, fix the SQL file, and ask them to run the corrected version.

- [ ] **Step 3: Verify the columns exist**

Ask the user to confirm via the Supabase dashboard's **Table Editor** that `round_holes` now has `tee_lat`/`tee_lng`/`green_lat`/`green_lng`, `shots` now has `sg_value`, and `rounds` now has `sg_ott`/`sg_app`/`sg_atg`/`sg_putt`/`sg_total`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_add_strokes_gained_columns.sql
git commit -m "feat: add Strokes Gained columns (tee/green positions, per-shot/per-round SG)"
```

---

### Task 2: `pages/tc-strokesgained.js` — baseline tables and SG math

**Files:**
- Create: `pages/tc-strokesgained.js`

**Interfaces:**
- Produces: `window.TcStrokesGained` object with:
  - `TcStrokesGained.haversineYds(a, b)` → `number` — distance in yards between two `{lat, lng}` points (self-contained, no `tc-course.js` dependency).
  - `TcStrokesGained.tierForHandicap(handicapIndex)` → `'scratch' | 'mid' | 'high' | 'beginner' | null` — `null` when `handicapIndex` is `null`.
  - `TcStrokesGained.expectedStrokes(tier, lie, distanceYds)` → `number` — baseline lookup with linear interpolation between breakpoints, clamped at the table's min/max distance (no extrapolation beyond the table's range). `lie` is `'tee' | 'fairway' | 'rough' | 'bunker' | 'recovery' | 'green'`; `'tee'` reuses the `'fairway'` curve; `'green'` expects `distanceYds` and internally converts to feet (`× 3`) to look up the putting table.
  - `TcStrokesGained.categorize(lie, par, distanceToPinBeforeYds)` → `'ott' | 'app' | 'atg' | 'putt'`.
  - `TcStrokesGained.shotStrokesGained(tier, lieBefore, distBeforeYds, distAfterYds, lieAfter)` → `number`, rounded to 2 decimals — `expectedStrokes(tier, lieBefore, distBeforeYds) - (distAfterYds === 0 ? 0 : expectedStrokes(tier, lieAfter, distAfterYds)) - 1`. The caller (Task 4) passes in the ACTUAL next lie (or the shot is holed, signaled by `distAfterYds === 0`) — this function never guesses the after-lie itself.

- [ ] **Step 1: Create `pages/tc-strokesgained.js`**

```js
/* tc-strokesgained.js — Strokes Gained baseline tables and math.
   Baseline tables are approximate, illustrative reference curves based on
   publicly-known golf-analytics research (not licensed PGA Tour ShotLink
   data) — every consumer of this module must present SG as an estimate,
   never as authoritative. Pure functions + no dependencies (no Supabase,
   no tc-course.js) — mirrors tc-handicap.js's self-contained pattern. */
window.TcStrokesGained = (() => {
  // Distance breakpoints (yards) for full-swing lies; feet for putting.
  const FULL_SWING_DISTANCES = [20, 50, 100, 150, 200, 250];
  const PUTTING_DISTANCES_FT = [3, 6, 10, 20, 30, 50];

  // Expected strokes to hole out, by tier and lie, at each breakpoint above.
  // Approximate reference values — see module comment.
  const BASELINES = {
    scratch: {
      fairway: [2.4, 2.6, 2.8, 3.0, 3.3, 3.6],
      rough:   [2.6, 2.8, 3.0, 3.2, 3.6, 3.9],
      bunker:  [2.7, 2.9, 3.1, 3.4, 3.8, 4.1],
      putting: [1.04, 1.3, 1.6, 1.8, 2.0, 2.2]
    },
    mid: {
      fairway: [2.6, 2.9, 3.2, 3.5, 3.9, 4.3],
      rough:   [2.8, 3.1, 3.5, 3.8, 4.3, 4.7],
      bunker:  [3.0, 3.3, 3.7, 4.1, 4.6, 5.0],
      putting: [1.08, 1.4, 1.75, 2.0, 2.2, 2.4]
    },
    high: {
      fairway: [2.8, 3.2, 3.6, 4.0, 4.5, 5.0],
      rough:   [3.1, 3.5, 3.9, 4.4, 5.0, 5.5],
      bunker:  [3.3, 3.7, 4.2, 4.7, 5.3, 5.8],
      putting: [1.1, 1.5, 1.9, 2.2, 2.4, 2.6]
    },
    beginner: {
      fairway: [3.0, 3.5, 4.0, 4.5, 5.1, 5.7],
      rough:   [3.3, 3.9, 4.4, 5.0, 5.7, 6.3],
      bunker:  [3.6, 4.1, 4.7, 5.3, 6.0, 6.6],
      putting: [1.15, 1.6, 2.0, 2.4, 2.6, 2.9]
    }
  };
  // recovery reuses the rough curve plus a flat penalty (per tier), rather
  // than its own breakpoint table — a defensible simplification given no
  // real reference data distinguishes "recovery" shots this granularly.
  const RECOVERY_PENALTY = { scratch: 0.5, mid: 0.6, high: 0.7, beginner: 0.8 };

  function haversineYds(a, b) {
    if (!a || !b) return null;
    const R = 6371000; // meters
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    const meters = 2 * R * Math.asin(Math.sqrt(h));
    return meters * 1.09361; // meters -> yards
  }

  function tierForHandicap(handicapIndex) {
    if (handicapIndex == null) return null;
    if (handicapIndex <= 5) return 'scratch';
    if (handicapIndex <= 15) return 'mid';
    if (handicapIndex <= 25) return 'high';
    return 'beginner';
  }

  function interpolate(breakpoints, values, x) {
    if (x <= breakpoints[0]) return values[0];
    if (x >= breakpoints[breakpoints.length - 1]) return values[values.length - 1];
    for (let i = 0; i < breakpoints.length - 1; i++) {
      const x0 = breakpoints[i], x1 = breakpoints[i + 1];
      if (x >= x0 && x <= x1) {
        const t = (x - x0) / (x1 - x0);
        return values[i] + t * (values[i + 1] - values[i]);
      }
    }
    return values[values.length - 1];
  }

  function expectedStrokes(tier, lie, distanceYds) {
    const table = BASELINES[tier];
    if (!table) return null;

    if (lie === 'green') {
      const distFt = distanceYds * 3;
      return interpolate(PUTTING_DISTANCES_FT, table.putting, distFt);
    }
    if (lie === 'recovery') {
      return interpolate(FULL_SWING_DISTANCES, table.rough, distanceYds) + RECOVERY_PENALTY[tier];
    }
    const key = lie === 'tee' ? 'fairway' : lie;
    const curve = table[key];
    if (!curve) return null;
    return interpolate(FULL_SWING_DISTANCES, curve, distanceYds);
  }

  function categorize(lie, par, distanceToPinBeforeYds) {
    if (lie === 'tee' && par >= 4) return 'ott';
    if (lie === 'green') return 'putt';
    if (distanceToPinBeforeYds <= 30) return 'atg';
    return 'app';
  }

  function shotStrokesGained(tier, lieBefore, distBeforeYds, distAfterYds, lieAfter) {
    const before = expectedStrokes(tier, lieBefore, distBeforeYds);
    const after = distAfterYds === 0 ? 0 : expectedStrokes(tier, lieAfter, distAfterYds);
    if (before == null || after == null) return null;
    return Math.round((before - after - 1) * 100) / 100;
  }

  return { haversineYds, tierForHandicap, expectedStrokes, categorize, shotStrokesGained };
})();
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "
const fs = require('fs');
try { new Function(fs.readFileSync('pages/tc-strokesgained.js', 'utf8')); console.log('OK'); }
catch (e) { console.log('SYNTAX ERROR:', e.message); }
"
```
Expected: `OK`.

- [ ] **Step 3: Verify the math against hand-computed examples**

```bash
node -e "
const fs = require('fs');
global.window = {};
new Function(fs.readFileSync('pages/tc-strokesgained.js', 'utf8'))();
const SG = window.TcStrokesGained;

console.log('tierForHandicap(3):', SG.tierForHandicap(3), '(expect scratch)');
console.log('tierForHandicap(12):', SG.tierForHandicap(12), '(expect mid)');
console.log('tierForHandicap(22):', SG.tierForHandicap(22), '(expect high)');
console.log('tierForHandicap(30):', SG.tierForHandicap(30), '(expect beginner)');
console.log('tierForHandicap(null):', SG.tierForHandicap(null), '(expect null)');

// Exact breakpoint (no interpolation): scratch fairway at 100y = 2.8
console.log('expectedStrokes(scratch,fairway,100):', SG.expectedStrokes('scratch', 'fairway', 100), '(expect 2.8)');

// Interpolated: scratch fairway at 125y is halfway between 100(2.8) and 150(3.0) = 2.9
console.log('expectedStrokes(scratch,fairway,125):', SG.expectedStrokes('scratch', 'fairway', 125), '(expect 2.9)');

// Clamped below range: scratch fairway at 5y clamps to the 20y value (2.4)
console.log('expectedStrokes(scratch,fairway,5):', SG.expectedStrokes('scratch', 'fairway', 5), '(expect 2.4)');

// Clamped above range: mid rough at 400y clamps to the 250y value (4.7)
console.log('expectedStrokes(mid,rough,400):', SG.expectedStrokes('mid', 'rough', 400), '(expect 4.7)');

// tee reuses fairway curve exactly
console.log('expectedStrokes(high,tee,150) === expectedStrokes(high,fairway,150):',
  SG.expectedStrokes('high', 'tee', 150) === SG.expectedStrokes('high', 'fairway', 150), '(expect true)');

// recovery = rough + penalty: mid rough at 100y (3.5) + 0.6 = 4.1
console.log('expectedStrokes(mid,recovery,100):', SG.expectedStrokes('mid', 'recovery', 100), '(expect 4.1)');

// putting: distance in yards converted to feet (x3); scratch putting at 10ft exact breakpoint = 1.6
console.log('expectedStrokes(scratch,green,3.333):', SG.expectedStrokes('scratch', 'green', 10/3), '(expect ~1.6)');

console.log('categorize(tee,4,300):', SG.categorize('tee', 4, 300), '(expect ott)');
console.log('categorize(tee,3,150):', SG.categorize('tee', 3, 150), '(expect app)');
console.log('categorize(green,4,0):', SG.categorize('green', 4, 0), '(expect putt)');
console.log('categorize(fairway,4,20):', SG.categorize('fairway', 4, 20), '(expect atg)');
console.log('categorize(rough,4,80):', SG.categorize('rough', 4, 80), '(expect app)');

// Shot SG: scratch tee shot (fairway curve) from 300y to 150y fairway
// = expectedStrokes(scratch,fairway,300)[clamped to 250=3.6] - expectedStrokes(scratch,fairway,150)[3.0] - 1 = -0.4
console.log('shotStrokesGained(scratch,tee,300,150,fairway):', SG.shotStrokesGained('scratch', 'tee', 300, 150, 'fairway'), '(expect -0.4)');

// Holed putt: distAfterYds=0 short-circuits to 'after' = 0
// scratch green at 10ft (1.6) holed = 1.6 - 0 - 1 = 0.6
console.log('shotStrokesGained(scratch,green,10/3,0,null):', SG.shotStrokesGained('scratch', 'green', 10/3, 0, null), '(expect 0.6)');
"
```
Expected output (each line, in order):
```
tierForHandicap(3): scratch (expect scratch)
tierForHandicap(12): mid (expect mid)
tierForHandicap(22): high (expect high)
tierForHandicap(30): beginner (expect beginner)
tierForHandicap(null): null (expect null)
expectedStrokes(scratch,fairway,100): 2.8 (expect 2.8)
expectedStrokes(scratch,fairway,125): 2.9 (expect 2.9)
expectedStrokes(scratch,fairway,5): 2.4 (expect 2.4)
expectedStrokes(mid,rough,400): 4.7 (expect 4.7)
expectedStrokes(high,tee,150) === expectedStrokes(high,fairway,150): true (expect true)
expectedStrokes(mid,recovery,100): 4.1 (expect 4.1)
expectedStrokes(scratch,green,3.333): 1.6 (expect ~1.6)
categorize(tee,4,300): ott (expect ott)
categorize(tee,3,150): app (expect app)
categorize(green,4,0): putt (expect putt)
categorize(fairway,4,20): atg (expect atg)
categorize(rough,4,80): app (expect app)
shotStrokesGained(scratch,tee,300,150,fairway): -0.4 (expect -0.4)
shotStrokesGained(scratch,green,10/3,0,null): 0.6 (expect 0.6)
```

- [ ] **Step 4: Commit**

```bash
git add pages/tc-strokesgained.js
git commit -m "feat: add tc-strokesgained.js — baseline tables and SG math"
```

---

### Task 3: `pages/hole.html` — infer and confirm per-shot lie, persist tee/green positions

**Files:**
- Modify: `pages/hole.html`

**Interfaces:**
- Consumes: nothing new from other tasks (uses existing `TEE_LL`, `GREEN_CTR`, `TcCourse.haversineYds`, `hLoggedShots`).
- Produces: each entry in `buildShotsPayload()`'s output now includes a `lie` field (`'tee' | 'fairway' | 'rough' | 'bunker' | 'recovery' | 'green'`). The `TcRounds.syncHole(...)` payload (from `hSaveAndNext`) now includes `teeLat`/`teeLng`/`greenLat`/`greenLng`. All consumed by Task 4.

- [ ] **Step 1: Add a lie-inference function, reusing the existing FIR/GIR distance math**

Find:
```js
function autoDetectFIR(latlng) {
```

Insert this new function immediately **before** it:
```js
// Infers a shot's STARTING lie from GPS geometry alone. Confidently
// distinguishes tee/green/fairway/rough; never infers bunker/water/
// recovery (no hazard polygon data exists in this app's course pipeline) —
// those three are always available as a manual correction in the club
// picker, never auto-selected.
function inferLie(shotIndex, fromLL) {
  if (shotIndex === 0) return 'tee';
  if (TcCourse.haversineYds(fromLL, GREEN_CTR) <= 18) return 'green';

  const total = TcCourse.haversineYds(TEE_LL, GREEN_CTR);
  const t = Math.min(1, TcCourse.haversineYds(TEE_LL, fromLL) / total);
  const axisLL = {
    lat: TEE_LL.lat + (GREEN_CTR.lat - TEE_LL.lat) * t,
    lng: TEE_LL.lng + (GREEN_CTR.lng - TEE_LL.lng) * t
  };
  const lateral = TcCourse.haversineYds(fromLL, axisLL);
  return lateral <= 20 ? 'fairway' : 'rough';
}

function autoDetectFIR(latlng) {
```

- [ ] **Step 2: Add a lie row to the club-picker sheet, pre-selected via `inferLie`, tappable to override**

Find:
```html
    <div class="club-grp" id="club-sec-woods">
      <div class="club-grp-lbl">Woods / Hybrids</div>
```

Replace with:
```html
    <div class="club-grp" id="club-sec-lie">
      <div class="club-grp-lbl">Lie</div>
      <div class="club-btns" id="lie-btns">
        <div class="cbtn" data-lie="tee" onclick="selectLie(this,'tee')">Tee</div>
        <div class="cbtn" data-lie="fairway" onclick="selectLie(this,'fairway')">Fairway</div>
        <div class="cbtn" data-lie="rough" onclick="selectLie(this,'rough')">Rough</div>
        <div class="cbtn" data-lie="bunker" onclick="selectLie(this,'bunker')">Bunker</div>
        <div class="cbtn" data-lie="recovery" onclick="selectLie(this,'recovery')">Recovery</div>
        <div class="cbtn" data-lie="green" onclick="selectLie(this,'green')">Green</div>
      </div>
    </div>
    <div class="club-grp" id="club-sec-woods">
      <div class="club-grp-lbl">Woods / Hybrids</div>
```

- [ ] **Step 3: Track the pending shot's inferred/selected lie, pre-select it when the picker opens, and let a tap override it**

Find:
```js
let pendingShot = null;
let selectedClub = null;
```

Replace with:
```js
let pendingShot = null;
let selectedClub = null;
let selectedLie = null;

function selectLie(btn, lie) {
  document.querySelectorAll('#lie-btns .cbtn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
  selectedLie = lie;
}
```

Find:
```js
function openClubPicker(shotNum, yds, isGreen) {
  pendingShot = { shotNum, yds };
  selectedClub = null;
  document.querySelectorAll('#club-ov .cbtn').forEach(b => b.classList.remove('sel'));
  document.getElementById('club-shot-label').textContent = `Shot ${shotNum} · ${yds}`;
```

Replace with:
```js
function openClubPicker(shotNum, yds, isGreen) {
  pendingShot = { shotNum, yds };
  selectedClub = null;
  document.querySelectorAll('#club-ov .cbtn').forEach(b => b.classList.remove('sel'));
  document.getElementById('club-shot-label').textContent = `Shot ${shotNum} · ${yds}`;

  const fromLL = hLoggedShots.at(-1)?.latlng ?? TEE_LL;
  const inferred = inferLie(hLoggedShots.length, fromLL);
  selectedLie = inferred;
  document.querySelectorAll('#lie-btns .cbtn').forEach(b => {
    b.classList.toggle('sel', b.dataset.lie === inferred);
  });
```

- [ ] **Step 4: Store the resolved lie on each `hShotLog` entry**

Find:
```js
function confirmClub() {
  if (pendingShot) {
    let dist = pendingShot.yds;
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
    // Non-putter: dist is already "X yds from previous ball" or "X yds from fringe"
    hShotLog.push({ num: pendingShot.shotNum, club: selectedClub, yds: dist });
    renderShotLog();
  }
  pendingShot = null;
  selectedClub = null;
  document.getElementById('club-ov').classList.remove('open');
}

function skipClub() {
  if (pendingShot) {
    hShotLog.push({ num: pendingShot.shotNum, club: null, yds: pendingShot.yds });
    renderShotLog();
    pendingShot = null;
  }
  document.getElementById('club-ov').classList.remove('open');
}
```

Replace with:
```js
function confirmClub() {
  if (pendingShot) {
    let dist = pendingShot.yds;
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
    // Non-putter: dist is already "X yds from previous ball" or "X yds from fringe"
    hShotLog.push({ num: pendingShot.shotNum, club: selectedClub, yds: dist, lie: selectedLie });
    renderShotLog();
  }
  pendingShot = null;
  selectedClub = null;
  selectedLie = null;
  document.getElementById('club-ov').classList.remove('open');
}

function skipClub() {
  if (pendingShot) {
    hShotLog.push({ num: pendingShot.shotNum, club: null, yds: pendingShot.yds, lie: selectedLie });
    renderShotLog();
    pendingShot = null;
  }
  selectedLie = null;
  document.getElementById('club-ov').classList.remove('open');
}
```

- [ ] **Step 5: Include `lie` per shot and the hole's tee/green positions in the sync payload**

Find:
```js
function buildShotsPayload() {
  return hLoggedShots.map((pos, i) => {
    const log = hShotLog[i] || {};
    const prev = i > 0 ? hLoggedShots[i - 1] : null;
    const fromLL = prev?.latlng ?? TEE_LL;
    const distanceYards = pos.latlng
      ? Math.round(TcCourse.haversineYds(fromLL, pos.latlng))
      : null;
    return {
      shotNumber: log.num ?? (i + 1),
      club: log.club ?? null,
      lat: pos.latlng?.lat ?? null,
      lng: pos.latlng?.lng ?? null,
      result: log.holed ? 'holed' : null,
      distanceYards
    };
  });
}
```

Replace with:
```js
function buildShotsPayload() {
  return hLoggedShots.map((pos, i) => {
    const log = hShotLog[i] || {};
    const prev = i > 0 ? hLoggedShots[i - 1] : null;
    const fromLL = prev?.latlng ?? TEE_LL;
    const distanceYards = pos.latlng
      ? Math.round(TcCourse.haversineYds(fromLL, pos.latlng))
      : null;
    return {
      shotNumber: log.num ?? (i + 1),
      club: log.club ?? null,
      lat: pos.latlng?.lat ?? null,
      lng: pos.latlng?.lng ?? null,
      result: log.holed ? 'holed' : null,
      lie: log.lie ?? null,
      distanceYards
    };
  });
}
```

Find:
```js
  TcRounds.syncHole({
    holeNumber: _holeNum,
    par: PAR,
    handicap: _holeData?.handicap ?? null,
    strokes: hShotCount,
    putts: Math.max(0, hShotLog.filter(s => s.club === 'Putter' || s.holed).length),
    fir: firSt ? firSt.idx === 0 : null,
    gir: girSt ? girSt.idx === 0 : null,
    upAndDown,
    fairwayDirection: firSt ? firLabels[firSt.idx] : null,
    girDirection: girSt ? greenLabels[girSt.idx] : null,
    shots: buildShotsPayload()
  }).catch(err => console.error('TcRounds: syncHole failed unexpectedly', err));
```

Replace with:
```js
  TcRounds.syncHole({
    holeNumber: _holeNum,
    par: PAR,
    handicap: _holeData?.handicap ?? null,
    strokes: hShotCount,
    putts: Math.max(0, hShotLog.filter(s => s.club === 'Putter' || s.holed).length),
    fir: firSt ? firSt.idx === 0 : null,
    gir: girSt ? girSt.idx === 0 : null,
    upAndDown,
    fairwayDirection: firSt ? firLabels[firSt.idx] : null,
    girDirection: girSt ? greenLabels[girSt.idx] : null,
    teeLat: HAS_REAL_TEE ? TEE_LL.lat : null,
    teeLng: HAS_REAL_TEE ? TEE_LL.lng : null,
    greenLat: _holeData?.green ? GREEN_CTR.lat : null,
    greenLng: _holeData?.green ? GREEN_CTR.lng : null,
    shots: buildShotsPayload()
  }).catch(err => console.error('TcRounds: syncHole failed unexpectedly', err));
```

- [ ] **Step 6: Verify syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('pages/hole.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```
Expected: every block reports `OK`.

- [ ] **Step 7: Commit**

```bash
git add pages/hole.html
git commit -m "feat: hole.html — infer per-shot lie (manual override), persist tee/green positions"
```

---

### Task 4: `pages/tc-rounds.js` — compute and store Strokes Gained at round completion

**Files:**
- Modify: `pages/tc-rounds.js`

**Interfaces:**
- Consumes: `TcStrokesGained.tierForHandicap`, `.expectedStrokes`, `.categorize`, `.shotStrokesGained`, `.haversineYds` from Task 2. `payload.teeLat`/`.teeLng`/`.greenLat`/`.greenLng` and each shot's `lie` field, from Task 3's extended `syncHole`/`buildShotsPayload` (already flowing through the existing `writeHoleResult` payload).
- Produces: writes `round_holes.tee_lat`/`tee_lng`/`green_lat`/`green_lng`, `shots.lie`, `shots.sg_value`; writes `rounds.sg_ott`/`sg_app`/`sg_atg`/`sg_putt`/`sg_total` at round completion.
- Every `window.TcStrokesGained` reference must be guarded (this file loads on pages, like `courses.html`, that don't load `tc-strokesgained.js`) — same pattern already established for `window.TcHandicap` guards in this file.

- [ ] **Step 1: Persist tee/green position and lie in `writeHoleResult`**

Find:
```js
  async function writeHoleResult(roundId, payload) {
    const { data, error } = await TcAuth.client
      .from('round_holes')
      .upsert({
        round_id: roundId,
        hole_number: payload.holeNumber,
        par: payload.par,
        handicap: payload.handicap,
        gross_score: payload.strokes,
        putts: payload.putts,
        fairway_hit: payload.fir,
        gir: payload.gir,
        fairway_direction: payload.fairwayDirection,
        gir_direction: payload.girDirection,
        scramble: payload.upAndDown
      }, { onConflict: 'round_id,hole_number' })
      .select('id')
      .single();
    if (error) { console.error('TcRounds: failed to sync hole', error); return false; }
```

Replace with:
```js
  async function writeHoleResult(roundId, payload) {
    const { data, error } = await TcAuth.client
      .from('round_holes')
      .upsert({
        round_id: roundId,
        hole_number: payload.holeNumber,
        par: payload.par,
        handicap: payload.handicap,
        gross_score: payload.strokes,
        putts: payload.putts,
        fairway_hit: payload.fir,
        gir: payload.gir,
        fairway_direction: payload.fairwayDirection,
        gir_direction: payload.girDirection,
        scramble: payload.upAndDown,
        tee_lat: payload.teeLat ?? null,
        tee_lng: payload.teeLng ?? null,
        green_lat: payload.greenLat ?? null,
        green_lng: payload.greenLng ?? null
      }, { onConflict: 'round_id,hole_number' })
      .select('id')
      .single();
    if (error) { console.error('TcRounds: failed to sync hole', error); return false; }
```

Find:
```js
    if (payload.shots && payload.shots.length > 0) {
      const shotRows = payload.shots.map(s => ({
        round_id: roundId,
        hole_number: payload.holeNumber,
        shot_number: s.shotNumber,
        club: s.club,
        lat: s.lat,
        lng: s.lng,
        result: s.result,
        distance_yds: s.distanceYards
      }));
      const { error: shotsError } = await TcAuth.client.from('shots').insert(shotRows);
      if (shotsError) { console.error('TcRounds: failed to sync shots', shotsError); return false; }
    }
    return true;
  }
```

Replace with:
```js
    if (payload.shots && payload.shots.length > 0) {
      const shotRows = payload.shots.map(s => ({
        round_id: roundId,
        hole_number: payload.holeNumber,
        shot_number: s.shotNumber,
        club: s.club,
        lat: s.lat,
        lng: s.lng,
        result: s.result,
        lie: s.lie ?? null,
        distance_yds: s.distanceYards
      }));
      const { error: shotsError } = await TcAuth.client.from('shots').insert(shotRows);
      if (shotsError) { console.error('TcRounds: failed to sync shots', shotsError); return false; }
    }
    return true;
  }
```

- [ ] **Step 2: Add the SG computation function**

Find:
```js
  async function recomputeHandicapIndex(session) {
```

Insert this new function immediately **before** it:
```js
  async function computeRoundStrokesGained(session, roundId, holes) {
    if (!window.TcStrokesGained) return null;
    if (!holes || holes.some(h => h.tee_lat == null || h.tee_lng == null || h.green_lat == null || h.green_lng == null)) return null;

    const { data: profile } = await TcAuth.client
      .from('profiles')
      .select('handicap_index')
      .eq('id', session.user.id)
      .single();
    const tier = window.TcStrokesGained.tierForHandicap(profile?.handicap_index ?? null);
    if (!tier) return null; // not enough rounds yet for a real handicap — skip SG rather than guess a tier

    const { data: shots, error } = await TcAuth.client
      .from('shots')
      .select('id, hole_number, shot_number, lie, lat, lng, result')
      .eq('round_id', roundId)
      .order('hole_number', { ascending: true })
      .order('shot_number', { ascending: true });
    if (error || !shots) { console.error('TcRounds: failed to fetch shots for SG', error); return null; }

    const SG = window.TcStrokesGained;
    const holeByNumber = {};
    holes.forEach(h => { holeByNumber[h.hole_number] = h; });

    const shotUpdates = [];
    const totals = { ott: 0, app: 0, atg: 0, putt: 0 };
    let anyHoleCounted = false;

    for (const holeNumKey of Object.keys(holeByNumber)) {
      const hole = holeByNumber[holeNumKey];
      const holeShots = shots.filter(s => String(s.hole_number) === String(holeNumKey));
      if (holeShots.length === 0) continue;

      const teeLL = { lat: hole.tee_lat, lng: hole.tee_lng };
      const greenLL = { lat: hole.green_lat, lng: hole.green_lng };

      // Resolve each shot's before/after distance-to-pin and lie. Before-
      // position for shot i is the tee (i===0) or the previous shot's
      // landing spot; after-position is this shot's own landing spot, or
      // "holed" (distance 0) if it went in.
      const resolved = [];
      let chainBroken = false;
      for (let i = 0; i < holeShots.length; i++) {
        const s = holeShots[i];
        if (s.lat == null || s.lng == null || !s.lie) { chainBroken = true; break; }

        const beforeLL = i === 0 ? teeLL : { lat: holeShots[i - 1].lat, lng: holeShots[i - 1].lng };
        const lieBefore = s.lie;
        const distBefore = SG.haversineYds(beforeLL, greenLL);
        const distAfter = s.result === 'holed' ? 0 : SG.haversineYds({ lat: s.lat, lng: s.lng }, greenLL);
        if (distBefore == null || distAfter == null) { chainBroken = true; break; }

        resolved.push({ id: s.id, lieBefore, distBefore, distAfter });
      }
      if (chainBroken) continue;

      anyHoleCounted = true;
      for (let i = 0; i < resolved.length; i++) {
        const r = resolved[i];
        const lieAfter = i + 1 < resolved.length ? resolved[i + 1].lieBefore : 'green'; // holed shots never reach expectedStrokes(after) since distAfter===0 short-circuits
        const sg = SG.shotStrokesGained(tier, r.lieBefore, r.distBefore, r.distAfter, lieAfter);
        if (sg == null) { anyHoleCounted = false; break; }
        const category = SG.categorize(r.lieBefore, hole.par, r.distBefore);
        totals[category] += sg;
        shotUpdates.push({ id: r.id, sg_value: sg });
      }
    }

    if (!anyHoleCounted || shotUpdates.length === 0) return null;

    for (const u of shotUpdates) {
      const { error: updateError } = await TcAuth.client.from('shots').update({ sg_value: u.sg_value }).eq('id', u.id);
      if (updateError) console.error('TcRounds: failed to write shot SG value', updateError);
    }

    const total = totals.ott + totals.app + totals.atg + totals.putt;
    return {
      ott: Math.round(totals.ott * 100) / 100,
      app: Math.round(totals.app * 100) / 100,
      atg: Math.round(totals.atg * 100) / 100,
      putt: Math.round(totals.putt * 100) / 100,
      total: Math.round(total * 100) / 100
    };
  }

  async function recomputeHandicapIndex(session) {
```

- [ ] **Step 3: Wire SG computation into `writeRoundComplete`, guarded so a failure never blocks the round's own completion write**

Find:
```js
  async function writeRoundComplete(roundId, payload) {
    const session = await TcAuth.getSession();
    if (!session) return false;

    const holes = await fetchRoundHoles(roundId);
    const grossScore = holes ? holes.reduce((a, h) => a + (h.gross_score ?? 0), 0) : null;

    const diffResult = await computeRoundDifferential(session, holes, payload?.courseRating, payload?.slopeRating);

    const update = { status: 'complete', completed_at: new Date().toISOString() };
    if (grossScore != null) {
      update.gross_score = grossScore;
    }
    if (diffResult) {
      update.differential = diffResult.differential;
      update.adjusted_score = diffResult.adjustedGross;
    }

    const { error } = await TcAuth.client
      .from('rounds')
      .update(update)
      .eq('id', roundId)
      .eq('user_id', session.user.id);
    if (error) { console.error('TcRounds: failed to complete round', error); return false; }

    if (diffResult) {
      const indexOk = await recomputeHandicapIndex(session);
      if (!indexOk) return false;
    }
    return true;
  }
```

Replace with:
```js
  async function writeRoundComplete(roundId, payload) {
    const session = await TcAuth.getSession();
    if (!session) return false;

    const holes = await fetchRoundHoles(roundId);
    const grossScore = holes ? holes.reduce((a, h) => a + (h.gross_score ?? 0), 0) : null;

    const diffResult = await computeRoundDifferential(session, holes, payload?.courseRating, payload?.slopeRating);

    let sgResult = null;
    try {
      sgResult = await computeRoundStrokesGained(session, roundId, holes);
    } catch (e) {
      console.error('TcRounds: Strokes Gained computation threw', e);
      sgResult = null;
    }

    const update = { status: 'complete', completed_at: new Date().toISOString() };
    if (grossScore != null) {
      update.gross_score = grossScore;
    }
    if (diffResult) {
      update.differential = diffResult.differential;
      update.adjusted_score = diffResult.adjustedGross;
    }
    if (sgResult) {
      update.sg_ott = sgResult.ott;
      update.sg_app = sgResult.app;
      update.sg_atg = sgResult.atg;
      update.sg_putt = sgResult.putt;
      update.sg_total = sgResult.total;
    }

    const { error } = await TcAuth.client
      .from('rounds')
      .update(update)
      .eq('id', roundId)
      .eq('user_id', session.user.id);
    if (error) { console.error('TcRounds: failed to complete round', error); return false; }

    if (diffResult) {
      const indexOk = await recomputeHandicapIndex(session);
      if (!indexOk) return false;
    }
    return true;
  }
```

- [ ] **Step 4: Verify syntax**

```bash
node -e "
const fs = require('fs');
try { new Function(fs.readFileSync('pages/tc-rounds.js', 'utf8')); console.log('OK'); }
catch (e) { console.log('SYNTAX ERROR:', e.message); }
"
```
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add pages/tc-rounds.js
git commit -m "feat: tc-rounds.js — compute and store Strokes Gained at round completion"
```

---

### Task 5: `pages/courses.html`, `pages/stats.html`, `pages/home.html` — display real Strokes Gained

**Files:**
- Modify: `pages/tc-rounds.js`, `pages/courses.html`, `pages/stats.html`, `pages/home.html`

**Interfaces:**
- Consumes: `rounds.sg_ott`/`sg_app`/`sg_atg`/`sg_putt`/`sg_total` from Task 4, via `TcRounds.fetchUserRounds()`.

- [ ] **Step 1: Stop hardcoding `sg: null` in `transformRound()` — build it from the real columns**

Find:
```js
  async function fetchUserRounds() {
    const session = await TcAuth.getSession();
    if (!session) return null;
    const { data, error } = await TcAuth.client
      .from('rounds')
      .select('id, course_name, tee_name, tee_yardage, played_at, completed_at, status, round_holes(hole_number, par, gross_score, putts, fairway_hit, gir, scramble)')
      .eq('user_id', session.user.id)
      .eq('status', 'complete')
      .order('completed_at', { ascending: false, nullsFirst: false })
      .order('played_at', { ascending: false });
    if (error) { console.error('TcRounds: failed to fetch rounds', error); return null; }
    return data.map(transformRound);
  }
```

Replace with:
```js
  async function fetchUserRounds() {
    const session = await TcAuth.getSession();
    if (!session) return null;
    const { data, error } = await TcAuth.client
      .from('rounds')
      .select('id, course_name, tee_name, tee_yardage, played_at, completed_at, status, sg_ott, sg_app, sg_atg, sg_putt, sg_total, round_holes(hole_number, par, gross_score, putts, fairway_hit, gir, scramble)')
      .eq('user_id', session.user.id)
      .eq('status', 'complete')
      .order('completed_at', { ascending: false, nullsFirst: false })
      .order('played_at', { ascending: false });
    if (error) { console.error('TcRounds: failed to fetch rounds', error); return null; }
    return data.map(transformRound);
  }
```

Find:
```js
    return {
      id: row.id,
      course: row.course_name || 'Unknown Course',
      date, month,
      tee: row.tee_name ? `${row.tee_name}${row.tee_yardage ? ' · ' + row.tee_yardage.toLocaleString() + ' yds' : ''}` : '—',
      type: 'Home', // no round_type column in the live schema; nothing in the UI sets this yet
      score, gross, diff: null,
      fir, gir, putts, up_down: upDown,
      sg: null,
      holes, pars,
      chips: [`${fir}% FIR`, `${gir}% GIR`, `${putts} putts`]
    };
  }
```

Replace with:
```js
    return {
      id: row.id,
      course: row.course_name || 'Unknown Course',
      date, month,
      tee: row.tee_name ? `${row.tee_name}${row.tee_yardage ? ' · ' + row.tee_yardage.toLocaleString() + ' yds' : ''}` : '—',
      type: 'Home', // no round_type column in the live schema; nothing in the UI sets this yet
      score, gross, diff: null,
      fir, gir, putts, up_down: upDown,
      sg: row.sg_total != null ? { ott: row.sg_ott, app: row.sg_app, atg: row.sg_atg, putt: row.sg_putt, total: row.sg_total } : null,
      holes, pars,
      chips: [`${fir}% FIR`, `${gir}% GIR`, `${putts} putts`]
    };
  }
```

- [ ] **Step 2: `pages/courses.html` — label the SG tab as an estimate**

Find:
```js
    <div style="text-align:center;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:14px;">
      <div style="font-size:42px;font-weight:900;color:${totalColor};letter-spacing:-2px;line-height:1;">${totalStr}</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin-top:4px;">SG TOTAL · THIS ROUND</div>
    </div>
    <div class="rd-sec">Strokes Gained by Category</div>` +
```

Replace with:
```js
    <div style="text-align:center;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:14px;">
      <div style="font-size:42px;font-weight:900;color:${totalColor};letter-spacing:-2px;line-height:1;">${totalStr}</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin-top:4px;">SG TOTAL · THIS ROUND (vs. estimated baseline for your handicap)</div>
    </div>
    <div class="rd-sec">Strokes Gained by Category</div>` +
```

(`renderRdSG`'s existing `if (!sg) { ... "coming in a future update" ... }` placeholder path is unchanged — real `sg` data from Step 1 now reaches this function whenever `rounds.sg_total` is populated, exactly as the placeholder logic already expects.)

- [ ] **Step 3: `pages/stats.html` — replace the mock SG card entry and drill-down with real data**

Find:
```js
  {
    id:'sg',
    name:'Strokes Gained', icon:'📈', color:'#2ECC71',
    val:'+1.1', lbl:'SG TOTAL', trend:'▲ 0.2', tc:'g',
    desc:'vs. scratch baseline · all categories',
    chips:['+0.6 App','−0.2 ATG','+0.4 OTT'],
  },
```

Replace with:
```js
  {
    id:'sg',
    name:'Strokes Gained', icon:'📈', color:'#2ECC71',
    val:'—', lbl:'SG TOTAL', trend:null, tc:'g',
    desc:'vs. estimated baseline for your handicap',
    chips:[],
  },
```

Find:
```js
function renderSG(body) {
  body.innerHTML = `
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-size:42px;font-weight:900;color:var(--green);letter-spacing:-2px;line-height:1;">+1.1</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin-top:4px;">SG TOTAL vs. SCRATCH</div>
      <div style="font-size:11px;color:var(--green);margin-top:6px;font-weight:700;">▲ 0.2 · trending up this season</div>
    </div>` +

    sec('Strokes Gained by Category') +
    sgBar('SG: Approach',      0.6, 0.8) +
    sgBar('SG: Tee-to-Green',  0.8, 0.8) +
    sgBar('SG: Off the Tee',   0.4, 0.8) +
    sgBar('SG: Putting',       0.3, 0.8) +
    sgBar('SG: Around Green', -0.2, 0.8) +

    kpi([
      {v:'+0.4',l:'SG OTT', c:'var(--green)'},
      {v:'+0.6',l:'SG APP', c:'var(--green)'},
      {v:'−0.2',l:'SG ATG', c:'var(--red)'},
      {v:'+0.3',l:'SG PUTT',c:'var(--green)'},
    ], 4) +

    `<div style="font-size:11px;color:var(--muted);line-height:1.65;margin-top:4px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;">
      <strong style="color:rgba(255,255,255,0.85);">Insight:</strong> Approach (+0.6) is your biggest strength — you're gaining more than half a stroke per round on the field just with your irons. Around the Green (−0.2) is the only area below scratch. Improving scrambling from 58% to 65% would flip ATG to roughly +0.2 and push SG Total above +1.3.
    </div>
    <div style="height:12px;"></div>`;
}
```

Replace with:
```js
async function renderSG(body) {
  body.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--muted);font-size:12px;">Loading…</div>';

  const session = await TcAuth.getSession();
  if (!session) { body.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--muted);font-size:12px;">Sign in to see your Strokes Gained.</div>'; return; }

  const { data: rounds, error } = await TcAuth.client
    .from('rounds')
    .select('sg_ott, sg_app, sg_atg, sg_putt, sg_total')
    .eq('user_id', session.user.id)
    .eq('status', 'complete')
    .not('sg_total', 'is', null)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(20);

  if (error || !rounds || rounds.length === 0) {
    body.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--muted);font-size:12px;">No Strokes Gained data yet — play a full round at a well-mapped course to see it here.</div>';
    return;
  }

  const avg = key => Math.round((rounds.reduce((a, r) => a + (r[key] || 0), 0) / rounds.length) * 100) / 100;
  const totals = { ott: avg('sg_ott'), app: avg('sg_app'), atg: avg('sg_atg'), putt: avg('sg_putt'), total: avg('sg_total') };
  const fmt = v => (v > 0 ? '+' : '') + v.toFixed(1);
  const totalColor = totals.total >= 0 ? 'var(--green)' : 'var(--red)';

  body.innerHTML = `
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-size:42px;font-weight:900;color:${totalColor};letter-spacing:-2px;line-height:1;">${fmt(totals.total)}</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin-top:4px;">SG TOTAL vs. ESTIMATED BASELINE (avg. of last ${rounds.length})</div>
    </div>` +

    sec('Strokes Gained by Category') +
    sgBar('SG: Approach',      totals.app,  1.0) +
    sgBar('SG: Off the Tee',   totals.ott,  1.0) +
    sgBar('SG: Putting',      totals.putt, 1.0) +
    sgBar('SG: Around Green', totals.atg,  1.0) +

    kpi([
      {v:fmt(totals.ott),  l:'SG OTT', c: totals.ott  >= 0 ? 'var(--green)' : 'var(--red)'},
      {v:fmt(totals.app),  l:'SG APP', c: totals.app  >= 0 ? 'var(--green)' : 'var(--red)'},
      {v:fmt(totals.atg),  l:'SG ATG', c: totals.atg  >= 0 ? 'var(--green)' : 'var(--red)'},
      {v:fmt(totals.putt), l:'SG PUTT',c: totals.putt >= 0 ? 'var(--green)' : 'var(--red)'},
    ], 4) +

    `<div style="font-size:10px;color:var(--muted);line-height:1.5;margin-top:4px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;">
      Baseline is an approximate reference curve for your handicap level, not official Tour data.
    </div>
    <div style="height:12px;"></div>`;
}
```

- [ ] **Step 4: `pages/home.html` — replace the mock SG widget entries with a real fetch**

Find:
```js
  'sg-total':   { name:'SG: Total',         label:'SG TOTAL',    value:'+1.1',  vc:'g', trend:'▲ 0.2',  tc:'g', sub:null           },
  'sg-ott':     { name:'SG: Off the Tee',   label:'SG OTT',      value:'+0.4',  vc:'g', trend:'▲ 0.1',  tc:'g', sub:null           },
  'sg-app':     { name:'SG: Approach',      label:'SG APP',      value:'+0.6',  vc:'g', trend:'▲ 0.2',  tc:'g', sub:null           },
  'sg-atg':     { name:'SG: Around Green',  label:'SG ATG',      value:'−0.2',  vc:'r', trend:'▼ 0.1',  tc:'r', sub:null           },
  'sg-putt':    { name:'SG: Putting',       label:'SG PUTT',     value:'+0.3',  vc:'g', trend:'▲ 0.1',  tc:'g', sub:null           },
```

Replace with:
```js
  'sg-total':   { name:'SG: Total',         label:'SG TOTAL',    value:'—',  vc:'g', trend:null,  tc:'g', sub:null           },
  'sg-ott':     { name:'SG: Off the Tee',   label:'SG OTT',      value:'—',  vc:'g', trend:null,  tc:'g', sub:null           },
  'sg-app':     { name:'SG: Approach',      label:'SG APP',      value:'—',  vc:'g', trend:null,  tc:'g', sub:null           },
  'sg-atg':     { name:'SG: Around Green',  label:'SG ATG',      value:'—',  vc:'g', trend:null,  tc:'g', sub:null           },
  'sg-putt':    { name:'SG: Putting',       label:'SG PUTT',     value:'—',  vc:'g', trend:null,  tc:'g', sub:null           },
```

Find (this file already fetches `handicap_index` in a similar async block from the WHS sub-project — locate that block by its `renderWidgets()` re-call at the end):
```js
(async () => {
  const session = await TcAuth.getSession();
  if (!session) return;
  const { data } = await TcAuth.client.from('profiles').select('handicap_index').eq('id', session.user.id).single();
  if (data?.handicap_index != null) {
    STATS['handicap'].value = (data.handicap_index >= 0 ? '+' : '') + data.handicap_index;
    renderWidgets();
  }
})();
```

Replace with:
```js
(async () => {
  const session = await TcAuth.getSession();
  if (!session) return;
  const { data } = await TcAuth.client.from('profiles').select('handicap_index').eq('id', session.user.id).single();
  if (data?.handicap_index != null) {
    STATS['handicap'].value = (data.handicap_index >= 0 ? '+' : '') + data.handicap_index;
    renderWidgets();
  }

  const { data: rounds } = await TcAuth.client
    .from('rounds')
    .select('sg_ott, sg_app, sg_atg, sg_putt, sg_total')
    .eq('user_id', session.user.id)
    .eq('status', 'complete')
    .not('sg_total', 'is', null)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(20);
  if (rounds && rounds.length > 0) {
    const avg = key => (rounds.reduce((a, r) => a + (r[key] || 0), 0) / rounds.length);
    const fmt = v => (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toFixed(1);
    STATS['sg-total'].value = fmt(avg('sg_total'));
    STATS['sg-ott'].value   = fmt(avg('sg_ott'));
    STATS['sg-app'].value   = fmt(avg('sg_app'));
    STATS['sg-atg'].value   = fmt(avg('sg_atg'));
    STATS['sg-putt'].value  = fmt(avg('sg_putt'));
    renderWidgets();
  }
})();
```

- [ ] **Step 5: Verify syntax on all files touched this task**

```bash
node -e "
const fs = require('fs');
const files = ['tc-rounds.js', 'courses.html', 'stats.html', 'home.html'];
let allOk = true;
for (const f of files) {
  const content = fs.readFileSync('pages/' + f, 'utf8');
  if (f.endsWith('.js')) {
    try { new Function(content); console.log(f, 'OK'); } catch (e) { allOk = false; console.log(f, 'ERROR:', e.message); }
  } else {
    const scripts = [...content.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    scripts.forEach((s, i) => { try { new Function(s); console.log(f, 'block', i, 'OK'); } catch (e) { allOk = false; console.log(f, 'block', i, 'ERROR:', e.message); } });
  }
}
console.log(allOk ? 'ALL OK' : 'FAILURES FOUND');
"
```
Expected: `ALL OK`.

- [ ] **Step 6: Manual browser verification**

With `pages/` served locally and signed in as an account with at least one completed round including a lie-tagged shot chain (from Task 3's testing):

1. Complete a round at a well-mapped course, with a real handicap index already established (3+ prior rounds) → confirm `round_holes.tee_lat/tee_lng/green_lat/green_lng`, `shots.lie`/`sg_value`, and `rounds.sg_*` all populate in the Supabase Table Editor.
2. Open `courses.html` for that round → confirm the SG tab shows real numbers with the "vs. estimated baseline" label, not the placeholder.
3. Open `stats.html`'s Strokes Gained card → confirm it shows a real rolling average across your recent rounds, not the old `+1.1`/`+0.6`/etc. mock.
4. Open `home.html` → confirm the SG widget shows the same real rolling values.
5. Sign in as (or simulate) an account with fewer than 3 valid rounds → confirm every SG surface shows an honest placeholder, never a number computed against a guessed baseline tier.

- [ ] **Step 7: Commit**

```bash
git add pages/tc-rounds.js pages/courses.html pages/stats.html pages/home.html
git commit -m "feat: display real Strokes Gained across courses/stats/home"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Tee and green positions persisted per hole | Task 1 (schema), Task 3 (capture + payload) |
| GPS-inferred lie (tee/fairway/rough/green), manual override for bunker/water/recovery | Task 3 |
| Baseline tables, 4 handicap tiers, approximate/labeled-as-such | Task 2, Task 5 (UI copy) |
| SG computed at round completion, not per-hole | Task 4 |
| All-or-nothing per hole (one broken shot invalidates the hole) | Task 4 Step 2 (`chainBroken` logic) |
| Skip SG when no handicap index yet | Task 4 Step 2 (`if (!tier) return null`) |
| SG computation must never block round completion | Task 4 Step 3 (try/catch around `computeRoundStrokesGained`, `sgResult` defaults to `null` on any failure) |
| Real SG on all 3 display surfaces | Task 5 |

**Placeholder scan:** no TBD/TODO; every step has literal code or an exact verification procedure. (An earlier draft of this plan discovered a real gap — no persisted tee position — mid-writing; rather than leave that unresolved reasoning in the plan, Task 1 and Task 3 were revised to capture tee position alongside green position, and Task 4 was written using the corrected schema. No trace of the abandoned approach remains in this final version.)

**Type consistency:** `TcStrokesGained`'s five function signatures are used identically in Task 4 (`tc-rounds.js`) as defined in Task 2. `payload.teeLat`/`.teeLng`/`.greenLat`/`.greenLng` (Task 3) map to `round_holes.tee_lat`/`tee_lng`/`green_lat`/`green_lng` (Task 1's migration, Task 4's write) with consistent naming. `shots.lie` (already-existing column) is written in Task 4 Step 1 from the `s.lie` field Task 3 adds to `buildShotsPayload()`'s output. `rounds.sg_ott`/`sg_app`/`sg_atg`/`sg_putt`/`sg_total` (Task 1's migration) are written in Task 4 Step 3 and read in Task 5 Step 1 with matching column names throughout.
