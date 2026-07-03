# WHS Handicap Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute and store a real WHS-style Handicap Index (with 9-hole round combining) from played rounds, replacing every hardcoded mock handicap display in the app with the real value.

**Architecture:** A new shared `pages/tc-handicap.js` module (same IIFE pattern as `tc-auth.js`/`tc-course.js`/`tc-rounds.js`) owns a localStorage-cached Course Rating/Slope entry (same mechanism as the existing manual tee/green marking feature) and all the pure WHS math (Net Double Bogey ESC, Score Differential, 9-hole pairing, rolling index averaging). `pages/rounds.html` collects rating/slope during round setup; `pages/tc-rounds.js`'s existing `completeRound()` (from the rounds/shots persistence sub-project) is extended to compute and write the differential and recompute the rolling index at round completion; `pages/hole.html` passes the resolved rating/slope through; `pages/profile.html`, `pages/home.html`, `pages/courses.html`, and `pages/stats.html` are wired to read the real stored value instead of their current hardcoded mocks.

**Tech Stack:** Vanilla JS, Supabase Postgres (existing `rounds.differential`/`adjusted_score`/`profiles.handicap_index` columns — already present, unpopulated). No build step, no ES modules.

## Global Constraints

- No build step — plain `<script src="...">` tags only; no ES modules, no bundler.
- No new Supabase schema. `rounds.differential` (numeric), `rounds.adjusted_score` (integer), and `profiles.handicap_index` (numeric) already exist and are already writable under existing RLS (flat `auth.uid() = user_id` on both tables).
- Course Rating/Slope Rating are **localStorage-only**, never sent to Supabase — cached by `(geoKey, teeName, which9)`, `which9` is `'18'`, `'front9'`, or `'back9'`. This mirrors the existing manual tee/green marking cache pattern in `pages/tc-course.js` (`getCache`/`setCache`/`geoKeyFor`) but uses its own separate localStorage key namespace (`tc_handicap_...`), not `tc-course.js`'s `tc_course_` keys, and has no TTL (a tee's rating/slope doesn't expire).
- **Explicitly out of scope** (confirmed with the user): the exceptional-score-reduction safeguard, the maximum-increase-per-update cap, and PCC (Playing Conditions Calculation, always treated as 0).
- **9-hole combining IS in scope** (explicit user request, going beyond the initially-recommended "core formula only" cut): a 9-hole round's own differential is computed immediately using that specific 9's own rating/slope; pairing two 9-hole differentials into one 18-hole-equivalent value happens only when recomputing the rolling index, using the golfer's full differential history — never stored as separate "pending" state.
- A 9-hole round that doesn't start on hole 1 or hole 10 (this app's round setup allows arbitrary starting holes) is not a standard, ratable 9 — no rating/slope is collected for it and it never gets a differential.
- Simplified Net Double Bogey ESC: extra stroke allowance per hole is `1` if the golfer's current Course Handicap is at or above that hole's stroke index (`round_holes.handicap`), else `0` — no compound (`+2`) allowance for Course Handicap over 18, and unknown stroke index defaults to `0` extra strokes. This is a documented simplification consistent with "core formula, no exotic edge cases," not a hidden shortcut.
- Fewer than 3 usable differentials (after 9-hole pairing) means `profiles.handicap_index` stays `null` — every display surface must show the same "not enough rounds yet" placeholder treatment already established for `sg`/`diff` in `courses.html` (a literal `—`, never a fabricated number).
- The official WHS count-based averaging table (exact lookup used by every task that computes an index):

  | # of differentials | # used (lowest) |
  |---|---|
  | 0–2 | none — no index yet |
  | 3–5 | 1 |
  | 6–8 | 2 |
  | 9–11 | 3 |
  | 12–14 | 4 |
  | 15–16 | 5 |
  | 17–18 | 6 |
  | 19 | 7 |
  | 20 | 8 |

  The average of the used lowest values is multiplied by `0.96` and rounded to one decimal place.

---

### Task 1: `pages/tc-handicap.js` — rating/slope cache + WHS math

**Files:**
- Create: `pages/tc-handicap.js`

**Interfaces:**
- Produces: `window.TcHandicap` object with:
  - `TcHandicap.getRatingSlope(geoKey, teeName, which9)` → `{rating, slope} | null`
  - `TcHandicap.saveRatingSlope(geoKey, teeName, which9, {rating, slope})` → `void`
  - `TcHandicap.courseHandicap(handicapIndex, slope, rating, coursePar)` → `number` (rounded integer; `handicapIndex == null` is treated as `0`)
  - `TcHandicap.adjustedGrossScore(roundHoles, handicapIndex, slope, rating, coursePar)` → `number` — `roundHoles` is an array of `{par, gross_score, handicap}` (matches `round_holes` row shape)
  - `TcHandicap.scoreDifferential(adjustedGross, rating, slope)` → `number` (one decimal place)
  - `TcHandicap.pairNineHoleDifferentials(rows)` → array of `{value, at, roundIds}`, most-recent-first — `rows` is an array of `{id, hole_count, differential, completed_at}` (matches `rounds` row shape); 18-hole rows pass through as single-`roundIds` entries, 9-hole rows are paired oldest-first into combined entries, any odd trailing 9-hole row is dropped (pending)
  - `TcHandicap.computeHandicapIndex(entries)` → `{index: number|null, usedRoundIds: Set<string>}` — `entries` is the output of `pairNineHoleDifferentials`, already most-recent-first

- [ ] **Step 1: Create `pages/tc-handicap.js`**

