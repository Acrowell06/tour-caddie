# Scorecard Photo-Scan + Shared Crowd-Sourced Course Data — Design Spec

## Context

Tour Caddie is an HTML/JS/Supabase golf app prototype. Today, starting a round requires manually typing in Course Rating and Slope Rating (a form in `pages/rounds.html`, cached only in `localStorage` on that one device), and per-hole Par/Handicap (stroke-index) come from OpenStreetMap tags when a course happens to be well-mapped — which for stroke-index in particular is often not the case, silently defaulting to `null`/a blanket `par: 4` and quietly weakening the WHS handicap math's Net-Double-Bogey cap.

Every golf course hands out a physical scorecard with all of this data already printed on it. The user wants to take a photo of that scorecard and have the app automatically read it — Course Rating/Slope per tee, and per-hole Par/Handicap/Yardage for every tee color on the card — instead of typing it in or leaving it missing. Since this data describes the *course*, not one golfer's round, the user explicitly wants it saved to a **shared, crowd-sourced Supabase table** so any golfer who later plays that course benefits from a scan someone else already did, rather than a purely per-device cache.

This is the first time this project has needed: a paid external AI API call, a Supabase Edge Function (serverless compute — previously the app was pure static HTML/JS talking directly to Postgres/Auth), and a writable table shared across all users rather than scoped to one person's own data.

## Scope

**In scope:**
- A new shared `course_data` table storing Course Rating/Slope (per tee, per 9/18 split) and per-hole Par/Handicap/Yardage (per tee).
- A new Supabase Edge Function calling Anthropic's Claude vision API to read a scorecard photo.
- A new client page for photo capture and a review/edit screen before saving.
- Unifying the existing manual Rating/Slope entry form to write into this same shared table.
- Merging shared/scanned data into a round's `holes_data` at round start, alongside OSM data.

**Out of scope:**
- Field-level conflict versioning/voting for the shared table — whole-row last-write-wins with an audit trail is the deliberate choice, appropriate for a prototype with no real user base or abuse history yet.
- Cost/rate-limiting guardrails beyond client-side image downscaling — a reasonable near-term follow-up, not v1.
- Any change to `tc-course.js`'s OSM parsing itself, or to the WHS handicap math in `tc-handicap.js` beyond an async signature change.

## Decisions (confirmed with the user)

- Vision provider: Anthropic's Claude API, called from a new Supabase Edge Function — the API key must never be exposed client-side.
- Scope of extracted data: Course Rating + Slope Rating per tee, per-hole Par, per-hole Handicap/Stroke-Index, and per-hole Yardage per tee — one scan reads every tee color visible on the card in one shot.
- Data goes into a new **shared** Supabase table, not per-device localStorage.
- Build the schema and the scan feature together in one pass, not phased.
- The existing manual Rating/Slope entry form gets unified to write into this same shared table.
- A review/edit screen is required before anything saves.
- The scan UI lives on its own page (`pages/scan-scorecard.html`), not squeezed into the existing in-page wizard overlay — the wizard saves its state to `sessionStorage` before navigating away and restores it on return.
- Merge priority when both OSM and shared/scanned data exist for the same hole: **OSM wins when present**; shared data only fills in gaps OSM has nothing for.

## Architecture

### 1. Schema: `course_data` table

One new table, keyed by the same `geoKey` (`TcCourse.geoKeyFor(lat,lng)`, already the de facto course-identity key everywhere else in this app — course-geometry cache, manual tee/green-pin corrections, the existing rating/slope cache). Mirrors the `profiles.widget_layout jsonb` precedent (one jsonb blob per structured whole) rather than normalizing into per-hole/per-tee child tables:

```sql
create table public.course_data (
  geo_key       text primary key,
  course_name   text,
  rating_slope  jsonb not null default '{}'::jsonb,  -- { tee_key: { '18'|'front9'|'back9': {rating,slope} } }
  holes         jsonb not null default '[]'::jsonb,  -- [{number,par,handicap,yardage:{tee_key:yds}}, ...]
  source        text not null default 'manual' check (source in ('manual','scan')),
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
```

RLS: any authenticated user can select/insert/update (no delete). **Conflict model: whole-row last-write-wins**, with `source`/`updated_by`/`updated_at` as a simple audit trail. The one correctness rule that must hold everywhere this table is written: **read-merge-write, never blind overwrite** — since `holes`/`rating_slope` are whole-row jsonb, a write from someone who only scanned 3 of 5 tees must deep-merge onto the existing row, not silently erase the other 2 tees' already-good data.

