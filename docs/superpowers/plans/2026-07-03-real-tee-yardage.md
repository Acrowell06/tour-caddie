# Real Tee Yardage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `pages/rounds.html`'s hardcoded, fake tee yardage list with real yardage computed from the course's actual OpenStreetMap tee/green data.

**Architecture:** A background `TcCourse.loadNear()` fetch kicks off as soon as a course is selected; once it resolves, a pure computation groups the 5 canonical tee names by identical position data (to detect OSM's "fill missing tees from any available one" fallback) and sums real per-hole tee-to-green distances for tees with genuinely distinct data. The tee list re-renders with real numbers (or "Yardage unknown") whenever the fetch resolves, without blocking round setup.

**Tech Stack:** Vanilla JS, existing `pages/tc-course.js` (`TcCourse.loadNear`, `TcCourse.haversineYds`, `TcCourse.geoKeyFor` — all already used elsewhere in this file). No build step, no new Supabase schema.

## Global Constraints

- No build step — plain `<script src="...">` tags only.
- No new Supabase schema, no new shared module — this is a single-file (`pages/rounds.html`) change, since the computation is specific to this page's tee-selection UI.
- Tee display names, order, and colors are unchanged: Black(`tips`)/Blue(`blue`)/White(`white`)/Gold(`gold`)/Red(`red`) — only the yardage source changes, so existing cached Course Rating/Slope entries (keyed by tee display name) keep matching.
- A tee's yardage is only shown when its 18-hole position sequence is unique among the 5 canonical names — if 2+ share an identical sequence (OSM's sparse-data fallback duplicating one real position), none of them show a yardage, since there's no reliable way to attribute a shared position to one specific canonical name.
- A tee's yardage is only computed when *every* hole has both that tee's position and a green center — a partial sum is never shown as if it were the real total.
- Fetching/computing yardage never blocks "Next" — it's informational, unlike Course Rating/Slope (already solved separately, unaffected by this plan).
- **In-scope bug fix directly required by this plan's own correctness** (discovered while implementing): `startRound()` currently sets `roundData.tee = (sel.tee?.name || 'white').toLowerCase()`. Four of the five display names happen to lowercase into the correct canonical OSM key (`'blue'`, `'white'`, `'gold'`, `'red'`), but `'Black'.toLowerCase()` produces `'black'`, which does not exist in `holes_data[i].tees` (the real canonical key is `'tips'`) — so selecting Black tees has always silently fallen back to degraded GPS mode in `pages/hole.html`, never using real per-hole tee positions. This plan's tee objects carry the real canonical key directly, so this task fixes `roundData.tee` to use it instead of the lossy lowercase conversion.

---

### Task 1: `pages/rounds.html` — real per-tee yardage from OSM data

**Files:**
- Modify: `pages/rounds.html`

**Interfaces:**
- Consumes: `TcCourse.loadNear(lat, lng)` (already used elsewhere in this file — returns `{holes: [...]}` or `null`/throws), `TcCourse.haversineYds(a, b)` (already used elsewhere in this codebase, e.g. `pages/hole.html`), `TcCourse.geoKeyFor` (unchanged, already used for the Course Rating/Slope cache).
- Produces: `sel.tee` objects now shaped `{ name, key, color, yds }` — `key` is the new field (`'tips'|'blue'|'white'|'gold'|'red'`), consumed by this same task's `startRound()` fix. `yds` may be `null` (unknown), unlike before where it was always a fabricated number.

- [ ] **Step 1: Replace the hardcoded `TEES` array with a canonical tee list (names/colors only, no fake numbers) and add fetch-result state**

Find:
```js
const TEES = [
  { name:'Black',  color:'#1a1a2e', yds:7322, rating:76.1, slope:145 },
  { name:'Blue',   color:'#1a3a8f', yds:6982, rating:74.2, slope:140 },
  { name:'White',  color:'#e0e0e0', yds:6451, rating:71.8, slope:133 },
  { name:'Gold',   color:'#c9a227', yds:5980, rating:69.4, slope:125 },
  { name:'Red',    color:'#c0392b', yds:5320, rating:70.2, slope:128 },
];
```