```js
/* tc-handicap.js — Course Rating/Slope cache (localStorage, mirrors the
   manual tee/green marking pattern in tc-course.js but its own namespace)
   plus the WHS handicap math: Net Double Bogey ESC, Score Differential,
   9-hole pairing, and rolling index averaging. No Supabase dependency —
   pure functions plus localStorage only. */
window.TcHandicap = (() => {
  const LOWEST_COUNT_TABLE = [
    null, null, null, // 0, 1, 2 differentials — no index yet
    1, 1, 1,          // 3, 4, 5
    2, 2, 2,          // 6, 7, 8
    3, 3, 3,          // 9, 10, 11
    4, 4, 4,          // 12, 13, 14
    5, 5,             // 15, 16
    6, 6,             // 17, 18
    7,                // 19
    8                 // 20
  ];

  function cacheKey(geoKey, teeName, which9) {
    return `tc_handicap_${geoKey}_${teeName}_${which9}`;
  }

  function getRatingSlope(geoKey, teeName, which9) {
    try {
      const raw = localStorage.getItem(cacheKey(geoKey, teeName, which9));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveRatingSlope(geoKey, teeName, which9, { rating, slope }) {
    try { localStorage.setItem(cacheKey(geoKey, teeName, which9), JSON.stringify({ rating, slope })); } catch {}
  }

  function courseHandicap(handicapIndex, slope, rating, coursePar) {
    const idx = handicapIndex ?? 0;
    return Math.round(idx * (slope / 113) + (rating - coursePar));
  }

  function adjustedGrossScore(roundHoles, handicapIndex, slope, rating, coursePar) {
    const ch = courseHandicap(handicapIndex, slope, rating, coursePar);
    return roundHoles.reduce((total, h) => {
      const extra = (h.handicap != null && ch >= h.handicap) ? 1 : 0;
      const cap = h.par + 2 + extra;
      return total + Math.min(h.gross_score, cap);
    }, 0);
  }

  function scoreDifferential(adjustedGross, rating, slope) {
    return Math.round((113 / slope) * (adjustedGross - rating) * 10) / 10;
  }

  function pairNineHoleDifferentials(rows) {
    const eighteens = rows
      .filter(r => r.hole_count === 18 && r.differential != null)
      .map(r => ({ value: r.differential, at: r.completed_at, roundIds: [r.id] }));

    const nines = rows
      .filter(r => r.hole_count === 9 && r.differential != null)
      .sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at));

    const paired = [];
    for (let i = 0; i + 1 < nines.length; i += 2) {
      paired.push({
        value: nines[i].differential + nines[i + 1].differential,
        at: nines[i + 1].completed_at,
        roundIds: [nines[i].id, nines[i + 1].id]
      });
    }

    return [...eighteens, ...paired].sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function computeHandicapIndex(entries) {
    const recent = entries.slice(0, 20);
    const n = recent.length;
    const lowestCount = LOWEST_COUNT_TABLE[n] ?? null;
    if (!lowestCount) return { index: null, usedRoundIds: new Set() };

    const sorted = [...recent].sort((a, b) => a.value - b.value);
    const lowest = sorted.slice(0, lowestCount);
    const avg = lowest.reduce((a, b) => a + b.value, 0) / lowest.length;
    const index = Math.round(avg * 0.96 * 10) / 10;
    const usedRoundIds = new Set(lowest.flatMap(e => e.roundIds));
    return { index, usedRoundIds };
  }

  return {
    getRatingSlope, saveRatingSlope,
    courseHandicap, adjustedGrossScore, scoreDifferential,
    pairNineHoleDifferentials, computeHandicapIndex
  };
})();
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "
const fs = require('fs');
try { new Function(fs.readFileSync('pages/tc-handicap.js', 'utf8')); console.log('OK'); }
catch (e) { console.log('SYNTAX ERROR:', e.message); }
"
```
Expected: `OK`.

- [ ] **Step 3: Verify the math against hand-computed examples**

```bash
node -e "
const fs = require('fs');
global.window = {};
new Function(fs.readFileSync('pages/tc-handicap.js', 'utf8'))();
const H = window.TcHandicap;

// Course Handicap: index 10.4, slope 133, rating 71.8, par 72
// = round(10.4 * (133/113) + (71.8-72)) = round(12.05) = 12
console.log('courseHandicap:', H.courseHandicap(10.4, 133, 71.8, 72), '(expect 12)');

// Adjusted gross score: 3 holes, par 4/4/5, gross 6/9/8, stroke index 5/2/10
// Course handicap 12 (from above): hole with SI 5 -> +1 (12>=5), SI 2 -> +1 (12>=2), SI 10 -> +1 (12>=10)
// Caps: 4+2+1=7, 4+2+1=7, 5+2+1=8 -> min(6,7)=6, min(9,7)=7, min(8,8)=8 -> total 21
console.log('adjustedGrossScore:', H.adjustedGrossScore(
  [{par:4,gross_score:6,handicap:5},{par:4,gross_score:9,handicap:2},{par:5,gross_score:8,handicap:10}],
  10.4, 133, 71.8, 72
), '(expect 21)');

// Score differential: adjusted gross 87, rating 71.8, slope 133
// = round((113/133)*(87-71.8)*10)/10 = round(129.16..)/10 -> (113/133)=0.8496; 0.8496*15.2=12.914 -> 12.9
console.log('scoreDifferential:', H.scoreDifferential(87, 71.8, 133), '(expect 12.9)');

// Pairing: two 9-hole rounds (ids a,b), oldest a then b -> one paired entry summing values
const paired = H.pairNineHoleDifferentials([
  { id:'a', hole_count:9, differential:5.0, completed_at:'2026-01-01T00:00:00Z' },
  { id:'b', hole_count:9, differential:6.0, completed_at:'2026-01-02T00:00:00Z' },
]);
console.log('pairNineHoleDifferentials:', JSON.stringify(paired), '(expect one entry, value 11, roundIds [a,b])');

// Index: 3 differentials -> lowest 1 used, *0.96, round to 0.1
const idx = H.computeHandicapIndex([
  { value: 10.0, at:'2026-01-03', roundIds:['x'] },
  { value: 8.0,  at:'2026-01-02', roundIds:['y'] },
  { value: 12.0, at:'2026-01-01', roundIds:['z'] },
]);
console.log('computeHandicapIndex:', JSON.stringify({index:idx.index, used:[...idx.usedRoundIds]}), '(expect index 7.7, used [y])');
"
```
Expected output (each line):
```
courseHandicap: 12 (expect 12)
adjustedGrossScore: 21 (expect 21)
scoreDifferential: 12.9 (expect 12.9)
pairNineHoleDifferentials: [{"value":11,"at":"2026-01-02T00:00:00Z","roundIds":["a","b"]}] (expect one entry, value 11, roundIds [a,b])
computeHandicapIndex: {"index":7.7,"used":["y"]} (expect index 7.7, used [y])
```

