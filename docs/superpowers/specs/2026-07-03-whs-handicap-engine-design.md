# WHS Handicap Engine — Design Spec

## Context

Tour Caddie is a plain HTML/JS/CSS prototype backed by a real Supabase project. Sub-projects 1 (auth) and 2 (rounds/shots persistence) are merged; every round played through `pages/hole.html` now durably lands in `rounds`/`round_holes`/`shots`. Every handicap-related display in the app today, however, is a hardcoded mock value with no real calculation behind it:

- `pages/profile.html` shows a static "4.2" Handicap Index.
- `pages/stats.html`'s Handicap card and "Recent Differentials" drill-down table are 100% hardcoded mock data (`+1.8`, fake trend, 8 fake differential rows).
- `pages/home.html`'s dashboard widget shows a hardcoded "+1.8".
- `pages/courses.html`'s season-summary "Handicap" stat is stubbed to `—` with a comment noting it needs this exact sub-project.
- `pages/rounds.html`'s `reCalcHandicap()` computes a "Course Handicap" display using a hardcoded `+1.8` index and a generic 5-tee mock array (`Black/Blue/White/Gold/Red` with made-up rating/slope) unrelated to whichever real course was selected.

`profiles.handicap_index` (numeric, nullable) and `rounds.differential`/`rounds.adjusted_score` (numeric/integer, nullable) already exist in the live Supabase schema — unpopulated by any code today. This sub-project starts writing real values to them and replaces every hardcoded display above with the real value.

## Scope

**In scope:** computing and storing a real WHS-style Handicap Index (Score Differential per round, rolling average with 9-hole combining, Net Double Bogey ESC), collecting the Course Rating/Slope Rating data this requires (currently unavailable from any real source), and wiring every existing handicap display surface to read the real computed value instead of a mock.