Replace with:
```js
const TEE_CANONICAL = [
  { key:'tips',  name:'Black', color:'#1a1a2e' },
  { key:'blue',  name:'Blue',  color:'#1a3a8f' },
  { key:'white', name:'White', color:'#e0e0e0' },
  { key:'gold',  name:'Gold',  color:'#c9a227' },
  { key:'red',   name:'Red',   color:'#c0392b' },
];

let teeCourseData = null; // holes_data for the selected course, once TcCourse.loadNear resolves

function sameLatLng(a, b) {
  return !!a && !!b && a.lat === b.lat && a.lng === b.lng;
}

// Groups the 5 canonical tee keys by identical 18-hole position sequence.
// A key only gets a computed yardage if its sequence is unique among the 5 —
// shared sequences mean OSM's "fill missing tees from any available one"
// fallback duplicated one real position across multiple canonical names,
// and there's no way to tell which (if any) name it actually belongs to.
function computeTeeYardages(holesData) {
  const result = {};
  if (!holesData || holesData.length === 0) {
    TEE_CANONICAL.forEach(t => { result[t.key] = null; });
    return result;
  }

  const sequences = TEE_CANONICAL.map(t => holesData.map(h => h.tees?.[t.key] ?? null));
  const groupOf = {};
  TEE_CANONICAL.forEach((t, i) => {
    let group = t.key;
    for (let j = 0; j < i; j++) {
      const same = sequences[i].every((pos, h) => sameLatLng(pos, sequences[j][h]));
      if (same) { group = groupOf[TEE_CANONICAL[j].key]; break; }
    }
    groupOf[t.key] = group;
  });
  const groupCounts = {};
  Object.values(groupOf).forEach(g => { groupCounts[g] = (groupCounts[g] || 0) + 1; });

  TEE_CANONICAL.forEach((t, i) => {
    if (groupCounts[groupOf[t.key]] > 1) { result[t.key] = null; return; }
    let total = 0;
    let complete = true;
    for (let h = 0; h < holesData.length; h++) {
      const teePos = sequences[i][h];
      const greenCtr = holesData[h].green?.center;
      if (!teePos || !greenCtr) { complete = false; break; }
      total += TcCourse.haversineYds(teePos, greenCtr);
    }
    result[t.key] = complete ? Math.round(total) : null;
  });
  return result;
}
```

- [ ] **Step 2: Trigger the background course-data fetch when a course is selected**

Find:
```js
    row.onclick = () => {
      sel.course = c;
      document.querySelectorAll('.course-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      document.getElementById('setup-next-btn').disabled = false;
    };
```

Replace with:
```js
    row.onclick = () => {
      sel.course = c;
      document.querySelectorAll('.course-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      document.getElementById('setup-next-btn').disabled = false;
      teeCourseData = null;
      if (c.lat && c.lng) {
        TcCourse.loadNear(c.lat, c.lng).then(data => {
          teeCourseData = data?.holes ?? null;
          renderTeeList();
        }).catch(() => { teeCourseData = null; });
      }
    };
```

- [ ] **Step 3: Extract the tee-list rendering into its own function, using real yardage**

Find:
```js
  /* Tees */
  const teeList = document.getElementById('rd-tee-list');
  TEES.forEach(t => {
    const d = document.createElement('div');
    d.className = 'radio-opt' + (sel.tee && sel.tee.name === t.name ? ' selected' : '');
    d.innerHTML = `
      <div class="ro-dot"></div>
      <div class="tee-swatch" style="background:${t.color};border:1px solid rgba(255,255,255,0.2);"></div>
      <div class="ro-info">
        <div class="ro-name">${t.name}</div>
        <div class="ro-sub">${t.yds} yds · Rating ${t.rating} · Slope ${t.slope}</div>
      </div>`;
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

Replace with:
```js
  renderTeeList();