- [ ] **Step 4: Commit**

```bash
git add pages/tc-handicap.js
git commit -m "feat: add tc-handicap.js — rating/slope cache + WHS differential/index math"
```

---

### Task 2: `pages/rounds.html` — collect Course Rating/Slope, real Course Handicap preview

**Files:**
- Modify: `pages/rounds.html`

**Interfaces:**
- Consumes: `TcHandicap.getRatingSlope`/`saveRatingSlope` from Task 1; `TcCourse.geoKeyFor` (already exists); `TcAuth.client`/`TcAuth.getSession()` (already exists).
- Produces: `sel.ratingSlope` (`{rating, slope} | null`) and `sel.which9` (`'18' | 'front9' | 'back9' | null`), read by Task 4 (`hole.html`) via `roundData`.

- [ ] **Step 1: Add `ratingSlope`/`which9` to the `sel` state object**

Find:
```js
const sel = {
  course:      null,   // { name, location }
  gameType:    null,   // 'my-score' | 'match-net' | 'match-gross' | 'group'
  scoreMode:   null,   // 'simple' | 'stats'
  holes:       null,   // 18 | 9 | 'custom'
  customHoles: 12,
  tee:         null,   // tee object
  startHole:   1,
  scoreType:   null,   // 'home' | 'away' | 'competition'
  date:        today(),
  courseTab:   'search',
};
```

Replace with:
```js
const sel = {
  course:      null,   // { name, location }
  gameType:    null,   // 'my-score' | 'match-net' | 'match-gross' | 'group'
  scoreMode:   null,   // 'simple' | 'stats'
  holes:       null,   // 18 | 9 | 'custom'
  customHoles: 12,
  tee:         null,   // tee object
  startHole:   1,
  scoreType:   null,   // 'home' | 'away' | 'competition'
  date:        today(),
  courseTab:   'search',
  ratingSlope: null,   // { rating, slope } | null — resolved Course Rating/Slope for handicap purposes
  which9:      null,   // '18' | 'front9' | 'back9' | null (null = not ratable, e.g. non-standard 9-hole start)
};
```

- [ ] **Step 2: Fetch the golfer's current handicap index at page load**

Find:
```js
(async () => { await TcAuth.requireAuth(); })();
```

Replace with:
```js
let currentHandicapIndex = null;
(async () => {
  await TcAuth.requireAuth();
  const session = await TcAuth.getSession();
  if (session) {
    const { data } = await TcAuth.client.from('profiles').select('handicap_index').eq('id', session.user.id).single();
    currentHandicapIndex = data?.handicap_index ?? null;
  }
})();
```

- [ ] **Step 3: Add `tc-handicap.js` script tag**

Find:
```html
<script src="tc-auth.js"></script>
<script src="tc-rounds.js"></script>
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
```

Replace with:
```html
<script src="tc-auth.js"></script>
<script src="tc-rounds.js"></script>
<script src="tc-handicap.js"></script>
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
```

(If the existing tag order differs from this, insert `<script src="tc-handicap.js"></script>` directly after the existing `tc-rounds.js` tag instead, keeping everything else unchanged.)

- [ ] **Step 4: Add a `which9` resolver and the rating/slope prompt UI**

Find:
```js
/* ── STEP: ROUND DETAILS (tee, starting hole, score type, date, handicap — all one page) ── */
function renderRoundDetails(body) {
  sel.startHole = sel.startHole || 1;

  function reCalcHandicap() {
    const hcEl   = document.getElementById('rd-hdcp-val');
    const hcRow  = document.getElementById('rd-hdcp-row');
    const hcDesc = document.getElementById('rd-hdcp-desc');
    if (!hcEl || !sel.tee) return;
    const t   = sel.tee;
    const raw = 1.8 * (t.slope / 113) + (t.rating - 72);
    const hcp = Math.round(raw);
    const str = (hcp >= 0 ? '+' : '') + hcp;
    hcEl.textContent  = str;
    if (hcDesc) hcDesc.textContent = `Index +1.8 · ${t.name} tees · Rating ${t.rating} · Slope ${t.slope}`;
    if (hcRow)  hcRow.innerHTML = `
      <div class="hdcp-chip"><div class="hc-val" style="color:var(--green)">+1.8</div><div class="hc-lbl">HCP INDEX</div></div>
      <div class="hdcp-chip"><div class="hc-val">${t.slope}</div><div class="hc-lbl">SLOPE</div></div>
      <div class="hdcp-chip"><div class="hc-val">${t.rating}</div><div class="hc-lbl">RATING</div></div>
      <div class="hdcp-chip"><div class="hc-val" style="color:var(--green)">${str}</div><div class="hc-lbl">PLAYING HCP</div></div>`;
  }
```

