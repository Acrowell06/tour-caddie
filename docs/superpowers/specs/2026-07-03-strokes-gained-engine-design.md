# Strokes Gained Engine — Design Spec

## Context

Tour Caddie is a plain HTML/JS/CSS prototype backed by a real Supabase project. Sub-projects 1-3 (auth, rounds/shots persistence, WHS handicap engine) are merged. Every Strokes Gained (SG) display in the app today is a hardcoded mock: `pages/courses.html`'s round-detail SG tab always shows a "coming in a future update" placeholder (`r.sg` is always `null`), `pages/stats.html`'s SG drill-down card is 100% hardcoded (`+1.1` total, fixed category breakdown), and `pages/home.html`'s dashboard widget shows fixed `+1.1`/`+0.4`/`+0.6` values.

Real Strokes Gained (the PGA Tour / Mark Broadie model) computes, per shot: expected-strokes-to-holeout *before* the shot minus expected-strokes-to-holeout *after* the shot, minus 1 (for the stroke taken) — using baseline reference tables indexed by starting lie (tee/fairway/rough/bunker/green/recovery) and distance to the pin. This sub-project builds that calculation for real, using the shot-level data (`shots.club`, `.lat`, `.lng`, `.distance_yds`) already persisted by the rounds/shots persistence sub-project.

## Data gaps this sub-project must close

Three real gaps block authentic SG calculation, discovered during brainstorming — none of them small:

1. **No per-shot lie captured.** `shots.lie` exists as a column (added when the table was first created, predating this repo's own migrations) but nothing has ever written to it.
2. **`shots.distance_yds` means the wrong thing for SG.** It currently records how far a shot *traveled* (distance from the previous shot's landing spot), not the distance *remaining to the pin* before or after the shot — which is what the SG formula actually needs.
3. **Green position is never persisted.** `hole.html` has the real green center transiently, from OSM data, during play — but it's discarded once the round completes. Nothing in Supabase records where the pin was, so distance-to-pin can't be computed after the fact for a completed round.

## Scope

**In scope:**
- Persisting green center position per hole (`round_holes.green_lat`/`green_lng`).
- GPS-inferred per-shot lie (Tee/Fairway/Rough/Green auto-detected; Bunker/Water/Recovery always available as manual override, never auto-selected — see Architecture), shown in the existing post-shot club-picker sheet with a one-tap correction.
- Deriving distance-to-pin-before/after per shot from shot positions + the now-persisted green position (no new capture needed for this part — it's computable from data captured elsewhere in this same sub-project).
- A handicap-tiered baseline (4 tiers: Scratch/Low, Mid, High, Beginner), selected via the golfer's existing `profiles.handicap_index`, built from **approximate, publicly-referenced golf-analytics research** (Mark Broadie's widely-cited work) — explicitly not official, licensed PGA Tour ShotLink data, since this app has no access to that and no live external fetch capability for it. UI copy must reflect this (e.g. "vs. estimated baseline for your handicap"), never presented as authoritative.
- Real SG values across all four display surfaces: `courses.html`'s round-detail tab, `stats.html`'s drill-down card, `home.html`'s dashboard widget.

**Out of scope (explicit cuts):**
- Bunker/water/recovery lie auto-detection via OSM hazard-polygon parsing — no hazard geometry exists in this app's course-data pipeline today, and adding it would be a materially bigger, separate project. These three lies are always available as manual taps, never inferred.
- Any change to the WHS handicap engine itself — `profiles.handicap_index` is consumed read-only, to select a baseline tier.
- A continuous/interpolated baseline curve across handicap — 4 discrete tiers only, matching how the reference research itself is commonly presented (named golfer archetypes, not a continuous function), avoiding a false sense of precision from interpolating between tiers this app doesn't have exact source data to interpolate correctly.

## Architecture

A new shared module `pages/tc-strokesgained.js` (same IIFE pattern as `tc-auth.js`/`tc-course.js`/`tc-rounds.js`/`tc-handicap.js`) owns:

1. **Baseline tables** — expected strokes-to-holeout by lie category and distance, for 4 skill tiers. Pure data + lookup, no Supabase dependency.
2. **Lie inference** — given a shot's starting position, the hole's tee/green positions, and whether it's shot 1: classify as `tee` (shot 1, always), `green` (within the same proximity threshold `hole.html`'s existing `autoDetectGIR` already uses), `fairway` (near the ideal tee-green line, reusing the existing lateral-distance-from-line math `autoDetectFIR` already computes), or `rough` (everything else geometrically). Never infers `bunker`/`water`/`recovery` — those are manual-only.
3. **SG computation** — given a hole's full shot sequence (each with a resolved lie, distance-to-pin-before, distance-to-pin-after) and a baseline tier: per-shot SG value, and per-shot category (Off-the-Tee/Approach/Around-the-Green/Putting) per the standard convention (tee shot on par 4/5 → OTT; `green` lie → Putting; within 30 yards of the green → Around-the-Green; everything else, including every par-3 tee shot → Approach).

**Data flow:**
1. **During play** (`hole.html`): the post-shot club-picker sheet gains a lie row, pre-selected via the lie-inference logic, tappable to override before confirming. The hole's green center (already available client-side from OSM data) gets included in the hole-completion payload.
2. **At hole completion** (`tc-rounds.js`'s existing `writeHoleResult`, extended): writes `round_holes.green_lat`/`green_lng`; for each shot, computes distance-to-pin-before/after from shot positions + green position and writes `shots.lie` (the resolved value, auto or manually-corrected) and a new `shots.sg_value`; sums per-category SG across the hole's shots and accumulates into `rounds.sg_ott`/`sg_app`/`sg_atg`/`sg_putt`/`sg_total` (five new nullable columns, mirroring exactly how `rounds.differential` already works) — all riding the same offline retry queue already used for differential computation, with the same "must never block round completion" resilience.
3. **Every display surface** (`courses.html`, `stats.html`, `home.html`) reads real `rounds.sg_*` values. `stats.html`/`home.html`'s rolling averages are computed fresh from the golfer's `rounds` history each time they're displayed — no new "rolling" column is needed, since (unlike the handicap index) SG has no circular dependency requiring a persisted running value; the baseline tier lookup only needs the *current* `profiles.handicap_index`, which already exists for a different reason.

## Error handling & edge cases

- **Missing green position for a hole** (DEGRADED mode, no OSM green data): that hole's SG is skipped entirely — no fabricated distance-to-pin.
- **A broken shot chain**: since each shot's distance-to-pin-before is literally the previous shot's landing spot (or the tee, for shot 1), a single shot missing GPS data invalidates every downstream shot in that hole. The whole hole's SG contribution is skipped — same all-or-nothing principle already used for tee yardage and for the differential ESC calculation.
- **No handicap index yet** (fewer than 3 valid rounds, per the WHS engine's own established rule): SG is skipped rather than computed against a guessed baseline tier — showing a number against the wrong skill tier is more misleading than showing a placeholder, matching the exact same reasoning already applied to `profiles.handicap_index` staying `null` until enough data exists.
- **Computation failures must never block hole/round completion** — same resilience pattern already established and fixed once during the WHS engine's own review cycle (a try/catch boundary around SG computation, degrading to "skip this hole's SG" on any failure, never blocking the underlying `round_holes`/`rounds` status writes).

## Testing / verification

Manual, end-to-end, no automated suite (consistent with the rest of this codebase):
1. Play a hole, confirm the lie row appears in the club-picker sheet with a sensible auto-selected value; confirm tapping a different lie overrides it before the shot is finalized.
2. Complete a round at a well-mapped course → confirm `round_holes.green_lat`/`green_lng` and `shots.lie`/`sg_value` populate, `rounds.sg_*` columns populate, and `courses.html`'s SG tab shows real numbers instead of the placeholder.
3. Complete a round at a course with missing green data for at least one hole → confirm that hole doesn't break the round and its SG contribution is simply absent from the total (not zero, not fabricated).
4. Confirm `stats.html`/`home.html`'s SG displays compute a real rolling average from actual `rounds` rows instead of the current hardcoded values.
5. Confirm a golfer with fewer than 3 valid rounds sees an honest "not enough data yet" placeholder for SG, not a number computed against a default-guessed baseline tier.
