# Scorecard Photo-Scan + Shared Crowd-Sourced Course Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a golfer photograph a physical scorecard and have Course Rating/Slope (per tee) and per-hole Par/Handicap/Yardage (per tee) automatically extracted and saved to a new shared Supabase table, so any golfer who later plays that course benefits without re-entering or re-scanning.

**Architecture:** A new Supabase Edge Function calls Anthropic's Claude vision API to read the photo and return structured JSON. A new shared `course_data` table (keyed by the existing `geoKey` course-identity convention) stores the result, with every write going through a read-merge-write helper module so a partial scan never erases another tee's/hole's already-good data. A new page handles capture and a mandatory review/edit screen before saving. The existing manual Rating/Slope entry form is unified to write into the same shared table instead of only `localStorage`.

**Tech Stack:** Plain HTML/JS (no build step), Supabase JS client + a new Supabase Edge Function (Deno), Anthropic's Messages API (vision).

## Global Constraints

- The API key (`ANTHROPIC_API_KEY`) must never be exposed client-side — only the Edge Function calls Anthropic, set via `supabase secrets set`.
- Every write to `course_data` must **read-merge-write**, never blind-overwrite — a scan covering only some tees/holes must not erase another tee's/hole's already-good data from an earlier scan or manual entry.
- The Edge Function must return `null` for anything not legible/visible on the card — never guess or fabricate a value. A photo with no recognizable scorecard grid returns `{ok:false, reason:'no_scorecard_detected'}`, never a fabricated shape.
- A review/edit screen is mandatory before anything saves — the AI's raw reading is never trusted silently.
- Merge priority when both OSM and shared/scanned data exist for the same hole: **OSM's own `par`/`handicap` win whenever present**; the shared table only fills gaps OSM has nothing for.
- `course_data.rating_slope` is keyed by **tee display name** (`"Black"`, `"Blue"`, `"White"`, `"Gold"`, `"Red"`) to match the pre-existing cache-key convention `pages/tc-handicap.js` already uses (`sel.tee.name`, not `sel.tee.key`) — do not "fix" this into canonical keys, it must match the existing call sites exactly.
- `course_data.holes[].yardage` is keyed by **canonical tee key** (`tips`/`gold`/`blue`/`white`/`red`) to match `TEE_CANONICAL`'s `.key` field and `tc-course.js`'s own per-hole `tees` shape — this is genuinely new data with no pre-existing name-based convention to preserve.
- A scan only ever populates the full-18 Rating/Slope entry (`which9 = '18'`), never `front9`/`back9` splits — a printed scorecard's rating/slope can't be reliably attributed to a 9-hole split from a photo. This mirrors the existing limitation that manual entry already has (front9/back9 ratings must be entered separately per round).
- No automated test suite exists in this codebase — every task's verification is a manual browser check or a direct CLI/curl smoke test.

---

### Task 1: Migration — `course_data` table

**Files:**
- Create: `supabase/migrations/0007_add_course_data.sql`

**Interfaces:**
- Produces: `public.course_data` table (`geo_key text primary key, course_name text, rating_slope jsonb, holes jsonb, source text, updated_by uuid, updated_at timestamptz, created_at timestamptz`) — consumed by Task 2.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0007_add_course_data.sql