Replace with:
```js
/* ── STEP: ROUND DETAILS (tee, starting hole, score type, date, handicap — all one page) ── */
function renderRoundDetails(body) {
  sel.startHole = sel.startHole || 1;

  // Note: this preview always assumes par 72 for the "Course Handicap" estimate shown
  // during setup — real per-hole par isn't known until course data loads at round start.
  // The actual differential/index math (Task 3) uses real round_holes.par, not this preview.
  function reCalcHandicap() {
    const hcEl   = document.getElementById('rd-hdcp-val');
    const hcRow  = document.getElementById('rd-hdcp-row');
    const hcDesc = document.getElementById('rd-hdcp-desc');
    if (!hcEl || !sel.tee) return;
    if (!sel.ratingSlope) {
      hcEl.textContent = '—';
      if (hcDesc) hcDesc.textContent = 'Enter Course Rating & Slope above to calculate';
      if (hcRow)  hcRow.innerHTML = '';
      return;
    }
    const { rating, slope } = sel.ratingSlope;
    const idxLabel = currentHandicapIndex == null ? '—' : ((currentHandicapIndex >= 0 ? '+' : '') + currentHandicapIndex);
    const idx = currentHandicapIndex ?? 0;
    const raw = idx * (slope / 113) + (rating - 72);
    const hcp = Math.round(raw);
    const str = (hcp >= 0 ? '+' : '') + hcp;
    hcEl.textContent  = str;
    if (hcDesc) hcDesc.textContent = `Index ${idxLabel} · ${sel.tee.name} tees · Rating ${rating} · Slope ${slope}`;
    if (hcRow)  hcRow.innerHTML = `
      <div class="hdcp-chip"><div class="hc-val" style="color:var(--green)">${idxLabel}</div><div class="hc-lbl">HCP INDEX</div></div>
      <div class="hdcp-chip"><div class="hc-val">${slope}</div><div class="hc-lbl">SLOPE</div></div>
      <div class="hdcp-chip"><div class="hc-val">${rating}</div><div class="hc-lbl">RATING</div></div>
      <div class="hdcp-chip"><div class="hc-val" style="color:var(--green)">${str}</div><div class="hc-lbl">PLAYING HCP</div></div>`;
  }

  function determineWhich9() {
    if (sel.holes === 18) return '18';
    if (sel.holes === 9) {
      if (sel.startHole === 1)  return 'front9';
      if (sel.startHole === 10) return 'back9';
    }
    return null; // custom hole counts, or a 9-hole round not starting on 1 or 10 — not ratable
  }

  function updateRatingSlopePrompt() {
    const wrap = document.getElementById('rd-rating-wrap');
    if (!wrap) return;
    if (!sel.tee) { wrap.innerHTML = ''; sel.ratingSlope = null; sel.which9 = null; return; }
    if (!sel.course?.lat || !sel.course?.lng) {
      wrap.innerHTML = '<div class="rd-sec-sub" style="color:var(--muted);">No location data for this course — handicap tracking unavailable for this round.</div>';
      sel.ratingSlope = null; sel.which9 = null;
      return;
    }

    const which9 = determineWhich9();
    sel.which9 = which9;
    if (!which9) {
      wrap.innerHTML = '<div class="rd-sec-sub" style="color:var(--muted);">This hole selection isn\'t a standard 9 or 18 — this round won\'t count toward your handicap.</div>';
      sel.ratingSlope = null;
      return;
    }

    const geoKey = TcCourse.geoKeyFor(sel.course.lat, sel.course.lng);
    const cached = TcHandicap.getRatingSlope(geoKey, sel.tee.name, which9);
    if (cached) {
      sel.ratingSlope = cached;
      wrap.innerHTML = `<div class="rd-sec-sub">Rating ${cached.rating} · Slope ${cached.slope} <span onclick="showRatingSlopeForm()" style="color:var(--green);cursor:pointer;">Edit</span></div>`;
      reCalcHandicap();
      return;
    }

    sel.ratingSlope = null;
    showRatingSlopeForm();
  }

  window.showRatingSlopeForm = function showRatingSlopeForm() {
    const wrap = document.getElementById('rd-rating-wrap');
    if (!wrap) return;
    const label = sel.which9 === '18' ? '18-hole' : sel.which9 === 'front9' ? 'Front 9' : 'Back 9';
    wrap.innerHTML = `
      <div class="rd-sec-sub">Enter the ${label} Course Rating &amp; Slope for these tees (needed for your handicap):</div>
      <div style="display:flex;gap:8px;margin-top:6px;">
        <input class="date-inp" type="number" step="0.1" min="60" max="80" placeholder="Rating (e.g. 71.8)" id="rd-rating-inp" style="flex:1;">
        <input class="date-inp" type="number" step="1" min="55" max="155" placeholder="Slope (e.g. 133)" id="rd-slope-inp" style="flex:1;">
      </div>
      <div id="rd-rating-err" style="color:#E74C3C;font-size:10px;margin-top:4px;"></div>
      <button class="setup-next-btn" style="margin-top:8px;padding:8px;font-size:12px;" onclick="saveRatingSlopeEntry()">Save</button>`;
  };

  window.saveRatingSlopeEntry = function saveRatingSlopeEntry() {
    const ratingEl = document.getElementById('rd-rating-inp');
    const slopeEl  = document.getElementById('rd-slope-inp');
    const errEl    = document.getElementById('rd-rating-err');
    const rating = parseFloat(ratingEl.value);
    const slope  = parseInt(slopeEl.value, 10);
    if (!(rating >= 60 && rating <= 80) || !(slope >= 55 && slope <= 155)) {
      if (errEl) errEl.textContent = 'Enter a valid Rating (60–80) and Slope (55–155).';
      return;
    }
    const geoKey = TcCourse.geoKeyFor(sel.course.lat, sel.course.lng);
    TcHandicap.saveRatingSlope(geoKey, sel.tee.name, sel.which9, { rating, slope });
    sel.ratingSlope = { rating, slope };
    const wrap = document.getElementById('rd-rating-wrap');
    wrap.innerHTML = `<div class="rd-sec-sub">Rating ${rating} · Slope ${slope} <span onclick="showRatingSlopeForm()" style="color:var(--green);cursor:pointer;">Edit</span></div>`;
    reCalcHandicap();
    document.getElementById('setup-next-btn').disabled = !canAdvance();
  };
```

- [ ] **Step 5: Render the rating/slope wrap div, and call the prompt updater from the tee and hole-chip handlers**

Find:
```js
    <div class="rd-sec" style="margin-top:18px;">Starting Hole</div>
    <div class="hole-chips" id="hole-chips"></div>
```

Replace with:
```js
    <div class="rd-sec" style="margin-top:18px;">Starting Hole</div>
    <div class="hole-chips" id="hole-chips"></div>

    <div class="rd-sec" style="margin-top:18px;">Course Rating / Slope</div>
    <div id="rd-rating-wrap"></div>
```

