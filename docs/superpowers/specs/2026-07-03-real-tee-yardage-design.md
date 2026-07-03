# Real Tee Yardage — Design Spec

## Context

`pages/rounds.html`'s round-setup wizard has always shown a hardcoded, generic 5-tee list (`Black/Blue/White/Gold/Red`, each with made-up yardage/rating/slope) regardless of which real course was selected — a pre-existing gap discovered while live-testing the WHS handicap engine sub-project (merged 2026-07-03). Course Rating/Slope was already fixed in that sub-project (manual entry, cached by course+tee+which-9). This sub-project fixes the remaining piece: tee yardage.

The app's OSM-based course-data pipeline (`pages/tc-course.js`) already extracts real per-hole tee *positions* (lat/lng), keyed by the same 5 canonical names (`tips`/`gold`/`blue`/`white`/`red`, normalized via `TEE_MAP`), and `pages/hole.html` already looks these up correctly by name during play. The mock array only exists in the setup wizard's tee-picker step — and course data (`holes_data`) isn't even fetched until *after* that step today, at `startRound()`.

## Scope

**In scope:** fetching course data earlier (during tee selection, not after), computing real total yardage per tee from real per-hole tee-to-green distances, and detecting when OSM data is too sparse to trust (a course tagged with only one real tee position, duplicated across all 5 canonical names by an existing fallback in the parser) so a fabricated-looking-but-meaningless number is never shown.

**Out of scope (explicit cut, confirmed with the user):** a manual tee-position entry flow for courses with no/sparse OSM data. When real data is unavailable, tee names still show with no yardage ("Yardage unknown") — no new manual-marking feature is being built here. Course Rating/Slope, already solved, is untouched.

## Architecture

`rounds.html` triggers `TcCourse.loadNear(sel.course.lat, sel.course.lng)` as soon as a course is selected (from the same click handler that sets `sel.course`, so re-selecting a different course re-triggers it). Because 3 more wizard steps (game-type, score-mode, holes) sit between course selection and the tee-selection step, this fetch is normally already resolved by the time the tee list renders — no visible loading state needed in the common case, and no change to the existing later `TcCourse.loadNear()` call in `startRound()` (which will resolve instantly from `tc-course.js`'s existing 30-day localStorage cache).

The tee-selection step keeps its 5 canonical tee names, display order, and colors exactly as today (Black→`tips`, Blue→`blue`, White→`white`, Gold→`gold`, Red→`red`) — only the yardage source changes.

**Distinctness check (course-level, computed once per course after `holes_data` loads):** group the 5 canonical names by their full 18-hole sequence of tee positions (exact lat/lng match at every hole = same group). A name only gets a shown yardage if its position sequence is unique among the 5 — i.e., no other canonical name shares it. If 2+ canonical names share an identical sequence, none of them show a yardage, even though we know a real position exists somewhere in that group: `tc-course.js`'s existing "fill missing tee colours from any available tee" fallback duplicates one real tee position across every unfilled canonical name whenever a course is sparsely tagged, and there's no reliable way to tell which (if any) of the sharing names is the tee that position actually corresponds to — attributing it to one arbitrarily (e.g. "whichever canonical name comes first") would look precise while being a guess. The degenerate case — a course with only one real tagged tee, duplicated across all 5 — correctly yields "Yardage unknown" for every tee, not a number under an arbitrarily-chosen label.

**Yardage computation:** for a distinct tee, sum `haversineYds(hole.tees[teeName], hole.green.center)` across all 18 holes. If *any* hole is missing either the tee position or the green center for that tee, the whole tee's yardage is "unknown" rather than a partial sum — a partial total would look plausible while being significantly short of the real number, which is worse than admitting it's unknown.

**Degraded/no-data case:** if `holes_data` never resolves (course not in OSM, fetch failure, or timeout before the user reaches the tee step), all 5 tees show with no yardage. This matches the app's existing DEGRADED-mode conventions elsewhere (e.g. `hole.html`'s handling of missing course data) rather than introducing a new failure-handling pattern.

Nothing about Course Rating/Slope entry changes — it's keyed by tee *name*, which is unchanged, so existing cached entries keep matching correctly.

## Data flow

1. Course selected → `sel.course` set → `TcCourse.loadNear(lat, lng)` fires in the background, result stored on a module-level variable (e.g. `let teeCourseData = null`) once resolved.
2. Tee-selection step renders: for each of the 5 canonical names, if `teeCourseData` is available, run the distinctness check and compute yardage per the rules above; otherwise render with "Yardage unknown" for all 5.
3. If the fetch resolves *after* the tee step has already rendered (rare, given the 3-step head start), re-render the tee list in place once the promise settles — the user isn't blocked from proceeding either way.
4. `sel.tee.yds` becomes the computed value (or `null`) instead of the old mock number; this flows unchanged through the existing `startRound()` → `TcRounds.createRound({teeYardage: ...})` → `rounds.tee_yardage` path, so `courses.html`'s round-history "tee" display picks up the real value automatically.

## Error handling & edge cases

- Re-selecting a different course re-triggers the fetch for the new selection (not a stale one-time fetch).
- A slow/unresolved fetch never blocks "Next" — yardage is informational, unlike Course Rating/Slope which is required for handicap math.
- The distinctness check runs once per course (not per-render) and is cheap (18-hole position comparisons across at most 5 names).
- No new Supabase schema, no new UI beyond the yardage numbers/labels themselves.

## Testing / verification

Manual, against real courses, no automated suite (consistent with the rest of this codebase):
1. A well-mapped course → confirm plausible real total yardage per tee, distinct from tee to tee.
2. A sparsely-tagged or obscure course → confirm tee names still show, yardage shows "Yardage unknown" where data is missing or duplicate-derived, and round setup isn't blocked.
3. Course Rating/Slope entry still works unchanged in both cases.
4. `courses.html`'s round-history tee display shows the real computed yardage for a completed round.