### 2. New client module: `pages/tc-course-data.js`

The single place that talks to `course_data`, used by both manual entry and the scan-review save button — enforces the read-merge-write rule in one place instead of at every call site:
- `async getRatingSlope(geoKey, teeKey, which9)` / `async saveRatingSlope(geoKey, teeKey, which9, {rating,slope}, {source})`
- `async saveHoles(geoKey, holesPatch, {source})`

`pages/tc-handicap.js`'s existing `getRatingSlope`/`saveRatingSlope` (currently synchronous, `localStorage`-only) become `async` wrappers delegating to this new module. Breaking signature change, but the blast radius is exactly two call sites in `pages/rounds.html`: `updateRatingSlopePrompt()` (read) and `saveRatingSlopeEntry()` (write) — both need `await` added.

### 3. New Supabase Edge Function: `scan-scorecard`

Client sends a resized (max ~2000px, JPEG ~0.85 quality, via `canvas`) base64-encoded image in the request body — no Supabase Storage needed, this is a one-shot image never re-read after extraction. The function:
1. Verifies the caller's JWT before spending anything on Claude (first metered external call this app has ever made — no existing cost/abuse guardrails).
2. Calls Claude's Messages API with an image content block + a prompt that maps whatever tee-color labels appear on the card onto this app's canonical `tips/gold/blue/white/red` keys (reusing the same synonym mapping `tc-course.js`'s `TEE_MAP` already uses), returns strict JSON only, and uses `null` for anything not legible rather than guessing.
3. Server-side sanity-clamps the result to plausible ranges (Rating 60–80, Slope 55–155, Par 3–6, Yardage 50–700, Handicap 1–18) before returning it.
4. Returns a distinct "nothing readable at all" failure from "some fields not legible" (per-field `null`s inside an otherwise-successful response).

### 4. New page: `pages/scan-scorecard.html`

Two hidden file inputs (`capture="environment"` for camera, a plain one for library upload — no camera capture exists anywhere in this codebase today). Reuses `pages/scanner.html`'s visual shell (upload zone, processing animation) for familiarity; the review screen is new — a small strip of tap-to-edit Rating/Slope cards (one per detected tee) above a real `<table>` of 18 rows × (Hole, Par, HCP, one Yardage column per detected tee) with direct inline number inputs. Missing/unreadable cells are visually flagged (amber, matching `hole.html`'s existing DEGRADED-mode convention). Save writes through `tc-course-data.js` with `source: 'scan'`.

### 5. `pages/rounds.html` integration

- A "Scan Scorecard" link near the existing Rating/Slope prompt, navigating to the new page. Wizard stashes `{sel, stepIdx}` to `sessionStorage` before navigating away; `openSetup()` restores + clears it on load.
- `startRound()` gains a new step: after `TcCourse.loadNear()` resolves, look up `course_data` by `geoKey` and merge into `roundData.holes_data` — OSM's own `par`/`handicap` win whenever present; the shared table only fills gaps.
- `pages/hole.html` needs no changes — it already reads `par`/`handicap` generically and never touches yardage.

## Testing / verification

No automated test suite exists in this codebase — manual browser walkthrough is the established pattern.

**Infra smoke tests first** (deploy/secrets have never been exercised in this project):
1. Deploy a bare "echo JSON back" version of the function, confirm `supabase functions deploy` succeeds against the linked project.
2. `supabase secrets set ANTHROPIC_API_KEY=...` then `supabase secrets list` to confirm registration.
3. `curl` the deployed function directly with a real user JWT and a small test image, confirm a well-formed JSON response, before building the review UI on top of it.

**End-to-end pass:**
1. New round → pick a course with decent OSM coverage → Scan Scorecard → real photo → review grid populates plausibly → deliberately mis-edit a field → Save → confirm the `course_data` row in Supabase Studio → back out, confirm the wizard resumed at the right step with prior choices intact → pick a tee → confirm Rating/Slope auto-shows the scanned value → Continue → confirm `hole.html` shows correct Par/HCP for a few known-legible holes.
2. Repeat with a course that has zero OSM coverage — confirm a scan alone produces a playable round with real par/handicap instead of the `?? 4`/`null` defaults.
3. Feed a deliberately blurry/cropped photo — confirm an honest "couldn't read this" state, never a fabricated review screen.
4. Confirm a second scan of the same course (e.g. scanning only 2 tees this time) merges correctly onto the first scan's row rather than erasing the other tees' data.