Find:
```js
    d.onclick = () => {
      sel.tee = t;
      teeList.querySelectorAll('.radio-opt').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
      reCalcHandicap();
      document.getElementById('setup-next-btn').disabled = !canAdvance();
    };
    teeList.appendChild(d);
  });
```

Replace with:
```js
    d.onclick = () => {
      sel.tee = t;
      teeList.querySelectorAll('.radio-opt').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
      updateRatingSlopePrompt();
      document.getElementById('setup-next-btn').disabled = !canAdvance();
    };
    teeList.appendChild(d);
  });
```

Find:
```js
    c.onclick = () => {
      sel.startHole = h;
      chipsEl.querySelectorAll('.hole-chip').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
    };
    chipsEl.appendChild(c);
  }
```

Replace with:
```js
    c.onclick = () => {
      sel.startHole = h;
      chipsEl.querySelectorAll('.hole-chip').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
      updateRatingSlopePrompt();
      document.getElementById('setup-next-btn').disabled = !canAdvance();
    };
    chipsEl.appendChild(c);
  }
```

Find:
```js
  if (sel.tee) reCalcHandicap();
}
```

Replace with:
```js
  if (sel.tee) updateRatingSlopePrompt();
}
```

- [ ] **Step 6: Require the rating/slope prompt to be resolved before advancing**

Find:
```js
  if (s === 'round-details') return !!sel.tee && !!sel.scoreType;
```

Replace with:
```js
  if (s === 'round-details') return !!sel.tee && !!sel.scoreType && (sel.which9 === null || !!sel.ratingSlope);
```

- [ ] **Step 7: Pass the resolved rating/slope through to the active round**

Find:
```js
  roundData.roundId = await TcRounds.createRound({
    courseName: sel.course?.name || 'Unknown Course',
    teeName: roundData.tee,
    teeYardage: roundData.teeYardage,
    holeCount: holesCount
  });

  sessionStorage.setItem('tc_active_round', JSON.stringify(roundData));
```

Replace with:
```js
  roundData.roundId = await TcRounds.createRound({
    courseName: sel.course?.name || 'Unknown Course',
    teeName: roundData.tee,
    teeYardage: roundData.teeYardage,
    holeCount: holesCount
  });
  roundData.ratingSlope = sel.ratingSlope;
  roundData.which9 = sel.which9;

  sessionStorage.setItem('tc_active_round', JSON.stringify(roundData));
```

