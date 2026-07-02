# Rounds/Shots Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist rounds/holes/shots played through `pages/hole.html` to Supabase (replacing the sessionStorage-only, discard-on-close current behavior), and make `pages/courses.html` read real round history instead of its hardcoded 12-round mock array.

**Architecture:** A new shared `pages/tc-rounds.js` module (same IIFE pattern as `tc-course.js`/`tc-utils.js`/`tc-auth.js`) owns all Supabase reads/writes for rounds data: creating a round row at round start, batching each hole's result + shots to Supabase at hole-end (buffered through a `sessionStorage`-backed retry queue for offline resilience), marking a round complete, and fetching + transforming a user's rounds for `courses.html`. `pages/rounds.html` and `pages/hole.html` call into it at their existing state-transition points; `pages/courses.html` calls it once at load instead of reading a literal array.

**Tech Stack:** Vanilla JS, `@supabase/supabase-js@2.110.0` (already pinned via CDN + SRI on every page from the real-authentication sub-project), Supabase Postgres + Row Level Security. No build step, no ES modules.

## Global Constraints

- No build step — plain `<script src="...">` tags only; no ES modules, no bundler, no npm install.
- Supabase project URL: `https://cfuxiifpvuzvysjxztax.supabase.co` (already embedded in `pages/tc-auth.js`; reuse `TcAuth.client`, never create a second Supabase client).
- The Supabase UMD CDN script (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js`, `integrity="sha384-3wY11tldQ5+yWqAvmTN4XtQvnjoTva0cV15O/O/O5NTtp0ivVopSzLOzsVXWZse9"`, `crossorigin="anonymous"`) and `tc-auth.js` are already loaded on `rounds.html`, `hole.html`, and `courses.html` from the real-authentication sub-project — this plan adds `tc-rounds.js` after `tc-auth.js` on those three pages, nothing else.
- Every new table (`rounds`, `hole_results`, `shots`) carries a denormalized `user_id` column and RLS policies scoped to `auth.uid() = user_id` — no policy may rely on a join/subquery to determine ownership.
- No mid-round resume across browser sessions. `sessionStorage.tc_active_round` / `tc_round_scores` remain the live in-round buffer exactly as today; Supabase is a write-behind mirror populated at hole boundaries.
- No fabricated Strokes Gained or handicap-differential values. `courses.html` shows `sg: null` and `diff: null` (rendered as placeholders) until the future Strokes Gained and WHS handicap engine sub-projects exist to compute them.
- Hole-end sync must never block or show an error to the golfer on failure — failures queue silently for retry (see Task 2).

---

### Task 1: Database migration — `rounds`, `hole_results`, `shots` tables

**Files:**
- Create: `supabase/migrations/0002_create_rounds_shots.sql`

**Interfaces:**
- Produces: `public.rounds`, `public.hole_results`, `public.shots` tables (exact columns below) with RLS enabled and `select`/`insert`/`update` policies scoped to `auth.uid() = user_id` on all three, plus a `delete` policy on `shots` only (needed by Task 2's idempotent resync — see that task's design).
- This task's SQL must be run against the live Supabase project by the user via the dashboard's SQL Editor — there is no database connection string or CLI access available in this session to apply it directly. If you are an agentic implementer with no way to prompt a human synchronously, stop and report NEEDS_CONTEXT asking the controller to relay this step to the user and confirm completion before continuing to Step 3.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0002_create_rounds_shots.sql
create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  course_name text not null,
  tee_name text,
  tee_yardage int,
  round_type text not null default 'Home',   -- 'Home' | 'Away' | 'Competition'
  hole_count int not null,                    -- 9 | 18
  status text not null default 'in_progress', -- 'in_progress' | 'complete'
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.hole_results (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  hole_number int not null,
  par int not null,
  handicap int,
  strokes int not null,
  putts int not null,
  fir boolean,           -- null on par 3 (not tracked) or if never toggled
  gir boolean,           -- null only if never toggled (edge case)
  up_and_down boolean,   -- null when not applicable (e.g. GIR hit, or par 3)
  unique (round_id, hole_number)
);

create table public.shots (
  id uuid primary key default gen_random_uuid(),
  hole_result_id uuid not null references public.hole_results(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  shot_number int not null,
  club text,
  lat double precision,
  lng double precision,
  result text,            -- 'holed' | null (only 'holed' is populated today; the
                           -- column allows future lie categories like 'fairway'/'rough')
  distance_yards numeric
);

alter table public.rounds enable row level security;
alter table public.hole_results enable row level security;
alter table public.shots enable row level security;

create policy "Users can view their own rounds"
  on public.rounds for select using (auth.uid() = user_id);
create policy "Users can insert their own rounds"
  on public.rounds for insert with check (auth.uid() = user_id);
create policy "Users can update their own rounds"
  on public.rounds for update using (auth.uid() = user_id);

create policy "Users can view their own hole results"
  on public.hole_results for select using (auth.uid() = user_id);
create policy "Users can insert their own hole results"
  on public.hole_results for insert with check (auth.uid() = user_id);
create policy "Users can update their own hole results"
  on public.hole_results for update using (auth.uid() = user_id);

create policy "Users can view their own shots"
  on public.shots for select using (auth.uid() = user_id);
create policy "Users can insert their own shots"
  on public.shots for insert with check (auth.uid() = user_id);
create policy "Users can update their own shots"
  on public.shots for update using (auth.uid() = user_id);
create policy "Users can delete their own shots"
  on public.shots for delete using (auth.uid() = user_id);
```

- [ ] **Step 2: Ask the user to apply the migration**

Tell the user:

> "Open your Supabase project dashboard at https://supabase.com/dashboard/project/cfuxiifpvuzvysjxztax, go to the **SQL Editor** in the left sidebar, paste the contents of `supabase/migrations/0002_create_rounds_shots.sql`, and click **Run**. Let me know once it's run successfully (or paste any error it shows)."

Wait for the user's confirmation before proceeding to Step 3. If they report an error, read it, fix the SQL file, and ask them to run the corrected version.

- [ ] **Step 3: Verify the tables exist**

Ask the user to confirm via the Supabase dashboard's **Table Editor** that `rounds`, `hole_results`, and `shots` tables now exist with the columns listed above.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_create_rounds_shots.sql
git commit -m "feat: add rounds/hole_results/shots tables migration with RLS"
```

---

### Task 2: `pages/tc-rounds.js` — shared persistence module

**Files:**
- Create: `pages/tc-rounds.js`

**Interfaces:**
- Consumes: `TcAuth.client`, `TcAuth.getSession()` from `pages/tc-auth.js` (Task 1 requires this file be loaded first on any page using `TcRounds`).
- Produces: `window.TcRounds` object with:
  - `TcRounds.createRound({ courseName, teeName, teeYardage, holeCount })` → `Promise<string|null>` — inserts a `rounds` row, returns its `id`, or `null` if it fails (offline/error; caller proceeds without one).
  - `TcRounds.syncHole({ holeNumber, par, handicap, strokes, putts, fir, gir, upAndDown, shots })` → `Promise<void>` — queues this hole's result + shots for sync and attempts immediate delivery; never throws.
  - `TcRounds.completeRound()` → `Promise<void>` — queues a "mark round complete" step behind any pending hole syncs for the current active round; never throws.
  - `TcRounds.drainPendingSyncs()` → `Promise<void>` — attempts to flush anything still queued in `sessionStorage.tc_pending_syncs`; safe to call anytime, no-ops if nothing is queued or a drain is already in flight.
  - `TcRounds.fetchUserRounds()` → `Promise<Array|null>` — fetches the signed-in user's completed rounds (newest first), each transformed into the exact object shape `pages/courses.html`'s `ROUNDS` array already expects (see Task 5). Returns `null` on fetch failure (network/auth error) so the caller can distinguish "failed" from "genuinely zero rounds" (`[]`).
- Reads/writes `sessionStorage.tc_active_round` (for `roundId`/course/tee/hole-count context during the repair path — see Step 1) and `sessionStorage.tc_pending_syncs` (the retry queue) — same storage keys `rounds.html`/`hole.html` already use.

- [ ] **Step 1: Create `pages/tc-rounds.js`**

```js
/* tc-rounds.js — Rounds/hole-results/shots persistence to Supabase.
   Requires tc-auth.js to be loaded first (uses TcAuth.client / TcAuth.getSession()). */
window.TcRounds = (() => {
  let draining = false;

  function readQueue() {
    try { return JSON.parse(sessionStorage.getItem('tc_pending_syncs') || '[]'); }
    catch { return []; }
  }
  function writeQueue(queue) {
    sessionStorage.setItem('tc_pending_syncs', JSON.stringify(queue));
  }

  async function insertRoundRow({ courseName, teeName, teeYardage, holeCount }) {
    const session = await TcAuth.getSession();
    if (!session) return null;
    const { data, error } = await TcAuth.client
      .from('rounds')
      .insert({
        user_id: session.user.id,
        course_name: courseName,
        tee_name: teeName || null,
        tee_yardage: teeYardage || null,
        hole_count: holeCount
      })
      .select('id')
      .single();
    if (error) { console.error('TcRounds: failed to create round', error); return null; }
    return data.id;
  }

  async function createRound(meta) {
    return insertRoundRow(meta);
  }

  // Resolves the current active round's Supabase id, creating the round row
  // now if the original createRound() call (at round start) never succeeded
  // — e.g. the golfer teed off while offline. Persists the repaired id back
  // onto tc_active_round so later holes don't repeat the repair.
  async function ensureRoundId() {
    let round;
    try { round = JSON.parse(sessionStorage.getItem('tc_active_round') || 'null'); }
    catch { round = null; }
    if (!round) return null;
    if (round.roundId) return round.roundId;

    const id = await insertRoundRow({
      courseName: round.course?.name || 'Unknown Course',
      teeName: round.tee || null,
      teeYardage: round.teeYardage || null,
      holeCount: round.holes
    });
    if (id) {
      round.roundId = id;
      sessionStorage.setItem('tc_active_round', JSON.stringify(round));
    }
    return id;
  }

  async function writeHoleResult(roundId, payload) {
    const session = await TcAuth.getSession();
    if (!session) return false;

    const { data, error } = await TcAuth.client
      .from('hole_results')
      .upsert({
        round_id: roundId,
        user_id: session.user.id,
        hole_number: payload.holeNumber,
        par: payload.par,
        handicap: payload.handicap,
        strokes: payload.strokes,
        putts: payload.putts,
        fir: payload.fir,
        gir: payload.gir,
        up_and_down: payload.upAndDown
      }, { onConflict: 'round_id,hole_number' })
      .select('id')
      .single();
    if (error) { console.error('TcRounds: failed to sync hole', error); return false; }

    // Idempotent under retries: clear any shots from a prior partial attempt
    // for this hole before re-inserting, so a retry never double-writes shots.
    const { error: delError } = await TcAuth.client.from('shots').delete().eq('hole_result_id', data.id);
    if (delError) { console.error('TcRounds: failed to clear old shots before resync', delError); return false; }

    if (payload.shots && payload.shots.length > 0) {
      const shotRows = payload.shots.map(s => ({
        hole_result_id: data.id,
        user_id: session.user.id,
        shot_number: s.shotNumber,
        club: s.club,
        lat: s.lat,
        lng: s.lng,
        result: s.result,
        distance_yards: s.distanceYards
      }));
      const { error: shotsError } = await TcAuth.client.from('shots').insert(shotRows);
      if (shotsError) { console.error('TcRounds: failed to sync shots', shotsError); return false; }
    }
    return true;
  }

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

  async function drainPendingSyncs() {
    if (draining) return;
    draining = true;
    try {
      let queue = readQueue();
      while (queue.length > 0) {
        const roundId = await ensureRoundId();
        if (!roundId) break; // still offline / no active round — stop, retry later

        const entry = queue[0];
        let ok = false;
        if (entry.type === 'hole') ok = await writeHoleResult(roundId, entry.payload);
        else if (entry.type === 'complete') ok = await writeRoundComplete(roundId);

        if (!ok) break; // leave it at the front of the queue, stop draining

        queue = queue.slice(1);
        writeQueue(queue);
      }
    } finally {
      draining = false;
    }
  }

  async function syncHole(payload) {
    const queue = readQueue();
    queue.push({ type: 'hole', payload });
    writeQueue(queue);
    return drainPendingSyncs();
  }

  async function completeRound() {
    const queue = readQueue();
    queue.push({ type: 'complete', payload: {} });
    writeQueue(queue);
    return drainPendingSyncs();
  }

  function transformRound(row) {
    const holesData = [...row.hole_results].sort((a, b) => a.hole_number - b.hole_number);
    const holes = holesData.map(h => h.strokes);
    const pars  = holesData.map(h => h.par);
    const gross = holes.reduce((a, b) => a + b, 0);
    const totalPar = pars.reduce((a, b) => a + b, 0);
    const score = gross - totalPar;

    const pct = (arr, pred) => arr.length ? Math.round(arr.filter(pred).length / arr.length * 100) : 0;
    const firHoles = holesData.filter(h => h.fir !== null);
    const girHoles = holesData.filter(h => h.gir !== null);
    const udHoles  = holesData.filter(h => h.up_and_down !== null);
    const fir = pct(firHoles, h => h.fir);
    const gir = pct(girHoles, h => h.gir);
    const upDown = pct(udHoles, h => h.up_and_down);
    const putts = holesData.reduce((a, h) => a + (h.putts || 0), 0);

    const started = new Date(row.started_at);
    const date  = started.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const month = started.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    return {
      id: row.id,
      course: row.course_name,
      date, month,
      tee: row.tee_name ? `${row.tee_name}${row.tee_yardage ? ' · ' + row.tee_yardage.toLocaleString() + ' yds' : ''}` : '—',
      type: row.round_type || 'Home',
      score, gross, diff: null,
      fir, gir, putts, up_down: upDown,
      sg: null,
      holes, pars,
      chips: [`${fir}% FIR`, `${gir}% GIR`, `${putts} putts`]
    };
  }

  async function fetchUserRounds() {
    const session = await TcAuth.getSession();
    if (!session) return null;
    const { data, error } = await TcAuth.client
      .from('rounds')
      .select('id, course_name, tee_name, tee_yardage, round_type, started_at, completed_at, status, hole_results(hole_number, par, strokes, putts, fir, gir, up_and_down)')
      .eq('user_id', session.user.id)
      .eq('status', 'complete')
      .order('started_at', { ascending: false });
    if (error) { console.error('TcRounds: failed to fetch rounds', error); return null; }
    return data.map(transformRound);
  }

  window.addEventListener('online', () => { drainPendingSyncs(); });

  return { createRound, syncHole, completeRound, drainPendingSyncs, fetchUserRounds };
})();
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "
const fs = require('fs');
try { new Function(fs.readFileSync('pages/tc-rounds.js', 'utf8')); console.log('OK'); }
catch (e) { console.log('SYNTAX ERROR:', e.message); }
"
```
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add pages/tc-rounds.js
git commit -m "feat: add tc-rounds.js — round/hole/shot sync with offline retry queue"
```

---

### Task 3: `pages/rounds.html` — create the round row at round start

**Files:**
- Modify: `pages/rounds.html`

**Interfaces:**
- Consumes: `TcRounds.createRound({ courseName, teeName, teeYardage, holeCount })` from Task 2.

- [ ] **Step 1: Add the `tc-rounds.js` script tag**

Find in `pages/rounds.html`:
```html
<script src="tc-auth.js"></script>
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
```

Replace with:
```html
<script src="tc-auth.js"></script>
<script src="tc-rounds.js"></script>
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
```

(If the existing tag order differs from this — e.g. `tc-auth.js` isn't immediately followed by `tc-course.js` — insert `<script src="tc-rounds.js"></script>` directly after the existing `tc-auth.js` tag instead, keeping everything else unchanged.)

- [ ] **Step 2: Record tee yardage on the round data, and create the round row**

Find:
```js
async function startRound() {
  const nextBtn = document.getElementById('setup-next-btn');
  if (nextBtn) { nextBtn.textContent = '⛳ Loading…'; nextBtn.disabled = true; }

  const holesCount = sel.holes === 9 ? 9 : sel.holes === 'custom' ? (sel.customHoles || 18) : 18;
  const roundData = {
    course: sel.course,
    tee: (sel.tee?.name || 'white').toLowerCase(),
    holes: holesCount,
    holes_data: null,
    holeSequence: buildHoleSequence(sel.startHole || 1, holesCount),
    currentHoleIdx: 0
  };

  if (sel.course?.lat && sel.course?.lng) {
    roundData.geoKey = TcCourse.geoKeyFor(sel.course.lat, sel.course.lng);
    try {
      const data = await TcCourse.loadNear(sel.course.lat, sel.course.lng);
      if (data) roundData.holes_data = data.holes ?? null;
    } catch {}
  }

  sessionStorage.setItem('tc_active_round', JSON.stringify(roundData));
  sessionStorage.removeItem('tc_round_scores');
  navigate('hole');
}
```

Replace with:
```js
async function startRound() {
  const nextBtn = document.getElementById('setup-next-btn');
  if (nextBtn) { nextBtn.textContent = '⛳ Loading…'; nextBtn.disabled = true; }

  const holesCount = sel.holes === 9 ? 9 : sel.holes === 'custom' ? (sel.customHoles || 18) : 18;
  const roundData = {
    course: sel.course,
    tee: (sel.tee?.name || 'white').toLowerCase(),
    teeYardage: sel.tee?.yds || null,
    holes: holesCount,
    holes_data: null,
    holeSequence: buildHoleSequence(sel.startHole || 1, holesCount),
    currentHoleIdx: 0,
    roundId: null
  };

  if (sel.course?.lat && sel.course?.lng) {
    roundData.geoKey = TcCourse.geoKeyFor(sel.course.lat, sel.course.lng);
    try {
      const data = await TcCourse.loadNear(sel.course.lat, sel.course.lng);
      if (data) roundData.holes_data = data.holes ?? null;
    } catch {}
  }

  roundData.roundId = await TcRounds.createRound({
    courseName: sel.course?.name || 'Unknown Course',
    teeName: roundData.tee,
    teeYardage: roundData.teeYardage,
    holeCount: holesCount
  });

  sessionStorage.setItem('tc_active_round', JSON.stringify(roundData));
  sessionStorage.removeItem('tc_round_scores');
  sessionStorage.removeItem('tc_pending_syncs');
  navigate('hole');
}
```

- [ ] **Step 3: Verify syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('pages/rounds.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```
Expected: every block reports `OK`.

- [ ] **Step 4: Commit**

```bash
git add pages/rounds.html
git commit -m "feat: rounds.html — create Supabase round row at round start"
```

---

### Task 4: `pages/hole.html` — sync each hole at hole-end, complete the round

**Files:**
- Modify: `pages/hole.html`

**Interfaces:**
- Consumes: `TcRounds.syncHole(...)`, `TcRounds.completeRound()`, `TcRounds.drainPendingSyncs()` from Task 2.
- Consumes existing module state: `hLoggedShots` (array of `{latlng:{lat,lng}, svgId, ...}`, one entry per confirmed shot), `hShotLog` (array of `{num, club, yds, holed}`, one entry per confirmed shot, same order/length as `hLoggedShots`), `hShotCount`, `PAR`, `_holeNum`, `_holeData`, `_round`, `_holeIdx`, `_isLastHole`, `TEE_LL`, `TcCourse.haversineYds`.

- [ ] **Step 1: Add the `tc-rounds.js` script tag**

Find in `pages/hole.html`:
```html
<script src="tc-auth.js"></script>
```

Replace with:
```html
<script src="tc-auth.js"></script>
<script src="tc-rounds.js"></script>
```

- [ ] **Step 2: Hoist `togState` out of `buildSummaryMap` so `hSaveAndNext` can read FIR/GIR toggle state**

Find (inside `buildSummaryMap`):
```js
  // Stats chips from toggle row state
  function togState(rowEl) {
    if (!rowEl) return null;
    const togs = [...rowEl.querySelectorAll('.tog')];
    const i = togs.findIndex(t => t.classList.contains('t-g') || t.classList.contains('t-y') || t.classList.contains('t-r'));
    if (i === -1) return null;
    const color = togs[i].classList.contains('t-g') ? 'g' : togs[i].classList.contains('t-y') ? 'y' : 'r';
    return { idx: i, color };
  }

  const firLabels = ['FIR', 'Missed L', 'Missed R', 'Bunker'];
```

Replace with:
```js
  const firLabels = ['FIR', 'Missed L', 'Missed R', 'Bunker'];
```

Then find the start of `buildSummaryMap` itself:
```js
function buildSummaryMap() {
```

And insert this new top-level function immediately **before** it (outside and above `buildSummaryMap`, so both it and `hSaveAndNext` can call it):
```js
function togState(rowEl) {
  if (!rowEl) return null;
  const togs = [...rowEl.querySelectorAll('.tog')];
  const i = togs.findIndex(t => t.classList.contains('t-g') || t.classList.contains('t-y') || t.classList.contains('t-r'));
  if (i === -1) return null;
  const color = togs[i].classList.contains('t-g') ? 'g' : togs[i].classList.contains('t-y') ? 'y' : 'r';
  return { idx: i, color };
}

function buildSummaryMap() {
```

- [ ] **Step 3: Add a shots-payload builder**

Find:
```js
function hSaveAndNext() {
```

Insert this new function immediately **before** it:
```js
function buildShotsPayload() {
  return hLoggedShots.map((pos, i) => {
    const log = hShotLog[i] || {};
    const prev = i > 0 ? hLoggedShots[i - 1] : null;
    const fromLL = prev?.latlng ?? TEE_LL;
    const distanceYards = pos.latlng
      ? Math.round(TcCourse.haversineYds(fromLL, pos.latlng) * 10) / 10
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

function hSaveAndNext() {
```

- [ ] **Step 4: Sync the hole and complete the round at the hole-end transition**

Find:
```js
function hSaveAndNext() {
  const scores = (() => { try { return JSON.parse(sessionStorage.getItem('tc_round_scores') || '[]'); } catch { return []; } })();
  const updated = scores.filter(s => s.hole !== _holeNum);
  updated.push({ hole: _holeNum, par: PAR, strokes: hShotCount });
  sessionStorage.setItem('tc_round_scores', JSON.stringify(updated));

  if (_isLastHole || !_round) {
    window.location.href = 'scorecard.html';
    return;
  }
  _round.currentHoleIdx = _holeIdx + 1;
  sessionStorage.setItem('tc_active_round', JSON.stringify(_round));
  navigate('hole');
}
```

Replace with:
```js
function hSaveAndNext() {
  const scores = (() => { try { return JSON.parse(sessionStorage.getItem('tc_round_scores') || '[]'); } catch { return []; } })();
  const updated = scores.filter(s => s.hole !== _holeNum);
  updated.push({ hole: _holeNum, par: PAR, strokes: hShotCount });
  sessionStorage.setItem('tc_round_scores', JSON.stringify(updated));

  const firSt = PAR === 3 ? null : togState(document.getElementById('trow-fir'));
  const girSt = togState(document.getElementById('trow-green'));
  const upAndDown = (PAR !== 3 && girSt && girSt.idx !== 0) ? (girSt.idx === 2 || girSt.idx === 3) : null;

  TcRounds.syncHole({
    holeNumber: _holeNum,
    par: PAR,
    handicap: _holeData?.handicap ?? null,
    strokes: hShotCount,
    putts: Math.max(0, hShotLog.filter(s => s.club === 'Putter' || s.holed).length),
    fir: firSt ? firSt.idx === 0 : null,
    gir: girSt ? girSt.idx === 0 : null,
    upAndDown,
    shots: buildShotsPayload()
  }).catch(err => console.error('TcRounds: syncHole failed unexpectedly', err));

  if (_isLastHole || !_round) {
    TcRounds.completeRound().catch(err => console.error('TcRounds: completeRound failed unexpectedly', err));
    window.location.href = 'scorecard.html';
    return;
  }
  _round.currentHoleIdx = _holeIdx + 1;
  sessionStorage.setItem('tc_active_round', JSON.stringify(_round));
  navigate('hole');
}
```

- [ ] **Step 5: Attempt to drain any stuck pending syncs on page load**

Find:
```js
/* ── LIVE HEADER DATA — everything here reads from the active hole, nothing is hole-specific hardcoding ── */
(function initHeader() {
```

Replace with:
```js
TcRounds.drainPendingSyncs();

/* ── LIVE HEADER DATA — everything here reads from the active hole, nothing is hole-specific hardcoding ── */
(function initHeader() {
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

- [ ] **Step 7: Manual browser verification — happy path**

With `pages/` served locally (e.g. `python -m http.server 8931` from inside `pages/`) and signed in: play a full round through `rounds.html` → `hole.html` for a course with real hole data, confirming several shots and club picks per hole through to hole-out, for at least 3 holes including the final hole of the round.

Expected: no visible errors during play; the browser devtools console shows no `TcRounds:` error logs; after the final hole, the page navigates to `scorecard.html` as before.

- [ ] **Step 8: Manual browser verification — offline hole**

With devtools open, start a round, play hole 1 normally, then enable devtools' offline mode (Network tab → Offline) before confirming hole 1's score. Confirm the hole-out flow completes without any visible error or delay. Disable offline mode, then confirm hole 2.

Expected: hole 1 confirms and hole 2 confirms with no visible difference in behavior from Step 7. Check the Supabase dashboard's Table Editor after both holes are confirmed: both hole 1 and hole 2 should have a row in `hole_results` (hole 1's synced once connectivity returned, either via the `online` listener or via hole 2's own `syncHole` call draining the queue first).

- [ ] **Step 9: Commit**

```bash
git add pages/hole.html
git commit -m "feat: hole.html — sync hole results/shots to Supabase at hole-end, complete round on last hole"
```

---

### Task 5: `pages/courses.html` — read real rounds instead of the mock array

**Files:**
- Modify: `pages/courses.html`

**Interfaces:**
- Consumes: `TcRounds.fetchUserRounds()` from Task 2, which already returns objects in the exact shape this file's `ROUNDS` array used to be hardcoded with (`id, course, date, month, tee, type, score, gross, diff, fir, gir, putts, up_down, sg, holes, pars, chips`), except `diff` and `sg` are always `null` for now.

- [ ] **Step 1: Add the `tc-rounds.js` script tag**

Find:
```html
<script src="tc-auth.js"></script>
<script src="tc-utils.js"></script>
```

Replace with:
```html
<script src="tc-auth.js"></script>
<script src="tc-rounds.js"></script>
<script src="tc-utils.js"></script>
```

- [ ] **Step 2: Add `id` attributes to the season-summary cells**

Find:
```html
  <div class="ssummary">
    <div class="ssum-cell">
      <div class="ssum-val" style="color:var(--green);">12</div>
      <div class="ssum-lbl">Rounds</div>
    </div>
    <div class="ssum-cell">
      <div class="ssum-val" style="color:var(--green);">+0.4</div>
      <div class="ssum-lbl">Scr Avg</div>
    </div>
    <div class="ssum-cell">
      <div class="ssum-val" style="color:var(--green);">+1.8</div>
      <div class="ssum-lbl">Handicap</div>
    </div>
    <div class="ssum-cell">
      <div class="ssum-val" style="color:var(--gold);">-5</div>
      <div class="ssum-lbl">Low Rd</div>
    </div>
  </div>
```

Replace with:
```html
  <div class="ssummary">
    <div class="ssum-cell">
      <div class="ssum-val" id="ssum-rounds" style="color:var(--green);">—</div>
      <div class="ssum-lbl">Rounds</div>
    </div>
    <div class="ssum-cell">
      <div class="ssum-val" id="ssum-scravg" style="color:var(--green);">—</div>
      <div class="ssum-lbl">Scr Avg</div>
    </div>
    <div class="ssum-cell">
      <div class="ssum-val" id="ssum-hcp" style="color:var(--green);">—</div>
      <div class="ssum-lbl">Handicap</div>
    </div>
    <div class="ssum-cell">
      <div class="ssum-val" id="ssum-lowrd" style="color:var(--gold);">—</div>
      <div class="ssum-lbl">Low Rd</div>
    </div>
  </div>
```

- [ ] **Step 3: Replace the hardcoded `ROUNDS` array**

Find the entire block starting with `const ROUNDS = [` and ending with the matching `];` (12 hardcoded round objects, roughly lines 311–460 — locate it via the `/* ══ ROUND DATA ══ */` comment immediately above it).

Replace the whole `const ROUNDS = [ ... ];` block with:
```js
let ROUNDS = [];
```

- [ ] **Step 4: Add `escHtml` and a `loadRounds`/`renderSeasonSummary` pair**

Find:
```js
(async () => { await TcAuth.requireAuth(); })();
```

Replace with:
```js
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtToPar(n) { return n === 0 ? 'E' : n > 0 ? '+' + n : String(n); }

function renderSeasonSummary() {
  document.getElementById('ssum-rounds').textContent = String(ROUNDS.length);
  document.getElementById('ssum-hcp').textContent = '—'; // needs the WHS handicap engine (future sub-project)

  const scravgEl = document.getElementById('ssum-scravg');
  const lowrdEl  = document.getElementById('ssum-lowrd');
  if (ROUNDS.length === 0) {
    scravgEl.textContent = '—';
    lowrdEl.textContent  = '—';
    return;
  }
  const avgScore = ROUNDS.reduce((a, r) => a + r.score, 0) / ROUNDS.length;
  scravgEl.textContent = fmtToPar(Math.round(avgScore * 10) / 10);
  const low = ROUNDS.reduce((a, b) => a.score < b.score ? a : b);
  lowrdEl.textContent = fmtToPar(low.score);
}

async function loadRounds() {
  const fetched = await TcRounds.fetchUserRounds();
  ROUNDS = fetched === null ? [] : fetched;
}

(async () => {
  await TcAuth.requireAuth();
  await loadRounds();
  buildFilters();
  renderRounds(String(new Date().getFullYear()), '');
  renderInsights();
  renderSeasonSummary();
})();
```

- [ ] **Step 5: Remove the old synchronous init calls (now run inside the async block above)**

Find:
```js
/* ══ INIT ══ */
buildFilters();
renderRounds('2026', '');
renderInsights();
```

Replace with:
```js
/* ══ INIT — see the async IIFE above, which loads real data before rendering ══ */
```

- [ ] **Step 6: Escape course/tee/type in the round card template**

Find:
```js
        <div class="rc-course">
          <div class="rc-name">${r.course}</div>
          <div class="rc-tee">${r.tee} · ${r.type}</div>
        </div>
```

Replace with:
```js
        <div class="rc-course">
          <div class="rc-name">${escHtml(r.course)}</div>
          <div class="rc-tee">${escHtml(r.tee)} · ${escHtml(r.type)}</div>
        </div>
```

- [ ] **Step 7: Guard the null `diff` in the round card chip**

Find:
```js
        <div class="rc-chip" style="color:${parseFloat(r.diff) <= 1 ? 'var(--green)' : parseFloat(r.diff) <= 2 ? '#E67E22' : 'var(--red)'}">Diff ${r.diff}</div>
```

Replace with:
```js
        <div class="rc-chip" style="color:${r.diff == null ? 'var(--muted)' : parseFloat(r.diff) <= 1 ? 'var(--green)' : parseFloat(r.diff) <= 2 ? '#E67E22' : 'var(--red)'}">Diff ${r.diff == null ? '—' : r.diff}</div>
```

- [ ] **Step 8: Guard the null `diff` in the round-detail score hero**

Find:
```js
      <div class="sh-main">
        <div class="sh-val" style="color:${parseFloat(r.diff) <= 1 ? 'var(--green)' : parseFloat(r.diff) <= 2 ? '#E67E22' : 'var(--red)'};">${r.diff}</div>
        <div class="sh-lbl">DIFF</div>
      </div>
```

Replace with:
```js
      <div class="sh-main">
        <div class="sh-val" style="color:${r.diff == null ? 'var(--muted)' : parseFloat(r.diff) <= 1 ? 'var(--green)' : parseFloat(r.diff) <= 2 ? '#E67E22' : 'var(--red)'};">${r.diff == null ? '—' : r.diff}</div>
        <div class="sh-lbl">DIFF</div>
      </div>
```

- [ ] **Step 9: Skip the "IN" half of the scorecard for 9-hole rounds**

Find:
```js
  const cardHTML = `
    <div class="sc-grid" style="font-size:10px;">${makeHalf(0,9,'OUT')}${makeHalf(9,18,'IN')}</div>`;
```

Replace with:
```js
  const cardHTML = `
    <div class="sc-grid" style="font-size:10px;">${makeHalf(0,9,'OUT')}${pars.length > 9 ? makeHalf(9,18,'IN') : ''}</div>`;
```

- [ ] **Step 10: Guard Strokes Gained tab for `sg: null`**

Find:
```js
function renderRdSG(body) {
  const r = activeRound;
  const sg = r.sg;

  function sgBar(lbl, val) {
```

Replace with:
```js
function renderRdSG(body) {
  const r = activeRound;
  const sg = r.sg;

  if (!sg) {
    body.innerHTML = `
      <div style="text-align:center;padding:32px 16px;color:var(--muted);font-size:12px;">
        Strokes Gained isn't available yet for this round.<br>Coming in a future update.
      </div>`;
    return;
  }

  function sgBar(lbl, val) {
```

- [ ] **Step 11: Guard Course Insights for zero rounds**

Find:
```js
/* ══ COURSE INSIGHTS ══ */
function renderInsights() {
  // Most played course
  const counts = {};
  ROUNDS.forEach(r => { counts[r.course] = (counts[r.course] || 0) + 1; });
  const mostCourse = Object.entries(counts).sort((a,b) => b[1]-a[1])[0];

  // Lowest score course (best score to par)
  const best = ROUNDS.reduce((a, b) => a.score < b.score ? a : b);

  document.getElementById('ci-most-course').textContent = mostCourse[0];
  document.getElementById('ci-most-sub').textContent    = mostCourse[1] + ' rounds played';

  const sp = scoreToPar(best.score);
  const spColor = best.score < 0 ? 'var(--green)' : best.score === 0 ? '#fff' : '#E67E22';
  document.getElementById('ci-best-course').textContent = best.course;
  document.getElementById('ci-best-sub').innerHTML      =
    `<span style="color:${spColor};font-weight:800;">${sp.str}</span> · ${best.date}`;
}
```

Replace with:
```js
/* ══ COURSE INSIGHTS ══ */
function renderInsights() {
  if (ROUNDS.length === 0) {
    document.getElementById('ci-most-course').textContent = '—';
    document.getElementById('ci-most-sub').textContent    = 'No rounds yet';
    document.getElementById('ci-best-course').textContent = '—';
    document.getElementById('ci-best-sub').innerHTML      = '<span style="color:var(--muted);">—</span>';
    return;
  }

  // Most played course
  const counts = {};
  ROUNDS.forEach(r => { counts[r.course] = (counts[r.course] || 0) + 1; });
  const mostCourse = Object.entries(counts).sort((a,b) => b[1]-a[1])[0];

  // Lowest score course (best score to par)
  const best = ROUNDS.reduce((a, b) => a.score < b.score ? a : b);

  document.getElementById('ci-most-course').textContent = mostCourse[0];
  document.getElementById('ci-most-sub').textContent    = mostCourse[1] + ' rounds played';

  const sp = scoreToPar(best.score);
  const spColor = best.score < 0 ? 'var(--green)' : best.score === 0 ? '#fff' : '#E67E22';
  document.getElementById('ci-best-course').textContent = best.course;
  document.getElementById('ci-best-sub').innerHTML      =
    `<span style="color:${spColor};font-weight:800;">${sp.str}</span> · ${best.date}`;
}
```

- [ ] **Step 12: Verify syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('pages/courses.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```
Expected: every block reports `OK`.

- [ ] **Step 13: Manual browser verification**

With `pages/` served locally and signed in as the account used in Task 4's verification (which has at least one completed round by now): open `courses.html`.

Expected:
1. The just-played round(s) from Task 4 appear as real round cards (not the old 12 mock entries), with correct course name, score, gross, per-hole scorecard grid, FIR%/GIR%/putts.
2. Tapping the round opens the detail overlay; the Strokes Gained tab shows the "not available yet" placeholder instead of crashing.
3. The "Diff" chip and score-hero DIFF stat show `—` instead of a fabricated number.
4. Season summary shows the real rounds count, real Scr Avg, real Low Rd, and `—` for Handicap.
5. Sign in as a brand-new account with zero rounds (or manually mark all rounds `in_progress` for a test account via the Supabase dashboard) and reload `courses.html` — confirm "No rounds found" / "No rounds yet" empty states render without any console error, instead of crashing on the old array-reduce-on-empty-array bug.

- [ ] **Step 14: Commit**

```bash
git add pages/courses.html
git commit -m "feat: courses.html — load real rounds from Supabase instead of mock data"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `rounds`/`hole_results`/`shots` schema, denormalized `user_id`, RLS | Task 1 |
| Round-start insert | Task 3 |
| Hole-end batch insert (hole_results + shots) | Task 4, `TcRounds.syncHole` (Task 2) |
| Round-complete update on last hole | Task 4, `TcRounds.completeRound` (Task 2) |
| Offline retry queue, drain on reconnect + on next hole-end | Task 2 (`drainPendingSyncs`, `online` listener), Task 4 Step 5 (drain on page load) |
| Round-start insert failure doesn't block play; repaired later | Task 2 `ensureRoundId` |
| `courses.html` reads real data, same shape as before | Task 5 |
| `sg`/`diff` stay `null`, UI shows placeholder not fabricated numbers | Task 2 `transformRound`, Task 5 Steps 7/8/10 |
| Empty-state instead of reverting to mock data on fetch failure | Task 5 Step 4 (`fetched === null` → `[]`, same empty-state path as zero rounds) |
| RLS verification (second account can't read first account's data) | Task 1 Step 3 note covers table existence; cross-account check is a Task 5 Step 13 follow-on the user can run manually in the SQL editor if desired — see note below |

**Note on RLS cross-account verification:** the spec's verification step 5 ("a second test account cannot read the first account's rounds") isn't automatable from this session (no direct DB access) and isn't exercised by the single-account browser walkthrough in Task 5 Step 13. If you want this checked, ask the user to run, in the Supabase SQL Editor while authenticated as a second test user: `select * from rounds;` — expect zero rows returned for any account other than the one that created them.

**Refinements made beyond the spec's schema sketch (both narrower in effect, not contradicting it):**
- Added a `delete` RLS policy on `shots` only (not `rounds`/`hole_results`) — needed internally by `writeHoleResult`'s idempotent resync (delete-then-insert), not a user-facing delete feature.
- Relaxed `hole_results.gir` from `not null` to nullable, matching `fir`'s existing nullability, to avoid a constraint violation in the rare edge case where a hole is confirmed with the green toggle never touched.

**Placeholder scan:** no TBD/TODO; every step has literal code or an exact verification procedure.

**Type consistency:** `TcRounds.syncHole` payload shape (`holeNumber, par, handicap, strokes, putts, fir, gir, upAndDown, shots[]`) is identical between its Task 2 definition and its Task 4 call site. `fetchUserRounds()`'s returned object shape matches every field `courses.html` already reads (`id, course, date, month, tee, type, score, gross, diff, fir, gir, putts, up_down, sg, holes, pars, chips`).