```

Then, immediately before the enclosing `function renderRoundDetails(body) {` line, insert this new top-level function:

Find:
```js
/* ── STEP: ROUND DETAILS (tee, starting hole, score type, date, handicap — all one page) ── */
function renderRoundDetails(body) {
```

Replace with:
```js
/* ── STEP: ROUND DETAILS (tee, starting hole, score type, date, handicap — all one page) ── */
function renderTeeList() {
  const teeList = document.getElementById('rd-tee-list');
  if (!teeList) return;
  const yardages = computeTeeYardages(teeCourseData);
  teeList.innerHTML = '';
  TEE_CANONICAL.forEach(t => {
    const yds = yardages[t.key];
    const d = document.createElement('div');
    d.className = 'radio-opt' + (sel.tee && sel.tee.key === t.key ? ' selected' : '');
    d.innerHTML = `
      <div class="ro-dot"></div>
      <div class="tee-swatch" style="background:${t.color};border:1px solid rgba(255,255,255,0.2);"></div>
      <div class="ro-info">
        <div class="ro-name">${t.name}</div>
        <div class="ro-sub">${yds != null ? yds.toLocaleString() + ' yds' : 'Yardage unknown'}</div>
      </div>`;
    d.onclick = () => {
      sel.tee = { name: t.name, key: t.key, color: t.color, yds };
      teeList.querySelectorAll('.radio-opt').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
      updateRatingSlopePrompt();
      document.getElementById('setup-next-btn').disabled = !canAdvance();
    };
    teeList.appendChild(d);
  });
}

function renderRoundDetails(body) {
```

- [ ] **Step 4: Fix `startRound()` to use the real canonical OSM key instead of a lossy lowercase conversion**

Find:
```js
  const roundData = {
    course: sel.course,
    tee: (sel.tee?.name || 'white').toLowerCase(),
    teeYardage: sel.tee?.yds || null,
```

Replace with:
```js
  const roundData = {
    course: sel.course,
    tee: sel.tee?.key || 'white',
    teeYardage: sel.tee?.yds || null,
```

- [ ] **Step 5: Verify syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('pages/rounds.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```
Expected: every block reports `OK`.

- [ ] **Step 6: Manual browser verification**

With `pages/` served locally and signed in:

1. Select a well-mapped real course (e.g. one previously played and confirmed to have real hole/tee/green data in earlier testing) → advance to the tee-selection step → confirm each of the 5 tees shows a plausible, real-looking total yardage (not the old fixed `7322`/`6982`/`6451`/`5980`/`5320` numbers), and that they differ from each other.
2. Select an obscure or sparsely-tagged course → confirm tee names still appear with "Yardage unknown" where data is missing or duplicate-derived, and that "Next" is not blocked by this.
3. Select "Black" tees specifically on the well-mapped course from step 1, play a hole in `hole.html`, and confirm it uses real per-hole tee GPS data (not degraded/fallback mode) — this is the pre-existing lowercase-key bug this task fixes.
4. Confirm Course Rating/Slope entry still works unchanged in both cases.
5. Complete a round and check `courses.html`'s round-history "tee" display shows the real computed yardage, not a mock number.

- [ ] **Step 7: Commit**

```bash
git add pages/rounds.html
git commit -m "feat: rounds.html — compute real per-tee yardage from OSM data, fix Black-tee canonical key lookup"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Background fetch on course selection, non-blocking | Task 1 Step 2 |
| Real per-tee yardage from OSM tee/green positions | Task 1 Step 1 (`computeTeeYardages`) |
| Distinctness/duplicate detection (symmetric grouping, not "first wins") | Task 1 Step 1 (`groupOf`/`groupCounts` logic) |
| Partial-data holes never produce a misleading partial sum | Task 1 Step 1 (`complete` flag) |
| "Yardage unknown" fallback, no blocking | Task 1 Step 3 (render), Step 2 (no `canAdvance` change) |
| Display names/order/colors unchanged | Task 1 Step 1 (`TEE_CANONICAL` matches old `TEES` names/colors/order) |
| Course Rating/Slope untouched | Confirmed — no changes to `updateRatingSlopePrompt`/`showRatingSlopeForm`/`saveRatingSlopeEntry` |
| Real yardage flows to `courses.html` round history | Task 1 Step 4 (`teeYardage` unchanged pass-through) |
| Black-tee canonical-key bug fix | Task 1 Step 4 |

**Placeholder scan:** no TBD/TODO; every step has literal code or an exact verification procedure.

**Type consistency:** `sel.tee.key` is set in Task 1 Step 3's `renderTeeList()` and consumed in Step 4's `startRound()` fix — same property name. `computeTeeYardages()`'s return shape (`{key: yards|null}`) matches how Step 3's `renderTeeList()` reads it (`yardages[t.key]`).