- [ ] **Step 8: Verify syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('pages/rounds.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```
Expected: every block reports `OK`.

- [ ] **Step 9: Commit**

```bash
git add pages/rounds.html
git commit -m "feat: rounds.html — collect Course Rating/Slope, real Course Handicap preview"
```

---

### Task 3: `pages/tc-rounds.js` — compute differential and rolling index at round completion

**Files:**
- Modify: `pages/tc-rounds.js`

**Interfaces:**
- Consumes: `TcHandicap.adjustedGrossScore`, `TcHandicap.scoreDifferential`, `TcHandicap.pairNineHoleDifferentials`, `TcHandicap.computeHandicapIndex` from Task 1.
- Changes `TcRounds.completeRound()`'s signature: now `TcRounds.completeRound({ courseRating, slopeRating })` (both may be `null`, meaning "no differential for this round" — see Task 4). Existing callers passing no arguments still work (`courseRating`/`slopeRating` both `undefined`, treated as `null`).
- This file is loaded on pages that don't load `tc-handicap.js` today (only `hole.html`/`rounds.html` will, per Tasks 2 and 4) — but `tc-rounds.js` itself must not assume `TcHandicap` exists in every context where it's loaded (e.g. `courses.html` loads `tc-rounds.js` for `fetchUserRounds()` but has no reason to load `tc-handicap.js`). Guard every `TcHandicap` reference so `tc-rounds.js` still works on pages without it loaded.

- [ ] **Step 1: Extend `completeRound()` to carry the rating/slope through the retry queue**

Find:
```js
  async function completeRound() {
    const queue = readQueue();
    queue.push({ type: 'complete', payload: {} });
    writeQueue(queue);
    return drainPendingSyncs();
  }
```

Replace with:
```js
  async function completeRound({ courseRating, slopeRating } = {}) {
    const queue = readQueue();
    queue.push({ type: 'complete', payload: { courseRating: courseRating ?? null, slopeRating: slopeRating ?? null } });
    writeQueue(queue);
    return drainPendingSyncs();
  }
```

- [ ] **Step 2: Compute the differential and recompute the rolling index inside `writeRoundComplete`**

Find:
```js
  async function writeRoundComplete(roundId) {
    const session = await TcAuth.getSession();
    if (!session) return false;
    const { error } = await TcAuth.client
      .from('rounds')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', roundId)
      .eq('user_id', session.user.id);
    if (error) { console.error('TcRounds: failed to complete round', error); return false; }
    return true;
  }
```

Replace with:
```js
  async function computeRoundDifferential(session, roundId, courseRating, slopeRating) {
    if (!window.TcHandicap || courseRating == null || slopeRating == null) return null;

    const { data: holes, error } = await TcAuth.client
      .from('round_holes')
      .select('par, gross_score, handicap')
      .eq('round_id', roundId);
    if (error || !holes || holes.length === 0) return null;

    const { data: profile } = await TcAuth.client
      .from('profiles')
      .select('handicap_index')
      .eq('id', session.user.id)
      .single();
    const currentIndex = profile?.handicap_index ?? null;
    const coursePar = holes.reduce((a, h) => a + (h.par ?? 4), 0);

    const adjustedGross = window.TcHandicap.adjustedGrossScore(holes, currentIndex, slopeRating, courseRating, coursePar);
    const differential = window.TcHandicap.scoreDifferential(adjustedGross, courseRating, slopeRating);
    return { adjustedGross, differential };
  }

  async function recomputeHandicapIndex(session) {
    if (!window.TcHandicap) return;
    const { data: rounds, error } = await TcAuth.client
      .from('rounds')
      .select('id, hole_count, differential, completed_at')
      .eq('user_id', session.user.id)
      .eq('status', 'complete')
      .not('differential', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(50); // generously more than the 20 needed post-pairing
    if (error || !rounds) return;

    const entries = window.TcHandicap.pairNineHoleDifferentials(rounds);
    const { index } = window.TcHandicap.computeHandicapIndex(entries);

    await TcAuth.client
      .from('profiles')
      .update({ handicap_index: index })
      .eq('id', session.user.id);
  }

  async function writeRoundComplete(roundId, payload) {
    const session = await TcAuth.getSession();
    if (!session) return false;

    const diffResult = await computeRoundDifferential(session, roundId, payload?.courseRating, payload?.slopeRating);

    const update = { status: 'complete', completed_at: new Date().toISOString() };
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

    if (diffResult) await recomputeHandicapIndex(session);
    return true;
  }
```

- [ ] **Step 3: Pass the queued payload into `writeRoundComplete`**

Find:
```js
        if (entry.type === 'hole') ok = await writeHoleResult(roundId, entry.payload);
        else if (entry.type === 'complete') ok = await writeRoundComplete(roundId);
```

Replace with:
```js
        if (entry.type === 'hole') ok = await writeHoleResult(roundId, entry.payload);
        else if (entry.type === 'complete') ok = await writeRoundComplete(roundId, entry.payload);
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
git commit -m "feat: tc-rounds.js — compute WHS differential and recompute handicap index at round completion"
```

---

### Task 4: `pages/hole.html` — pass the resolved rating/slope to `completeRound()`

**Files:**
- Modify: `pages/hole.html`

**Interfaces:**
- Consumes: `TcRounds.completeRound({ courseRating, slopeRating })` from Task 3.
- Consumes existing state: `_round` (parsed `tc_active_round`, now carrying `ratingSlope`/`which9` from Task 2's `rounds.html` changes).

- [ ] **Step 1: Pass the round's resolved rating/slope into the completion call**

Find:
```js
  if (_isLastHole || !_round) {
    TcRounds.completeRound().catch(err => console.error('TcRounds: completeRound failed unexpectedly', err));
    window.location.href = 'scorecard.html';
    return;
  }
```

Replace with:
```js
  if (_isLastHole || !_round) {
    TcRounds.completeRound({
      courseRating: _round?.ratingSlope?.rating ?? null,
      slopeRating: _round?.ratingSlope?.slope ?? null
    }).catch(err => console.error('TcRounds: completeRound failed unexpectedly', err));
    window.location.href = 'scorecard.html';
    return;
  }
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
Expected: every block reports `OK`.

- [ ] **Step 3: Commit**

```bash
git add pages/hole.html
git commit -m "feat: hole.html — pass resolved Course Rating/Slope to round completion"
```

---

### Task 5: `pages/profile.html`, `pages/home.html`, `pages/courses.html` — display the real handicap index

**Files:**
- Modify: `pages/profile.html`, `pages/home.html`, `pages/courses.html`

**Interfaces:**
- Consumes: `profiles.handicap_index` directly via `TcAuth.client` (no new module needed — a single-column read).

- [ ] **Step 1: `pages/profile.html` — replace the hardcoded "4.2"**

Find:
```html
    <div class="pf-info">
      <div class="pf-name">John Doe</div>
      <div class="pf-hcp-lbl">Handicap Index</div>
    </div>
    <div class="pf-hcp-num">4.2</div>
```

Replace with:
```html
    <div class="pf-info">
      <div class="pf-name">John Doe</div>
      <div class="pf-hcp-lbl">Handicap Index</div>
    </div>
    <div class="pf-hcp-num" id="pf-hcp-num">—</div>
```

Find the page's `TcAuth.requireAuth()` bootstrap (the async IIFE near the top of the page's own `<script>` block, e.g. `(async () => { await TcAuth.requireAuth(); })();`) and replace it with:
```js
(async () => {
  await TcAuth.requireAuth();
  const session = await TcAuth.getSession();
  if (session) {
    const { data } = await TcAuth.client.from('profiles').select('handicap_index').eq('id', session.user.id).single();
    const el = document.getElementById('pf-hcp-num');
    if (el) el.textContent = data?.handicap_index != null ? ((data.handicap_index >= 0 ? '+' : '') + data.handicap_index) : '—';
  }
})();
```

- [ ] **Step 2: `pages/home.html` — replace the hardcoded "+1.8" widget value**

Find:
```js
  'handicap':   { name:'Handicap Index',   label:'HANDICAP',    value:'+1.8',  vc:'g', trend:'▼ 0.3',  tc:'g', sub:'WHS · Jun 27' },
```

Replace with:
```js
  'handicap':   { name:'Handicap Index',   label:'HANDICAP',    value:'—',  vc:'g', trend:null,  tc:'g', sub:'WHS' },
```

Find:
```js
/* ══ INIT ══ */
renderWidgets();
```

Replace with:
```js
/* ══ INIT ══ */
renderWidgets();
(async () => {
  const session = await TcAuth.getSession();
  if (!session) return;
  const { data } = await TcAuth.client.from('profiles').select('handicap_index').eq('id', session.user.id).single();
  if (data?.handicap_index != null) {
    WIDGETS['handicap'].value = (data.handicap_index >= 0 ? '+' : '') + data.handicap_index;
    renderWidgets();
  }
})();
```

- [ ] **Step 3: `pages/courses.html` — replace the stubbed season-summary Handicap stat**

Find:
```js
function renderSeasonSummary() {
  document.getElementById('ssum-rounds').textContent = String(ROUNDS.length);
  document.getElementById('ssum-hcp').textContent = '—'; // needs the WHS handicap engine (future sub-project)
```

Replace with:
```js
async function renderSeasonSummary() {
  document.getElementById('ssum-rounds').textContent = String(ROUNDS.length);

  const session = await TcAuth.getSession();
  const hcpEl = document.getElementById('ssum-hcp');
  if (session) {
    const { data } = await TcAuth.client.from('profiles').select('handicap_index').eq('id', session.user.id).single();
    hcpEl.textContent = data?.handicap_index != null ? ((data.handicap_index >= 0 ? '+' : '') + data.handicap_index) : '—';
  } else {
    hcpEl.textContent = '—';
  }
```

Find (the call site, since `renderSeasonSummary` is now `async`):
```js
  renderSeasonSummary();
})();
```

Replace with:
```js
  await renderSeasonSummary();
})();
```

- [ ] **Step 4: Verify syntax on all three files**

```bash
node -e "
const fs = require('fs');
const files = ['profile.html', 'home.html', 'courses.html'];
let allOk = true;
for (const f of files) {
  const html = fs.readFileSync('pages/' + f, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  scripts.forEach((s, i) => {
    try { new Function(s); }
    catch (e) { allOk = false; console.log(f, 'block', i, 'ERROR:', e.message); }
  });
}
console.log(allOk ? 'ALL OK' : 'FAILURES FOUND');
"
```
Expected: `ALL OK`.

- [ ] **Step 5: Commit**

```bash
git add pages/profile.html pages/home.html pages/courses.html
git commit -m "feat: display real handicap_index on profile/home/courses instead of hardcoded mocks"
```

---

### Task 6: `pages/stats.html` — real Handicap card and Recent Differentials

**Files:**
- Modify: `pages/stats.html`

**Interfaces:**
- Consumes: `TcRounds.fetchUserRounds` is NOT used here (it filters/reshapes for `courses.html`'s specific needs) — this task adds its own direct fetch of `rounds` rows with `differential` present, then calls `TcHandicap.pairNineHoleDifferentials`/`computeHandicapIndex` from Task 1 for the "used" breakdown.

- [ ] **Step 1: Add `tc-rounds.js` and `tc-handicap.js` script tags**

Find:
```html
<script src="tc-auth.js"></script>
<script src="tc-utils.js"></script>
```

Replace with:
```html
<script src="tc-auth.js"></script>
<script src="tc-rounds.js"></script>
<script src="tc-handicap.js"></script>
<script src="tc-utils.js"></script>
```

- [ ] **Step 2: Replace the hardcoded 'handicap' card entry's static values**

Find:
```js
  {
    id:'handicap',
    name:'Handicap', icon:'🏅', color:'#2ECC71',
    val:'+1.8', lbl:'WHS INDEX', trend:'▼ 0.3', tc:'g',
    desc:'WHS Handicap Index · trending lower',
    chips:['Low: +0.9','20 diffs','Playing +2'],
  },
```

Replace with:
```js
  {
    id:'handicap',
    name:'Handicap', icon:'🏅', color:'#2ECC71',
    val:'—', lbl:'WHS INDEX', trend:null, tc:'g',
    desc:'WHS Handicap Index',
    chips:[],
  },
```

- [ ] **Step 3: Replace `renderHandicap`'s mock data with a real fetch**

Find:
```js
/* ══ 8. HANDICAP ══ */
function renderHandicap(body) {
  const diffs = [
    {date:'Jun 27',course:'Riviera CC',   score:'70',diff:'+0.1',good:true, used:true },
    {date:'Jun 22',course:'Pebble Beach', score:'72',diff:'+1.8',good:false,used:true },
    {date:'Jun 15',course:'Augusta Natl', score:'75',diff:'+2.9',good:false,used:false},
    {date:'Jun 8', course:'TPC Sawgrass', score:'71',diff:'+0.9',good:true, used:true },
    {date:'Jun 1', course:'Torrey Pines', score:'73',diff:'+1.9',good:false,used:true },
    {date:'May 25',course:'LA CC',        score:'71',diff:'−0.3',good:true, used:true },
    {date:'May 18',course:'Riviera CC',   score:'71',diff:'+0.8',good:true, used:true },
    {date:'May 11',course:'Bethpage Blk', score:'74',diff:'+2.4',good:false,used:false},
  ];

  body.innerHTML = `
    <div style="text-align:center;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:14px;">
      <div style="font-size:46px;font-weight:900;color:var(--green);letter-spacing:-2px;line-height:1;">+1.8</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin-top:4px;">WHS HANDICAP INDEX</div>
      <div style="font-size:11px;color:var(--green);margin-top:6px;font-weight:700;">▼ 0.3 · trending lower (improving)</div>
    </div>` +

    kpi([
      {v:'+0.9',l:'LOW (365 DAY)', c:'var(--green)'},
      {v:'+1.8',l:'CURRENT',       c:'var(--green)'},
      {v:'+2.4',l:'HIGH (365 DAY)',c:'var(--muted)'},
      {v:'20',  l:'DIFFS TRACKED', c:'#fff'},
    ], 4) +

    `<div class="ds-sec">Recent Differentials</div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:6px;">
      <span style="width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;"></span> used in index &nbsp;
      <span style="width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.15);display:inline-block;"></span> excluded
    </div>` +

    diffs.map(d => {
      const vc = d.good ? 'var(--green)' : parseFloat(d.diff) > 2 ? 'var(--red)' : '#fff';
      return `<div class="diff-row">
        <div class="diff-date">${d.date}</div>
        <div class="diff-course">${d.course}</div>
        <div class="diff-score">${d.score}</div>
        <div class="diff-val" style="color:${vc}">${d.diff}</div>
        <div class="diff-dot" style="background:${d.used ? 'var(--green)' : 'rgba(255,255,255,0.15)'};"></div>
      </div>`;
    }).join('') +
    '<div style="height:12px;"></div>';
}
```

Replace with:
```js
/* ══ 8. HANDICAP ══ */
function escHtmlStats(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function renderHandicap(body) {
  body.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--muted);font-size:12px;">Loading…</div>';

  const session = await TcAuth.getSession();
  if (!session) { body.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--muted);font-size:12px;">Sign in to see your handicap.</div>'; return; }

  const { data: profile } = await TcAuth.client.from('profiles').select('handicap_index').eq('id', session.user.id).single();
  const currentIndex = profile?.handicap_index ?? null;

  const { data: rounds, error } = await TcAuth.client
    .from('rounds')
    .select('id, course_name, gross_score, hole_count, differential, played_at, completed_at')
    .eq('user_id', session.user.id)
    .eq('status', 'complete')
    .not('differential', 'is', null)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(50);

  if (error || !rounds || rounds.length === 0) {
    body.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--muted);font-size:12px;">No handicap-eligible rounds yet.</div>';
    return;
  }

  const entries = TcHandicap.pairNineHoleDifferentials(rounds);
  const { usedRoundIds } = TcHandicap.computeHandicapIndex(entries);

  // Low/High here are the lowest/highest individual round differential in the
  // last 365 days — a simplification of WHS's real "lowest/highest the index
  // itself has been," which would require reconstructing the index at every
  // historical point in time. Out of scope for this sub-project.
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const recentDiffs = rounds
    .filter(r => new Date(r.completed_at || r.played_at).getTime() >= oneYearAgo)
    .map(r => r.differential);
  const low  = recentDiffs.length ? Math.min(...recentDiffs) : null;
  const high = recentDiffs.length ? Math.max(...recentDiffs) : null;
  const fmtSigned = v => v == null ? '—' : (v >= 0 ? '+' : '') + v;

  const indexLabel = currentIndex == null ? '—' : fmtSigned(currentIndex);
  const trackedCount = Math.min(rounds.length, 20);

  body.innerHTML = `
    <div style="text-align:center;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:14px;">
      <div style="font-size:46px;font-weight:900;color:var(--green);letter-spacing:-2px;line-height:1;">${indexLabel}</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin-top:4px;">WHS HANDICAP INDEX</div>
    </div>` +

    kpi([
      {v:fmtSigned(low),  l:'LOW (365 DAY)', c:'var(--green)'},
      {v:indexLabel,      l:'CURRENT',       c:'var(--green)'},
      {v:fmtSigned(high), l:'HIGH (365 DAY)',c:'var(--muted)'},
      {v:String(trackedCount), l:'DIFFS TRACKED', c:'#fff'},
    ], 4) +

    `<div class="ds-sec">Recent Differentials</div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:6px;">
      <span style="width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;"></span> used in index &nbsp;
      <span style="width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.15);display:inline-block;"></span> excluded / pending
    </div>` +

    rounds.map(r => {
      const dateObj = new Date(r.played_at);
      const dateLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const vc = r.differential < 0 ? 'var(--green)' : r.differential > 2 ? 'var(--red)' : '#fff';
      const used = usedRoundIds.has(r.id);
      return `<div class="diff-row">
        <div class="diff-date">${dateLabel}</div>
        <div class="diff-course">${escHtmlStats(r.course_name)}${r.hole_count === 9 ? ' (9)' : ''}</div>
        <div class="diff-score">${r.gross_score ?? '—'}</div>
        <div class="diff-val" style="color:${vc}">${fmtSigned(r.differential)}</div>
        <div class="diff-dot" style="background:${used ? 'var(--green)' : 'rgba(255,255,255,0.15)'};"></div>
      </div>`;
    }).join('') +
    '<div style="height:12px;"></div>';
}
```

- [ ] **Step 4: Verify syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('pages/stats.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```
Expected: every block reports `OK`.