**Out of scope (explicit cuts, confirmed with the user):**
- The exceptional-score-reduction safeguard (extra downward adjustment when a differential is 7+ strokes better than the golfer's current low index).
- The maximum-increase-per-update cap (limits how much the index can worsen from one update to the next).
- PCC (Playing Conditions Calculation) — requires aggregate scoring data across many golfers at a course on a given day, which a single-user app has no way to compute. Always treated as 0, consistent with how most simplified WHS implementations handle it.
- Any handicap-related UI redesign beyond swapping mock values for real ones — no new screens, no settings for adjusting the formula.

## Data gap this sub-project must solve

Real Score Differential calculation needs Course Rating and Slope Rating for the specific tee (and, for 9-hole rounds, the specific 9) played. No existing data source has this:
- OpenStreetMap (the app's only real course-data source, via `tc-course.js`) doesn't reliably tag it.
- A pre-existing, unused `tees` table has `course_rating`/`slope_rating` columns, but it's disconnected from the OSM-based course pipeline this app actually uses (see `[[supabase-schema-reality-check]]` memory).
- `rounds.html`'s tee picker uses a hardcoded generic mock array, not tied to the real selected course.

**Resolution:** manual entry, the same pattern already established for missing tee/green GPS data. During round setup (`rounds.html`'s tee-selection step), after a tee is picked, check a local cache for that course+tee's rating/slope. If missing, show an inline two-field entry (Course Rating, Slope Rating) that must be filled before the round can start. Cache is `localStorage`, keyed by the course's OSM `geoKey` + tee name (+ which-9 for 9-hole rounds — see below) — identical mechanism to the existing manual tee/green marking cache. Basic bounds validation (Course Rating ~60–80, Slope ~55–155, the real USGA-defined ranges) catches obvious entry mistakes.

This is a deliberate architectural choice: the computed differential itself, once written to `rounds.differential`, is durably correct in Supabase regardless of what happens to the local cache afterward. Losing the cache (browser clear, new device) only means re-entering a reference number next time that course/tee is played — it never risks losing or corrupting already-computed handicap history.

## Architecture

A new shared module `pages/tc-handicap.js` (same IIFE pattern as `tc-auth.js`/`tc-course.js`/`tc-rounds.js`), owning:

1. **Rating/slope cache** — `TcHandicap.getRatingSlope(geoKey, teeName, which9)` / `TcHandicap.saveRatingSlope(geoKey, teeName, which9, {rating, slope})`, `which9` is `'18'`, `'front9'`, or `'back9'`.
2. **Per-round differential math** — given a round's `round_holes` rows, the rating/slope used, and the golfer's current `profiles.handicap_index`:
   - Adjusted Gross Score: each hole's score capped at Net Double Bogey (Par + 2, plus 1 extra stroke if the golfer's current handicap index is at or above that hole's stroke index from `round_holes.handicap`; unknown stroke index defaults to 0 extra strokes — the conservative case). No current handicap index (first-ever rounds) is treated as scratch (0 strokes) for this purpose.
   - Score Differential = `(113 / slope) × (adjustedGross − rating)`.
3. **Rolling index recompute** — given the golfer's full differential history (`rounds.differential`, `rounds.hole_count`, ordered by completion time): pair 9-hole differentials oldest-first, two at a time, summing each pair into one synthetic 18-hole-equivalent differential (any unpaired trailing 9 is excluded from this computation, pending a future partner); combine with genuine 18-hole differentials into one pool; apply the official WHS count-based averaging table (lowest 1 of the most recent 3 scores, up through lowest 8 of 20; fewer than 3 usable scores means no index yet); multiply by 0.96; round to one decimal.

**Data flow:**
1. **Round setup** (`rounds.html`): resolve rating/slope for the picked tee (prompting if missing), store the resolved `{rating, slope, which9}` on `tc_active_round`.
2. **Round completion** (`tc-rounds.js`'s `completeRound()`, extended to accept the rating/slope): computes and writes `rounds.differential` + `rounds.adjusted_score` in the same update that sets `status = 'complete'`; then recomputes and writes `profiles.handicap_index` from the full history. Both writes are part of the same queued "complete" operation already retried by the existing offline queue from sub-project 2 — no new retry infrastructure.
3. **Every display surface** (`profile.html`, `stats.html`, `home.html`, `courses.html`) reads `profiles.handicap_index` directly. `stats.html`'s differentials table reads real `rounds` rows.

## No new Supabase schema

`rounds.differential`/`adjusted_score` and `profiles.handicap_index` already exist. Rating/slope is localStorage-only. 9-hole pairing state is derived fresh each time from `rounds.hole_count` + `rounds.differential` + completion order — nothing new to track or migrate.

## Error handling & edge cases

- Round completes with no rating/slope resolved (e.g., an in-progress round started before this feature shipped): differential computation is skipped for that round; it completes normally with `differential` left `null`.
- A 9-hole round that doesn't start on hole 1 or hole 10 (the app's existing round setup allows any starting hole, e.g. a 9-hole round played 5→13): this isn't a standard, ratable front/back 9, so it's treated the same as "no rating/slope resolved" — no rating/slope prompt, no differential, completes normally. Only 9-hole rounds covering holes 1–9 or 10–18 exactly get the front9/back9 treatment.
- Fewer than 3 usable differentials: `profiles.handicap_index` stays `null`; every display surface shows the same placeholder treatment already established for `sg`/`diff` (`—`, not a fabricated number).
- No current handicap index yet (first tracked rounds): ESC treats the golfer as scratch for that round's cap.
- Offline / write failure: differential + index recompute ride along with the existing round-completion retry queue — never a state where a round shows `complete` but its differential silently never arrives.
- Odd number of unpaired 9-hole rounds: the extra one sits out of the index calculation until a future 9-hole round provides a partner — recomputed fresh each time, not stored as a separate "pending" flag.

## Testing / verification

No automated test suite exists for this prototype, consistent with prior sub-projects. Manual, end-to-end verification against the live Supabase project:

1. Play an 18-hole round at a course/tee with no rating/slope on file → confirm the inline entry appears during tee selection and blocks proceeding until valid values are entered.
2. Complete that round → confirm `rounds.differential`/`adjusted_score` are correct (hand-verify the arithmetic once) and `profiles.handicap_index` updates only once at least 3 usable differentials exist.
3. Play a second round at the same course/tee → confirm the rating/slope entry does not reappear (cache hit).
4. Play two separate 9-hole rounds (different days is fine) → confirm each gets its own differential immediately, and confirm the index recompute after the second one correctly pairs and sums them into one synthetic 18-hole-equivalent differential.
5. Confirm `profile.html`, `stats.html`, `home.html`, and `courses.html` all show the same real `profiles.handicap_index` value instead of their old hardcoded mocks.