-- Shared, crowd-sourced course data: Course Rating/Slope per tee, and
-- per-hole Par/Handicap/Yardage per tee — populated by manual entry or a
-- scorecard photo scan. Keyed by the same geoKey (TcCourse.geoKeyFor)
-- already used as the de facto course-identity key everywhere else in
-- this app. Conflict model is whole-row last-write-wins with an audit
-- trail (source/updated_by/updated_at) — every write must read-merge-write
-- rather than blind-overwrite, enforced in pages/tc-course-data.js, not here.
create table public.course_data (
  geo_key       text primary key,
  course_name   text,
  rating_slope  jsonb not null default '{}'::jsonb,
  holes         jsonb not null default '[]'::jsonb,
  source        text not null default 'manual' check (source in ('manual','scan')),
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

alter table public.course_data enable row level security;

create policy "authenticated users read course_data"
  on public.course_data for select
  to authenticated
  using (true);

create policy "authenticated users insert course_data"
  on public.course_data for insert
  to authenticated
  with check (true);

create policy "authenticated users update course_data"
  on public.course_data for update
  to authenticated
  using (true);
```

- [ ] **Step 2: Run the migration against the live Supabase project**

```bash
supabase db push --dry-run --include-all
```
Expected: `Would push these migrations: • 0007_add_course_data.sql`

```bash
supabase db push --include-all
```
Expected: `Finished supabase db push.`

Verify:
```bash
echo "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='course_data' order by ordinal_position;" | supabase db query --linked
```
Expected: 8 rows matching the columns above.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0007_add_course_data.sql
git commit -m "feat: add course_data table for shared course rating/slope/par/handicap"
```

---

### Task 2: `pages/tc-course-data.js` — shared course data module

**Files:**
- Create: `pages/tc-course-data.js`

**Interfaces:**
- Consumes: `TcAuth.client`, `TcAuth.getSession()` (from `tc-auth.js`, already loaded), `course_data` table from Task 1.
- Produces: `window.TcCourseData` with `getRatingSlope(geoKey, teeName, which9)`, `saveRatingSlope(geoKey, teeName, which9, {rating,slope}, {source,courseName})`, `saveHoles(geoKey, holesPatch, {source,courseName})`, `getCourseData(geoKey)` — consumed by Task 3 and Task 6.

- [ ] **Step 1: Write the module**

```js
/* tc-course-data.js — Shared, crowd-sourced course data (Course Rating/Slope
   per tee, per-hole Par/Handicap/Yardage per tee) stored in Supabase's
   course_data table, keyed by TcCourse.geoKeyFor(lat,lng). Every write here
   reads the current row first and deep-merges onto it — never a blind
   overwrite — since a scan that only covers some tees/holes must not erase
   another tee's/hole's already-good data from an earlier scan or manual
   entry. Requires tc-auth.js to be loaded first. */
window.TcCourseData = (() => {
  async function fetchRow(geoKey) {
    const { data, error } = await TcAuth.client
      .from('course_data')
      .select('*')
      .eq('geo_key', geoKey)
      .maybeSingle();
    if (error) { console.error('TcCourseData: failed to fetch', error); return null; }
    return data;
  }

  // teeName is the tee's display name ("Black","Blue","White","Gold","Red")
  // — matches the pre-existing cache-key convention tc-handicap.js already
  // uses, not the canonical key ("tips" etc).
  async function getRatingSlope(geoKey, teeName, which9) {
    const row = await fetchRow(geoKey);
    return row?.rating_slope?.[teeName]?.[which9] ?? null;
  }

  async function saveRatingSlope(geoKey, teeName, which9, { rating, slope }, { source = 'manual', courseName = null } = {}) {
    const session = await TcAuth.getSession();
    if (!session) return;
    const existing = await fetchRow(geoKey);
    const ratingSlope = { ...(existing?.rating_slope || {}) };
    ratingSlope[teeName] = { ...(ratingSlope[teeName] || {}), [which9]: { rating, slope } };
    const { error } = await TcAuth.client.from('course_data').upsert({
      geo_key: geoKey,
      course_name: courseName ?? existing?.course_name ?? null,
      rating_slope: ratingSlope,
      holes: existing?.holes ?? [],
      source,
      updated_by: session.user.id,
      updated_at: new Date().toISOString()
    }, { onConflict: 'geo_key' });
    if (error) console.error('TcCourseData: failed to save rating/slope', error);
  }

  // holesPatch: [{ number, par, handicap, yardage: { canonicalTeeKey: yds, ... } }, ...]
  // Only the fields actually present in each patch entry are merged onto the
  // existing hole (par/handicap only overwritten when non-null; yardage
  // merged key-by-key) — holes/tee-keys not included in holesPatch are left
  // exactly as they were.
  async function saveHoles(geoKey, holesPatch, { source = 'manual', courseName = null } = {}) {
    const session = await TcAuth.getSession();
    if (!session) return;
    const existing = await fetchRow(geoKey);
    const merged = (existing?.holes || []).slice();
    for (const patch of holesPatch) {
      let hole = merged.find(h => h.number === patch.number);
      if (!hole) {
        hole = { number: patch.number, par: null, handicap: null, yardage: {} };
        merged.push(hole);
      }
      if (patch.par != null) hole.par = patch.par;
      if (patch.handicap != null) hole.handicap = patch.handicap;
      if (patch.yardage) hole.yardage = { ...(hole.yardage || {}), ...patch.yardage };
    }
    merged.sort((a, b) => a.number - b.number);
    const { error } = await TcAuth.client.from('course_data').upsert({
      geo_key: geoKey,
      course_name: courseName ?? existing?.course_name ?? null,
      rating_slope: existing?.rating_slope ?? {},
      holes: merged,
      source,
      updated_by: session.user.id,
      updated_at: new Date().toISOString()
    }, { onConflict: 'geo_key' });
    if (error) console.error('TcCourseData: failed to save holes', error);
  }

  async function getCourseData(geoKey) {
    return fetchRow(geoKey);
  }

  return { getRatingSlope, saveRatingSlope, saveHoles, getCourseData };
})();
```

- [ ] **Step 2: Syntax check**

```bash
node -e "
const fs = require('fs');
new Function(fs.readFileSync('pages/tc-course-data.js', 'utf8'));
console.log('OK');
"
```
Expected: `OK`.

- [ ] **Step 3: Manual verification**

With `pages/` served locally and signed in, open the browser console on any page that loads `tc-auth.js` + this new file, and run:
```js
await TcCourseData.saveHoles('99.999_-99.999', [{number:1, par:4, handicap:7, yardage:{blue:380}}], {source:'manual', courseName:'Test Course'});
await TcCourseData.getCourseData('99.999_-99.999');
```
Expected: the second call returns a row with `holes: [{number:1, par:4, handicap:7, yardage:{blue:380}}]`. Then run:
```js
await TcCourseData.saveHoles('99.999_-99.999', [{number:2, par:5, handicap:3, yardage:{white:520}}], {source:'scan'});
await TcCourseData.getCourseData('99.999_-99.999');
```
Expected: the row now has **both** hole 1 and hole 2 — confirms read-merge-write, not overwrite. Clean up by deleting the test row from Supabase Studio afterward.

- [ ] **Step 4: Commit**

```bash
git add pages/tc-course-data.js
git commit -m "feat: add tc-course-data.js shared course data module"
```

---

### Task 3: Unify manual Rating/Slope entry with the shared table

**Files:**
- Modify: `pages/tc-handicap.js`
- Modify: `pages/rounds.html`

**Interfaces:**
- Consumes: `TcCourseData.getRatingSlope`/`saveRatingSlope` from Task 2.
- Produces: `TcHandicap.getRatingSlope`/`saveRatingSlope` become `async` — the exact same function names, now returning Promises. `rounds.html`'s two call sites are the only other place in the codebase that call them.

- [ ] **Step 1: Async-ify `tc-handicap.js`'s rating/slope functions**

Find:
```js
/* tc-handicap.js — Course Rating/Slope cache (localStorage, mirrors the
   manual tee/green marking pattern in tc-course.js but its own namespace)
   plus the WHS handicap math: Net Double Bogey ESC, Score Differential,
   9-hole pairing, and rolling index averaging. No Supabase dependency —
   pure functions plus localStorage only. */
```

Replace:
```js
/* tc-handicap.js — Course Rating/Slope now reads/writes the shared
   Supabase course_data table (via tc-course-data.js), with localStorage
   as a same-device fallback cache if the shared read fails (e.g. offline).
   Also has the WHS handicap math: Net Double Bogey ESC, Score
   Differential, 9-hole pairing, and rolling index averaging (still pure
   functions, no Supabase dependency). Requires tc-course-data.js to be
   loaded first. */
```

Find:
```js
  function getRatingSlope(geoKey, teeName, which9) {
    try {
      const raw = localStorage.getItem(cacheKey(geoKey, teeName, which9));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveRatingSlope(geoKey, teeName, which9, { rating, slope }) {
    try { localStorage.setItem(cacheKey(geoKey, teeName, which9), JSON.stringify({ rating, slope })); } catch {}
  }
```

Replace:
```js
  async function getRatingSlope(geoKey, teeName, which9) {
    const shared = await TcCourseData.getRatingSlope(geoKey, teeName, which9);
    if (shared) return shared;
    try {
      const raw = localStorage.getItem(cacheKey(geoKey, teeName, which9));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async function saveRatingSlope(geoKey, teeName, which9, { rating, slope }, opts) {
    try { localStorage.setItem(cacheKey(geoKey, teeName, which9), JSON.stringify({ rating, slope })); } catch {}
    await TcCourseData.saveRatingSlope(geoKey, teeName, which9, { rating, slope }, opts);
  }
```

- [ ] **Step 2: Add `tc-course-data.js` to `rounds.html`'s script includes**

Find:
```html
<script src="tc-rounds.js"></script>
<script src="tc-handicap.js"></script>
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
```

Replace:
```html
<script src="tc-rounds.js"></script>
<script src="tc-course-data.js"></script>
<script src="tc-handicap.js"></script>
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
```

- [ ] **Step 3: Await the two call sites in `rounds.html`**

Find:
```js
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
```

Replace:
```js
async function updateRatingSlopePrompt() {
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
  const cached = await TcHandicap.getRatingSlope(geoKey, sel.tee.name, which9);
  if (cached) {
    sel.ratingSlope = cached;
    wrap.innerHTML = `<div class="rd-sec-sub">Rating ${cached.rating} · Slope ${cached.slope} <span onclick="showRatingSlopeForm()" style="color:var(--green);cursor:pointer;">Edit</span></div>`;
    reCalcHandicap();
    return;
  }

  sel.ratingSlope = null;
  showRatingSlopeForm();
}
```

Find:
```js
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

Replace:
```js
  window.saveRatingSlopeEntry = async function saveRatingSlopeEntry() {
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
    await TcHandicap.saveRatingSlope(geoKey, sel.tee.name, sel.which9, { rating, slope }, { source: 'manual', courseName: sel.course?.name });
    sel.ratingSlope = { rating, slope };
    const wrap = document.getElementById('rd-rating-wrap');
    wrap.innerHTML = `<div class="rd-sec-sub">Rating ${rating} · Slope ${slope} <span onclick="showRatingSlopeForm()" style="color:var(--green);cursor:pointer;">Edit</span></div>`;
    reCalcHandicap();
    document.getElementById('setup-next-btn').disabled = !canAdvance();
  };
```

- [ ] **Step 4: Syntax check**

```bash
node -e "
const fs = require('fs');
new Function(fs.readFileSync('pages/tc-handicap.js', 'utf8'));
console.log('tc-handicap.js OK');
const content = fs.readFileSync('pages/rounds.html', 'utf8');
const scripts = [...content.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('rounds.html block', i, 'OK'); } catch (e) { console.log('rounds.html block', i, 'ERROR:', e.message); } });
"
```
Expected: all `OK`.

- [ ] **Step 5: Manual verification**

Serve locally, sign in, start a new round, pick a course, tee, enter Rating/Slope manually via the existing form → confirm a row appears in `course_data` (Supabase Studio) with `source: 'manual'` and the tee's display name (e.g. `"Blue"`) as a key in `rating_slope`. Reload the wizard (open a new round for the same course/tee) → confirm the Rating/Slope now shows automatically without re-prompting for manual entry.

- [ ] **Step 6: Commit**

```bash
git add pages/tc-handicap.js pages/rounds.html
git commit -m "feat: unify manual Rating/Slope entry with shared course_data table"
```

---

### Task 4: Edge Function infra smoke test

**Files:**
- Create: `supabase/functions/scan-scorecard/index.ts`

**Interfaces:**
- Produces: a deployed, invokable `scan-scorecard` Edge Function (replaced with real logic in Task 5).

This task exists specifically to de-risk deployment/secrets before investing in prompt engineering — this project has never deployed an Edge Function or set a secret before.

- [ ] **Step 1: Write a minimal echo function**

```ts
// supabase/functions/scan-scorecard/index.ts
Deno.serve(async (_req) => {
  return new Response(JSON.stringify({ ok: true, echo: 'scan-scorecard function is deployed and reachable' }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

- [ ] **Step 2: Deploy it**

```bash
supabase functions deploy scan-scorecard
```
Expected: deployment succeeds (no error output).

- [ ] **Step 3: Set the Anthropic API key secret**

Ask the user for their Anthropic API key if you don't already have one available, then:
```bash
supabase secrets set ANTHROPIC_API_KEY=<the key>
supabase secrets list
```
Expected: `ANTHROPIC_API_KEY` appears in the list (value not shown). Never echo the key value into logs, commit messages, or this plan's own progress notes.

- [ ] **Step 4: Invoke it directly to confirm it's reachable**

Get a real user JWT from the browser console (signed in to the app): `(await TcAuth.getSession()).access_token`. Then:
```bash
curl -X POST 'https://<project-ref>.supabase.co/functions/v1/scan-scorecard' \
  -H "Authorization: Bearer <the JWT>" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Expected: `{"ok":true,"echo":"scan-scorecard function is deployed and reachable"}`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/scan-scorecard/index.ts
git commit -m "feat: deploy scan-scorecard edge function (echo smoke test)"
```

---

### Task 5: Edge Function — real Claude vision logic

**Files:**
- Modify: `supabase/functions/scan-scorecard/index.ts`

**Interfaces:**
- Consumes: `ANTHROPIC_API_KEY` secret (from Task 4).
- Produces: `POST /functions/v1/scan-scorecard` accepting `{image_base64, mime_type}`, returning either `{ok:true, course_name, tees_present, rating_slope, holes}` or `{ok:false, error, message, retryable}` — consumed by Task 6.

- [ ] **Step 1: Replace the echo body with the real implementation**

Find:
```ts
// supabase/functions/scan-scorecard/index.ts
Deno.serve(async (_req) => {
  return new Response(JSON.stringify({ ok: true, echo: 'scan-scorecard function is deployed and reachable' }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

Replace:
```ts
// supabase/functions/scan-scorecard/index.ts
//
// Accepts a base64-encoded photo of a golf scorecard, sends it to Claude's
// vision API, and returns structured Course Rating/Slope + per-hole
// Par/Handicap/Yardage data. Never fabricates a number the model couldn't
// actually read — missing/illegible fields come back as null, and a photo
// with no recognizable scorecard grid returns ok:false rather than a
// fabricated shape. Supabase's platform-level JWT verification (the
// project default) already rejects unauthenticated calls before this code
// runs, so there's no separate auth check here.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CANONICAL_TEES = ['tips', 'gold', 'blue', 'white', 'red'];

const PROMPT = `You are reading a photo of a golf course scorecard. Extract every hole's Par, Handicap (stroke index), and Yardage for each tee color shown, plus each tee's Course Rating and Slope Rating if printed on the card.

Map whatever tee color/name labels appear on the card onto exactly these canonical keys: tips (also called Black, Championship, or Tips), gold (also called Gold or Yellow), blue (Blue), white (White), red (Red, also called Forward or Ladies). Only include a canonical key if that tee color actually appears on the card.

Respond with STRICT JSON ONLY, no prose, no markdown code fences, matching exactly this shape:
{
  "ok": true,
  "course_name": string or null,
  "tees_present": [array of canonical tee keys actually visible on the card],
  "rating_slope": { "<tee_key>": { "rating": number or null, "slope": number or null }, ... one entry per tee in tees_present },
  "holes": [ { "number": 1-18, "par": number or null, "handicap": number or null, "yardage": { "<tee_key>": number or null, ... one entry per tee in tees_present } }, ... one entry per hole legible on the card, up to 18 ]
}

If a number is not legible or not printed on the card, use null for it — never guess or estimate a value. If the photo does not show a recognizable golf scorecard grid at all, respond with exactly: {"ok": false, "reason": "no_scorecard_detected"}`;

function clamp(value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return (value >= min && value <= max) ? value : null;
}

function validateAndClamp(parsed) {
  const teesPresent = Array.isArray(parsed.tees_present)
    ? parsed.tees_present.filter((t) => CANONICAL_TEES.includes(t))
    : [];

  const ratingSlope = {};
  for (const tee of teesPresent) {
    const rs = parsed.rating_slope?.[tee] || {};
    ratingSlope[tee] = {
      rating: clamp(rs.rating, 60, 80),
      slope: clamp(rs.slope, 55, 155)
    };
  }

  const holes = Array.isArray(parsed.holes) ? parsed.holes
    .filter((h) => Number.isInteger(h?.number) && h.number >= 1 && h.number <= 18)
    .map((h) => {
      const yardage = {};
      for (const tee of teesPresent) {
        yardage[tee] = clamp(h.yardage?.[tee], 50, 700);
      }
      return {
        number: h.number,
        par: clamp(h.par, 3, 6),
        handicap: clamp(h.handicap, 1, 18),
        yardage
      };
    }) : [];

  return {
    ok: true,
    course_name: typeof parsed.course_name === 'string' ? parsed.course_name : null,
    tees_present: teesPresent,
    rating_slope: ratingSlope,
    holes
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const { image_base64, mime_type } = await req.json();
    if (!image_base64 || typeof image_base64 !== 'string') {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_image', message: 'No image provided.', retryable: false }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    // Base64 is ~4/3 the size of the raw bytes — reject anything whose
    // decoded size would exceed ~8MB, before spending anything on Claude.
    if (image_base64.length > 11_000_000) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_image', message: 'Photo is too large — try a smaller image.', retryable: false }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: 'server_misconfigured', message: 'Scanning is temporarily unavailable.', retryable: true }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime_type || 'image/jpeg', data: image_base64 } },
            { type: 'text', text: PROMPT }
          ]
        }]
      })
    });

    if (!claudeRes.ok) {
      const retryable = claudeRes.status === 429 || claudeRes.status >= 500;
      return new Response(JSON.stringify({ ok: false, error: 'claude_api_error', message: 'Could not analyze the photo right now — please try again.', retryable }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const claudeJson = await claudeRes.json();
    const rawText = claudeJson.content?.[0]?.text || '';

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_response', message: 'Could not read a scorecard in that photo.', retryable: true }),
          { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }
      try { parsed = JSON.parse(match[0]); }
      catch {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_response', message: 'Could not read a scorecard in that photo.', retryable: true }),
          { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }
    }

    if (!parsed.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'no_scorecard_detected', message: 'Could not find a scorecard grid in that photo — try a clearer, straight-on shot.', retryable: true }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const result = validateAndClamp(parsed);
    return new Response(JSON.stringify(result), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

  } catch (_err) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_response', message: 'Something went wrong reading that photo — please try again.', retryable: true }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
});
```

- [ ] **Step 2: Deploy**

```bash
supabase functions deploy scan-scorecard
```

- [ ] **Step 3: Test with a real scorecard photo**

Find or take a real photo of a golf scorecard, base64-encode it, and invoke:
```bash
BASE64=$(base64 -w0 /path/to/scorecard.jpg)
curl -X POST 'https://<project-ref>.supabase.co/functions/v1/scan-scorecard' \
  -H "Authorization: Bearer <a real JWT>" \
  -H "Content-Type: application/json" \
  -d "{\"image_base64\":\"$BASE64\",\"mime_type\":\"image/jpeg\"}"
```
Expected: `ok:true` with a plausible `tees_present`, `rating_slope`, and `holes` array. Confirm Rating is in 60-80, Slope in 55-155, Par in 3-6, Handicap in 1-18 for every populated value.

Then test with a photo of something that is NOT a scorecard (e.g. a random object): expected `ok:false, error:'no_scorecard_detected'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/scan-scorecard/index.ts
git commit -m "feat: implement real Claude vision scorecard extraction"
```

---

### Task 6: `pages/scan-scorecard.html` — capture and review UI

**Files:**
- Create: `pages/scan-scorecard.html`

**Interfaces:**
- Consumes: `TcAuth.client.functions.invoke('scan-scorecard', {body})` (Supabase JS SDK's Edge Function invocation, from `tc-auth.js`), `TcCourse.geoKeyFor` (from `tc-course.js`), `TcHandicap.saveRatingSlope`, `TcCourseData.saveHoles` (from Tasks 2/3), `showToast` (from `tc-utils.js`), `sessionStorage.tc_setup_resume` (read-only here — written/cleared by Task 7's changes to `rounds.html`).
- Produces: nothing consumed by later tasks in this plan.

- [ ] **Step 1: Write the page**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tour Caddie — Scan Scorecard</title>
<link rel="stylesheet" href="tc.css">
<style>
.sc-state { display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden; }
.sc-state.hidden { display:none; }

.sc-nav { display:flex; align-items:center; padding:8px 14px; flex-shrink:0; border-bottom:1px solid var(--border); position:relative; }
.sc-back { display:flex; align-items:center; gap:4px; font-size:13px; font-weight:700; color:var(--green); cursor:pointer; user-select:none; }
.sc-back svg { width:16px; height:16px; }
.sc-ttl { position:absolute; left:50%; transform:translateX(-50%); font-size:14px; font-weight:800; }

.up-body { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:20px 20px 28px; gap:20px; }
.up-zone { width:100%; background:rgba(46,204,113,0.04); border:1.5px dashed rgba(46,204,113,0.3); border-radius:18px; padding:32px 20px; display:flex; flex-direction:column; align-items:center; gap:12px; cursor:pointer; transition:background 0.2s; }
.up-zone:active { background:rgba(46,204,113,0.08); }
.up-icon { width:52px; height:52px; background:rgba(46,204,113,0.12); border-radius:50%; display:flex; align-items:center; justify-content:center; }
.up-icon svg { width:24px; height:24px; stroke:var(--green); }
.up-lbl { font-size:13px; font-weight:700; color:#fff; text-align:center; line-height:1.4; }
.up-sub { font-size:11px; color:var(--muted); text-align:center; }
.up-btns { display:flex; flex-direction:column; gap:8px; width:100%; }
.up-btn { width:100%; padding:13px; border-radius:12px; font-size:14px; font-weight:800; cursor:pointer; font-family:Inter,sans-serif; border:none; }
.up-btn.primary { background:var(--green); color:#000; }
.up-btn.secondary { background:var(--surface); color:#fff; border:1px solid var(--border); }
.up-btn:active { opacity:0.8; }
.up-tips { width:100%; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
.up-tip { display:flex; align-items:flex-start; gap:8px; font-size:11px; color:var(--muted); line-height:1.4; }
.up-tip-dot { width:4px; height:4px; background:var(--green); border-radius:50%; margin-top:5px; flex-shrink:0; }

.proc-body { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:28px 24px; gap:20px; }
.proc-spinner { position:relative; width:72px; height:72px; }
.proc-ring { width:72px; height:72px; border:3px solid rgba(46,204,113,0.15); border-top-color:var(--green); border-radius:50%; animation:spin 0.9s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
.proc-hdr { font-size:16px; font-weight:800; text-align:center; letter-spacing:-0.3px; }
.proc-sub { font-size:12px; color:var(--muted); text-align:center; }

.rv-scroller { flex:1; overflow-y:auto; overflow-x:hidden; scrollbar-width:none; min-height:0; padding-bottom:12px; }
.rv-scroller::-webkit-scrollbar { display:none; }
.rv-sec { padding:12px 16px 6px; font-size:9px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--muted); }

.rs-strip { display:flex; gap:8px; padding:0 12px; overflow-x:auto; scrollbar-width:none; }
.rs-strip::-webkit-scrollbar { display:none; }
.rs-card { flex-shrink:0; width:120px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:10px; }
.rs-tee-name { font-size:12px; font-weight:800; margin-bottom:6px; }
.rs-field { display:flex; align-items:center; justify-content:space-between; margin-top:4px; }
.rs-field span { font-size:9px; color:var(--muted); font-weight:700; }
.rs-field input { width:56px; background:var(--surface2,#1e1e2e); border:1px solid var(--border); border-radius:6px; padding:3px 5px; font-size:11px; color:#fff; font-family:Inter,sans-serif; text-align:right; }

.rv-table-wrap { margin:8px 12px 0; overflow-x:auto; border:1px solid var(--border); border-radius:12px; }
.rv-table { width:100%; border-collapse:collapse; font-size:11px; }
.rv-table th, .rv-table td { padding:6px 8px; text-align:center; border-bottom:1px solid rgba(255,255,255,0.04); white-space:nowrap; }
.rv-table th { font-size:9px; font-weight:700; color:var(--muted); text-transform:uppercase; background:var(--surface); }
.rv-cell { width:44px; background:transparent; border:1px solid transparent; border-radius:5px; padding:3px; font-size:11px; color:#fff; font-family:Inter,sans-serif; text-align:center; }
.rv-cell.empty { background:rgba(241,196,15,0.1); border-color:rgba(241,196,15,0.3); }
.rv-cell:focus { border-color:rgba(46,204,113,0.5); outline:none; }

.rv-save { padding:12px; flex-shrink:0; }
.rv-save-btn { width:100%; background:var(--green); border:none; border-radius:12px; padding:14px; font-size:15px; font-weight:900; color:#000; cursor:pointer; font-family:Inter,sans-serif; letter-spacing:-0.2px; }
.rv-save-btn:active { opacity:0.85; }
</style>
</head>
<body>
<div class="wrap" id="wrap" data-page="scan-scorecard">
  <div class="st"><span>9:41</span><span>●●●</span></div>

  <div class="sc-state" id="st-upload">
    <div class="sc-nav">
      <div class="sc-back" onclick="goBack()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </div>
      <div class="sc-ttl">Scan Scorecard</div>
    </div>
    <div class="up-body">
      <div class="up-zone" onclick="document.getElementById('capture-input').click()">
        <div class="up-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </div>
        <div class="up-lbl">Take a photo of the course scorecard</div>
        <div class="up-sub">Lay it flat, good lighting, all tees visible</div>
      </div>
      <div class="up-btns">
        <button class="up-btn primary" onclick="document.getElementById('capture-input').click()">Take Photo</button>
        <button class="up-btn secondary" onclick="document.getElementById('upload-input').click()">Upload from Photos</button>
      </div>
      <div class="up-tips">
        <div class="up-tip"><div class="up-tip-dot"></div>One photo can cover every tee color printed on the card</div>
        <div class="up-tip"><div class="up-tip-dot"></div>You'll be able to review and correct every value before saving</div>
      </div>
    </div>
    <input type="file" accept="image/*" capture="environment" id="capture-input" hidden>
    <input type="file" accept="image/*" id="upload-input" hidden>
  </div>

  <div class="sc-state hidden" id="st-proc">
    <div class="proc-body">
      <div class="proc-spinner"><div class="proc-ring"></div></div>
      <div class="proc-hdr">Reading your scorecard…</div>
      <div class="proc-sub">This can take a few seconds</div>
    </div>
  </div>

  <div class="sc-state hidden" id="st-review">
    <div class="sc-nav">
      <div class="sc-back" onclick="goState('upload')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        Retake
      </div>
      <div class="sc-ttl">Review</div>
    </div>
    <div class="rv-scroller">
      <div class="rv-sec">Rating / Slope</div>
      <div class="rs-strip" id="rs-strip"></div>
      <div class="rv-sec">Par · Handicap · Yardage</div>
      <div class="rv-table-wrap">
        <table class="rv-table">
          <thead><tr id="scan-hole-thead"></tr></thead>
          <tbody id="scan-hole-rows"></tbody>
        </table>
      </div>
    </div>
    <div class="rv-save">
      <button class="rv-save-btn" onclick="saveScan()">Save to Tour Caddie</button>
    </div>
  </div>

  <div class="toast" id="toast"></div>
</div>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js" integrity="sha384-3wY11tldQ5+yWqAvmTN4XtQvnjoTva0cV15O/O/O5NTtp0ivVopSzLOzsVXWZse9" crossorigin="anonymous"></script>
<script src="tc-auth.js"></script>
<script src="tc-course-data.js"></script>
<script src="tc-handicap.js"></script>
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
<script>
(async () => { await TcAuth.requireAuth(); })();

const TEE_LABELS = { tips:'Black', gold:'Gold', blue:'Blue', white:'White', red:'Red' };

let scanResult = null;

function getResumeCourse() {
  try {
    const resume = JSON.parse(sessionStorage.getItem('tc_setup_resume') || 'null');
    return resume?.sel?.course || null;
  } catch { return null; }
}

function getGeoKey() {
  const course = getResumeCourse();
  if (!course?.lat || !course?.lng) return null;
  return TcCourse.geoKeyFor(course.lat, course.lng);
}

function goBack() {
  navigate('rounds');
}

function goState(id) {
  document.querySelectorAll('.sc-state').forEach(s => s.classList.add('hidden'));
  document.getElementById('st-' + id).classList.remove('hidden');
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const maxDim = 2000;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleFile(file) {
  if (!file) return;
  goState('proc');
  try {
    const base64 = await resizeImage(file);
    const { data, error } = await TcAuth.client.functions.invoke('scan-scorecard', {
      body: { image_base64: base64, mime_type: 'image/jpeg' }
    });
    if (error || !data?.ok) {
      showToast('toast', data?.message || 'Could not read that photo — try again.');
      goState('upload');
      return;
    }
    scanResult = data;
    renderReview();
    goState('review');
  } catch {
    showToast('toast', 'Something went wrong — try again.');
    goState('upload');
  }
}

document.getElementById('capture-input').addEventListener('change', (e) => handleFile(e.target.files[0]));
document.getElementById('upload-input').addEventListener('change', (e) => handleFile(e.target.files[0]));

function renderReview() {
  const strip = document.getElementById('rs-strip');
  strip.innerHTML = scanResult.tees_present.map(tee => {
    const rs = scanResult.rating_slope[tee] || {};
    return `<div class="rs-card">
      <div class="rs-tee-name">${TEE_LABELS[tee] || tee}</div>
      <div class="rs-field"><span>Rating</span><input type="number" step="0.1" data-tee="${tee}" data-field="rating" value="${rs.rating ?? ''}" placeholder="—"></div>
      <div class="rs-field"><span>Slope</span><input type="number" data-tee="${tee}" data-field="slope" value="${rs.slope ?? ''}" placeholder="—"></div>
    </div>`;
  }).join('');

  document.getElementById('scan-hole-thead').innerHTML =
    '<th>Hole</th><th>Par</th><th>HCP</th>' +
    scanResult.tees_present.map(tee => `<th>${TEE_LABELS[tee] || tee}</th>`).join('');

  const holes = scanResult.holes.length ? scanResult.holes
    : Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: null, handicap: null, yardage: {} }));

  document.getElementById('scan-hole-rows').innerHTML = holes.map(h => `
    <tr>
      <td>${h.number}</td>
      <td><input type="number" class="rv-cell ${h.par == null ? 'empty' : ''}" data-hole="${h.number}" data-field="par" value="${h.par ?? ''}" placeholder="—"></td>
      <td><input type="number" class="rv-cell ${h.handicap == null ? 'empty' : ''}" data-hole="${h.number}" data-field="handicap" value="${h.handicap ?? ''}" placeholder="—"></td>
      ${scanResult.tees_present.map(tee => `<td><input type="number" class="rv-cell ${h.yardage?.[tee] == null ? 'empty' : ''}" data-hole="${h.number}" data-tee="${tee}" data-field="yardage" value="${h.yardage?.[tee] ?? ''}" placeholder="—"></td>`).join('')}
    </tr>`).join('');
}

async function saveScan() {
  const geoKey = getGeoKey();
  if (!geoKey) { showToast('toast', 'No course selected — go back and pick a course first.'); return; }

  document.querySelectorAll('#rs-strip input').forEach(inp => {
    const tee = inp.dataset.tee, field = inp.dataset.field;
    if (!scanResult.rating_slope[tee]) scanResult.rating_slope[tee] = {};
    scanResult.rating_slope[tee][field] = inp.value === '' ? null : parseFloat(inp.value);
  });

  const holesByNumber = {};
  (scanResult.holes || []).forEach(h => { holesByNumber[h.number] = h; });
  document.querySelectorAll('#scan-hole-rows input').forEach(inp => {
    const num = parseInt(inp.dataset.hole, 10);
    if (!holesByNumber[num]) holesByNumber[num] = { number: num, par: null, handicap: null, yardage: {} };
    const val = inp.value === '' ? null : parseFloat(inp.value);
    if (inp.dataset.field === 'yardage') holesByNumber[num].yardage[inp.dataset.tee] = val;
    else holesByNumber[num][inp.dataset.field] = val;
  });

  for (const tee of scanResult.tees_present) {
    const rs = scanResult.rating_slope[tee];
    if (rs?.rating != null && rs?.slope != null) {
      await TcHandicap.saveRatingSlope(geoKey, TEE_LABELS[tee] || tee, '18', { rating: rs.rating, slope: rs.slope }, { source: 'scan', courseName: scanResult.course_name });
    }
  }
  await TcCourseData.saveHoles(geoKey, Object.values(holesByNumber), { source: 'scan', courseName: scanResult.course_name });

  showToast('toast', 'Saved!');
  setTimeout(() => navigate('rounds'), 800);
}
</script>
</body>
</html>
```

- [ ] **Step 2: Syntax check**

```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('pages/scan-scorecard.html', 'utf8');
const scripts = [...content.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```
Expected: all blocks `OK`.

- [ ] **Step 3: Standalone manual verification**

Serve locally, sign in, manually seed a resume stash in the browser console so this page has a course to attach data to:
```js
sessionStorage.setItem('tc_setup_resume', JSON.stringify({ sel: { course: { name: 'Test Course', lat: 40.7128, lng: -74.0060 } }, stepIdx: 4 }));
```
Then navigate directly to `scan-scorecard.html`. Take/upload a real scorecard photo → confirm the processing animation shows, then the review screen populates with plausible values → edit a field → Save → confirm a `course_data` row appears in Supabase Studio keyed by the geoKey for `(40.7128, -74.0060)`.

- [ ] **Step 4: Commit**

```bash
git add pages/scan-scorecard.html
git commit -m "feat: add scan-scorecard capture and review page"
```

---

### Task 7: `pages/rounds.html` integration + routing

**Files:**
- Modify: `pages/rounds.html`
- Modify: `pages/tc-utils.js`

**Interfaces:**
- Consumes: `pages/scan-scorecard.html` (Task 6), `TcCourseData.getCourseData` (Task 2).
- Produces: nothing consumed by later tasks — this is the final task in the plan.

- [ ] **Step 1: Register the new page in `tc-utils.js`'s routing**

Find:
```js
const ORDER = ['login','home','rounds','stats','courses','profile','scanner','hole'];
const PAGES = { login:'login.html', home:'home.html', rounds:'rounds.html', stats:'stats.html', courses:'courses.html', profile:'profile.html', scanner:'scanner.html', hole:'hole.html' };
```

Replace:
```js
const ORDER = ['login','home','rounds','scan-scorecard','stats','courses','profile','scanner','hole'];
const PAGES = { login:'login.html', home:'home.html', rounds:'rounds.html', 'scan-scorecard':'scan-scorecard.html', stats:'stats.html', courses:'courses.html', profile:'profile.html', scanner:'scanner.html', hole:'hole.html' };
```

- [ ] **Step 2: Add resume-state handling to `openSetup()`**

Find:
```js
function openSetup() {
  stepIdx = 0;
  steps   = MY_SCORE_STEPS;
  Object.assign(sel, { course:null, gameType:null, scoreMode:null, holes:null, tee:null, startHole:1, scoreType:null, date:today(), courseTab:'search' });
  document.getElementById('setup-ov').classList.add('open');
  renderStep();
}
```

Replace:
```js
function openSetup() {
  const resumeRaw = sessionStorage.getItem('tc_setup_resume');
  if (resumeRaw) {
    sessionStorage.removeItem('tc_setup_resume');
    try {
      const resume = JSON.parse(resumeRaw);
      Object.assign(sel, resume.sel);
      stepIdx = resume.stepIdx;
      steps = MY_SCORE_STEPS;
      document.getElementById('setup-ov').classList.add('open');
      renderStep();
      return;
    } catch {}
  }
  stepIdx = 0;
  steps   = MY_SCORE_STEPS;
  Object.assign(sel, { course:null, gameType:null, scoreMode:null, holes:null, tee:null, startHole:1, scoreType:null, date:today(), courseTab:'search' });
  document.getElementById('setup-ov').classList.add('open');
  renderStep();
}

function openScanScorecard() {
  sessionStorage.setItem('tc_setup_resume', JSON.stringify({ sel, stepIdx }));
  navigate('scan-scorecard');
}
```

- [ ] **Step 3: Add the "Scan Scorecard" link near the Rating/Slope prompt**

Find:
```js
    <div class="rd-sec" style="margin-top:18px;">Course Rating / Slope</div>
    <div id="rd-rating-wrap"></div>
```

Replace:
```js
    <div class="rd-sec" style="margin-top:18px;">Course Rating / Slope</div>
    <div id="rd-rating-wrap"></div>
    <div style="margin-top:6px;"><span onclick="openScanScorecard()" style="color:var(--green);cursor:pointer;font-size:11px;font-weight:700;">📷 Scan Scorecard instead</span></div>
```

- [ ] **Step 4: Merge shared `course_data` into `roundData.holes_data` in `startRound()`**

Find:
```js
  if (sel.course?.lat && sel.course?.lng) {
    roundData.geoKey = TcCourse.geoKeyFor(sel.course.lat, sel.course.lng);
    try {
      const data = await TcCourse.loadNear(sel.course.lat, sel.course.lng);
      if (data) roundData.holes_data = data.holes ?? null;
    } catch {}
  }
```

Replace:
```js
  if (sel.course?.lat && sel.course?.lng) {
    roundData.geoKey = TcCourse.geoKeyFor(sel.course.lat, sel.course.lng);
    try {
      const data = await TcCourse.loadNear(sel.course.lat, sel.course.lng);
      if (data) roundData.holes_data = data.holes ?? null;
    } catch {}

    // Merge in shared/scanned course data — OSM's own par/handicap win
    // whenever present; the shared table only fills gaps OSM has nothing
    // for. Yardage always comes from the shared table (OSM's per-hole
    // shape doesn't carry a per-tee yardage number at all).
    try {
      const shared = await TcCourseData.getCourseData(roundData.geoKey);
      if (shared?.holes?.length) {
        const base = roundData.holes_data || Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: null, handicap: null, tees: {}, green: null }));
        roundData.holes_data = base.map(h => {
          const s = shared.holes.find(x => x.number === h.number);
          return {
            ...h,
            par: h.par ?? s?.par ?? null,
            handicap: h.handicap ?? s?.handicap ?? null,
            yardage: s?.yardage?.[roundData.tee] ?? null
          };
        });
      }
    } catch {}
  }
```

- [ ] **Step 5: Syntax check**

```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('pages/rounds.html', 'utf8');
const scripts = [...content.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
const utils = fs.readFileSync('pages/tc-utils.js', 'utf8');
try { new Function(utils); console.log('tc-utils.js OK'); } catch (e) { console.log('tc-utils.js ERROR:', e.message); }
"
```
Expected: all `OK`.

- [ ] **Step 6: Manual end-to-end verification**

1. New round → pick a course with decent OSM coverage → at the round-details step, tap "📷 Scan Scorecard instead" → confirm it navigates to the scan page.
2. Take/upload a real photo → review grid populates → edit a field → Save → confirm it navigates back to `rounds.html`.
3. Confirm the wizard resumed at the round-details step with the same course/tee/holes choices intact (not reset to step 1).
4. Confirm Rating/Slope now shows automatically (no manual-entry prompt) with the scanned value.
5. Continue through the wizard → start the round → confirm `hole.html` shows correct Par/HCP for a few known-legible holes from the scan.
6. Repeat with a course that has zero OSM coverage → confirm the scan alone produces a playable round with real par/handicap instead of the `?? 4`/`null` defaults.
7. Scan the same course again, this time only covering 2 of the tees the card actually has 5 of → confirm the `course_data` row still has all 5 tees' data afterward (read-merge-write, not overwrite).

- [ ] **Step 7: Commit**

```bash
git add pages/rounds.html pages/tc-utils.js
git commit -m "feat: integrate scorecard scan into round-setup wizard"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| New shared `course_data` table, geoKey-keyed, read-merge-write conflict model | Task 1 (schema), Task 2 (`tc-course-data.js` enforces the merge rule) |
| Edge Function calling Claude vision, never fabricating data | Task 4 (infra), Task 5 (real logic + prompt + clamping) |
| Review/edit screen mandatory before saving | Task 6 |
| Unify manual entry with shared table | Task 3 |
| Scan UI on its own page, wizard resumes after | Task 6 (page), Task 7 (resume-state + entry link) |
| Merge priority: OSM wins, shared table fills gaps | Task 7 Step 4 |
| `rating_slope` keyed by tee name, `holes.yardage` keyed by canonical tee key | Task 2, Task 3 (unchanged call-site argument), Task 6 (`TEE_LABELS` mapping), Task 7 (merge uses `roundData.tee`, already a canonical key) |
| Scan only populates full-18 rating/slope, not front9/back9 | Task 6 (`saveScan()` hardcodes `'18'`) |
| Infra smoke test before real logic, since deploy/secrets are new to this project | Task 4 |

**Placeholder scan:** no TBD/TODO; every step has literal code or an exact verification procedure.

**Type consistency:** `TcCourseData`'s `getRatingSlope(geoKey, teeName, which9)`/`saveRatingSlope(geoKey, teeName, which9, {rating,slope}, opts)`/`saveHoles(geoKey, holesPatch, opts)` signatures are used identically everywhere they're called (Task 3's `tc-handicap.js` wrappers, Task 6's `scan-scorecard.html`, Task 7's `startRound()`). The Edge Function's response shape (`{ok, course_name, tees_present, rating_slope, holes}` or `{ok:false, error, message, retryable}`) is produced identically in Task 5 and consumed identically in Task 6. `roundData.tee` (a canonical key, e.g. `'blue'`, set via `sel.tee?.key` — pre-existing, unchanged) is the same key space used to index `holes.yardage` in Task 7's merge, consistent with Task 6's `TEE_LABELS`/canonical-key convention for holes data.
