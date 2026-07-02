# Rounds/Shots Persistence — Design Spec

> **Addendum (during Task 1 execution):** the live Supabase project already had `rounds`, `round_holes`, and `shots` tables — real prior design work (join-based RLS already in place, `round_holes` capturing `fairway_direction`/`gir_direction` miss-side detail this spec didn't plan for), not disposable scaffolding, discovered only once the migration below failed with a "relation already exists" error. The schema in this document was adapted in place (via `ALTER TABLE`, not `CREATE TABLE`) to reuse that existing structure — table names, several column names, and two bonus columns differ from what's written below as a result. The **architecture** (three write triggers, offline retry queue, `courses.html` reading real data with `sg`/`diff` staying `null`) is unchanged. See `docs/superpowers/plans/2026-07-02-rounds-shots-persistence.md` Task 1 for the actual schema that shipped.

## Context

Tour Caddie is a plain HTML/JS/CSS prototype backed by a real Supabase project (see `docs/superpowers/specs/2026-07-01-real-authentication-design.md` for the auth layer, already merged). Round and shot data currently lives only in `sessionStorage` for the duration of a round (`tc_active_round`, `tc_round_scores`, an in-memory shot log in `pages/hole.html`) and is discarded once the browser tab closes. `pages/courses.html` — the round-history browsing screen — reads from a hardcoded static `ROUNDS` array of 12 demo rounds instead of real data, even though it already has the Supabase client and `TcAuth.requireAuth()` wired in.

This sub-project (the second in the post-Swift-pivot roadmap, after real authentication) makes rounds and shots durable: a round played in `pages/hole.html` gets saved to Supabase and shows up as real history in `pages/courses.html`.

## Scope

**In scope:** persisting rounds, per-hole results, and per-shot detail (club, GPS position, result) to Supabase; wiring `courses.html` to read real data instead of the mock array.

**Out of scope (explicit cuts, confirmed with the user):**
- Mid-round resume across browser sessions/tabs. `sessionStorage` remains the live in-round buffer exactly as it works today; closing the tab mid-round loses that in-progress round's un-synced holes. Already-synced completed holes remain saved. A resume-after-close flow, if wanted later, is a separate follow-up.
- Profile/settings persistence and widget-layout persistence — deferred from the original decomposition, tracked as smaller follow-ups.
- Strokes Gained values. The schema captures what a future SG engine will need (shot lat/lng, club, per-shot sequence), but computing SG is its own sub-project. `courses.html`'s `sg` field stays `null`/shows a placeholder until that sub-project exists.
- Round deletion or editing UI.

## Architecture

Three new Supabase tables — `rounds`, `hole_results`, `shots` — all row-level-security-scoped to `auth.uid() = user_id`. `user_id` is denormalized onto all three tables (not just `rounds`) so every RLS policy is a flat equality check rather than a subquery join, matching the standard Supabase pattern and closing the exact class of gap flagged in the real-authentication sub-project's final review (missing `INSERT` policy on `profiles`) before it can recur here.

Three write triggers map onto the three real state transitions the app already has:

1. **Round start** (`pages/rounds.html`, inside `startRound()`): insert one `rounds` row (`status = 'in_progress'`), store the returned `id` as `sessionStorage.tc_active_round.roundId`.
2. **Hole-end** (`pages/hole.html`, on hole confirm/next-hole transition): insert one `hole_results` row plus a batch of `shots` rows for that hole, in one request.
3. **Round complete** (`pages/hole.html`, on the last hole's confirm → `scorecard.html` transition): `update rounds set status = 'complete', completed_at = now()`.

Local `sessionStorage` state (`tc_active_round`, `tc_round_scores`, the in-memory shot log) is unchanged and remains the source of truth *during* a round — Supabase is a write-behind mirror of it, populated at hole boundaries, not a replacement for the live buffer.

## Offline resilience

Golf courses frequently have weak or no cell signal. Hole-end sync must not block or degrade the in-round experience when offline:

- On a failed hole-end write (network error, offline), the payload (hole result + its shots) is pushed onto a `sessionStorage.tc_pending_syncs` array instead of surfacing an error to the golfer. Hole logging and navigation continue normally.
- A `window.addEventListener('online', ...)` handler drains `tc_pending_syncs` oldest-first when connectivity returns.
- Each subsequent hole-end also attempts to drain any pending queue entries first (covers the case where the `online` event doesn't fire reliably, e.g. flaky signal that never fully drops).
- Round completion (`status = 'complete'`) is only meaningful once all of that round's holes have synced; if the queue is non-empty when the round finishes, the completion update is itself queued behind the pending hole syncs rather than sent out of order.

## Schema

```sql
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
  fir boolean,           -- null on par 3 (not tracked)
  gir boolean not null,
  up_and_down boolean,   -- null when not applicable (e.g. hole was GIR)
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
  result text,            -- 'fairway' | 'rough' | 'bunker' | 'water' | 'green' | 'holed' | ...
  distance_yards numeric
);
```

RLS policies on all three tables: `select`, `insert`, `update`, each `using`/`with check (auth.uid() = user_id)`. No `delete` policy — rounds aren't deletable from the UI today, so none is needed.

## Read path

`pages/courses.html` replaces the hardcoded `ROUNDS` array with a Supabase fetch: the signed-in user's `rounds` (newest first), each joined to its `hole_results`. Round-summary display fields — `fir%`, `gir%`, `putts`, `up_down%`, the `holes[]`/`pars[]` 18-element arrays — are computed client-side from the joined rows, using the same computation pattern the page already uses today for Course Insights and the sparkline (those are already derived client-side from the mock array; this sub-project changes only where the source rows come from). `sg` is left `null`; the UI shows a placeholder (e.g. `—`) rather than a fabricated number until the Strokes Gained sub-project exists.

Season-summary stats (Rounds count, Scr Avg, Handicap, Low Rd) — currently hardcoded HTML — get computed from the same fetched round set.

## Error handling

- Hole-end sync failures: queued for retry, never surfaced as a blocking error during play (see Offline resilience above).
- Round-start insert failure (e.g. offline at tee time): the round proceeds locally exactly as it does today (no `roundId` yet); the next successful hole-end sync attempt first ensures the round row exists (upsert-style: insert `rounds` if `roundId` is still absent, then proceed with the hole batch).
- `courses.html` read failure (network/auth error): fall back to an empty state ("No rounds yet") rather than silently reverting to the old mock array, so a real fetch failure is visible instead of masquerading as demo data.

## Testing / verification

No automated test suite exists for this prototype (consistent with prior sub-projects). Verification is manual, end-to-end against the live Supabase project:

1. Play a full round through `rounds.html` → `hole.html` (18 holes) with real signed-in auth; confirm each hole-end produces one `hole_results` row and the correct number of `shots` rows in Supabase.
2. Confirm `rounds.status` flips to `complete` and `completed_at` is set after the final hole.
3. Load `courses.html` and confirm the just-played round appears with correct score, per-hole strokes/par, FIR%/GIR%/putts, and a blank/placeholder SG section.
4. Simulate offline mid-round (devtools offline mode) for at least one hole-end; confirm play continues uninterrupted, then restore connectivity and confirm the queued hole(s) sync without duplication.
5. Confirm RLS: a second test account cannot read the first account's rounds/hole_results/shots (query as user B, expect zero rows).