- [ ] **Step 5: Manual browser verification**

With `pages/` served locally and signed in as an account with at least 3 completed 18-hole rounds (or a paired set of 9-hole rounds) from Tasks 1–4's testing:

1. Open `stats.html`, tap the Handicap card → confirm the hero value matches `profiles.handicap_index`, the KPI row shows real Low/Current/High/Diffs values (not `+1.8`/`+0.9`/`+2.4`/`20`), and the Recent Differentials table lists real rounds with correct used/excluded dots.
2. Confirm a round played before this sub-project shipped (no `differential`) simply doesn't appear in the list, rather than crashing the page.
3. Confirm `profile.html`, `home.html`, and `courses.html` (from Task 5) all show that same real index value.

- [ ] **Step 6: Commit**

```bash
git add pages/stats.html
git commit -m "feat: stats.html — real Handicap card and Recent Differentials from live data"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Rating/slope manual entry, localStorage cache, same pattern as tee/green marking | Task 1 (cache functions), Task 2 (UI) |
| Which-9 resolution, non-standard 9-hole starts excluded | Task 2 |
| Net Double Bogey ESC (simplified), Score Differential | Task 1 (math), Task 3 (orchestration) |
| 9-hole pairing (oldest-first, odd one pending) | Task 1 (`pairNineHoleDifferentials`) |
| Official WHS count-based averaging table, 0.96 multiplier, min 3 differentials | Task 1 (`computeHandicapIndex`) |
| Differential/index computed at round completion, folded into existing offline retry queue | Task 3 |
| No new Supabase schema | Confirmed — Task 3 only writes to pre-existing columns |
| Every display surface reads real `profiles.handicap_index` | Tasks 5 (profile/home/courses), 6 (stats) |
| `—` placeholder instead of fabricated numbers when index/diffs unavailable | Tasks 5, 6 |
| End-to-end verification | Task 6 Step 5 |

**Placeholder scan:** no TBD/TODO; every step has literal code or an exact verification procedure.

**Type consistency:** `TcHandicap`'s five function signatures (`getRatingSlope`, `saveRatingSlope`, `courseHandicap`, `adjustedGrossScore`, `scoreDifferential`, `pairNineHoleDifferentials`, `computeHandicapIndex`) are used identically in Task 3 (`tc-rounds.js`) and Task 6 (`stats.html`) as defined in Task 1. `TcRounds.completeRound()`'s new `{courseRating, slopeRating}` parameter shape is identical between its Task 3 definition and Task 4's call site in `hole.html`. `sel.ratingSlope`/`sel.which9` set in Task 2 flow through `roundData.ratingSlope`/`roundData.which9` (same Task 2) to `_round.ratingSlope` read in Task 4 — same property names throughout.
