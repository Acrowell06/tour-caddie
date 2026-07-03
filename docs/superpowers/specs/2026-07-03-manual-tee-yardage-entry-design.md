# Manual Tee Yardage Entry — Design Spec

## Context

Follow-up to the real-tee-yardage sub-project (`docs/superpowers/specs/2026-07-03-real-tee-yardage-design.md`), discovered while live-testing it: when OSM data doesn't support a real computed yardage for a tee, the tee list shows "Yardage unknown" with no way to fix it. The user asked for a manual-entry option, mirroring the existing Course Rating/Slope entry pattern in the same wizard step.

## Scope

**In scope:** an inline "Enter yardage" affordance in `pages/rounds.html`'s tee list, shown only for a tee whose computed yardage is `null`; a bounded number input; localStorage caching keyed by course + tee, in its own namespace.

**Out of scope:** anything to do with Course Rating/Slope (already solved, untouched); any Supabase-side storage (this stays local, same as Rating/Slope).

## Design

`renderTeeList()` (from the real-tee-yardage sub-project) gets one addition: when a tee's computed `yds` is `null`, first check a new cache (`tc_tee_yardage_<geoKey>_<teeKey>`) — if a manual value was previously saved for this exact course+tee, use it. If not, show "Yardage unknown" plus an "Enter yardage" link. Clicking it reveals a single number input (bounds 4000–8000 yards) with a Save button, matching the visual style of the existing Rating/Slope entry form (`showRatingSlopeForm`/`saveRatingSlopeEntry`). Saving writes to the cache and re-renders the tee row with the entered value.

**Precedence:** a real OSM-computed yardage always overrides a cached manual value — the manual cache is only consulted when the computed value is `null`. This matches how OSM data is already treated as authoritative everywhere else in the app (course/hole data, tee/green marking), with manual entry strictly a fallback.

**Cache key is `geoKey + teeKey`** (the real canonical OSM key, e.g. `'tips'`, not the display name) — consistent with how the tee list itself now identifies tees, and distinct from the existing `tc_handicap_...` (Rating/Slope) and `tc_course_...` (OSM data) cache namespaces so none of the three interfere with each other.

## Error handling

- Invalid input (outside 4000–8000, non-numeric) shows an inline error, same pattern as Rating/Slope's validation.
- No network dependency — this is entirely a localStorage read/write, so there's no offline/failure case beyond the browser's own storage limits (already an accepted, unhandled edge case for the existing Rating/Slope cache too).

## Testing

Manual: pick a course where a tee shows "Yardage unknown" → enter a valid yardage → confirm it displays immediately and persists on revisiting the same course/tee. Confirm a course with real OSM yardage is unaffected (no entry link shown, no manual value interfering).
