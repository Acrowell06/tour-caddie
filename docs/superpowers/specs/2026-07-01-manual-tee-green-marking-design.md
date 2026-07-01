# Manual Tee & Green Marking — Design Spec
**Date:** 2026-07-01
**Status:** Approved

---

## Overview

For courses/holes where OpenStreetMap doesn't have reliable tee and green data (today's "degraded" holes — see `docs/superpowers/specs/2026-06-30-gps-course-tracking-design.md`), let the golfer mark the tee and green themselves on the satellite map before playing that hole. The marked location is saved so it isn't needed again on future rounds at that course.

---

## 1. Trigger

- Appears only for a hole that is currently degraded — missing a real per-hole tee for the selected tee color, a real green, or both.
- Holes with existing usable data go straight to the normal shot-tracking screen, unchanged.
- Only the specific missing piece(s) are asked for — if the tee already exists but the green doesn't, only the green-marking steps show, and vice versa.

---

## 2. Flow (per hole, when triggered)

A "Mark This Hole" screen replaces the normal tracking screen until confirmed:

1. **Mark Tee** (skipped if a real tee for the current tee color already exists)
   - Pin defaults to the device's current GPS position. If location permission is denied or unavailable, it defaults to the course's general location instead (same fallback the rest of the app already uses) and the user drags it into place.
   - Draggable to fine-tune.
   - "Confirm Tee" advances.
2. **Mark Green — Front** (skipped if a real green already exists)
3. **Mark Green — Center**
4. **Mark Green — Back**
   - Each step: a single draggable pin on the same satellite map used elsewhere in the app.
5. **"Confirm & Play Hole"** — saves the marks and proceeds into the existing hole-tracking screen for this hole, which now treats it exactly like a hole with real OSM data (same F/C/B math, same map, same everything — no special-cased behavior downstream).

**"Skip — just track shots"** is available at every step of the sequence. Tapping it at any point discards *all* progress in the current marking flow (even if, say, the tee was already confirmed) — nothing partial is saved. The hole then behaves exactly as today's degraded mode (no distances, banner shown, shot tracking still works).

---

## 3. Persistence rules

- Marks are saved to `localStorage`, merged into the same course-data cache `tc-course.js` already maintains from OSM (keyed by course `geoKey`) — same data shape (`{number, par, handicap, tees, green}`), so nothing downstream needs to know whether a hole's data came from OSM or was hand-marked.
- **Tee mark:** saved only under the tee color selected for the current round. Different tee boxes are physically different spots, so a tee marked while playing white tees does not fill in blue/gold/red/tips — those still prompt marking when actually played from.
- **Green mark:** saved once, applies to all tee colors (the green's location doesn't depend on which tees were played).
- If there's no course location at all to key the save against (e.g. `hole.html` opened with no active round), marks apply to the current round only and aren't persisted.

---

## 4. Architecture / files touched

- **`tc-course.js`:**
  - New `saveManualHole(geoKey, holeNumber, patch)` — merges a manual tee and/or green mark into the cached course entry for that `geoKey` (creating a stub hole entry if none exists yet), then writes back via the existing `setCache`.
  - New `geoKeyFor(lat, lng)` — extracts the existing inline rounding formula so callers outside `tc-course.js` can compute the same cache key without duplicating it.
- **`rounds.html`:**
  - `startRound()` currently discards the `geoKey` returned by `TcCourse.loadNear()` — store it into `roundData.geoKey` so `hole.html` can save marks back to the right cache entry.
- **`hole.html`:**
  - New "Mark This Hole" screen, shown instead of the normal tracking UI whenever `DEGRADED` is true for the active hole.
  - Reuses the existing Leaflet satellite map and the same drag-to-place marker mechanic already built for shot placement (the `makeDraggable` pattern from `tc-utils.js`) — no new interaction paradigm.
  - On confirm: calls `TcCourse.saveManualHole(...)`, patches the current round's `holes_data` in `sessionStorage` for the active hole, then reloads into the normal tracking screen (same page, same URL) so all existing hole-tracking logic picks up the new data unmodified.

---

## 5. Out of scope

- No changes to how OSM-sourced data is fetched or parsed (2026-07-01's parser/radius/plausibility fixes stand as-is).
- No UI for browsing/editing marks outside of the per-hole flow (e.g. no "manage my marked holes" settings screen).
- No attempt to contribute marked data back to OpenStreetMap itself.

---

## 6. Verification

Manual browser walkthrough:

1. Seed a round with a course/hole that has no tee or green data at all → confirm the Mark This Hole screen appears before the tracking screen, asking for tee then front/center/back green.
2. Confirm marking → confirm it drops into the normal tracking screen with real-looking F/C/B distances computed from the marked points.
3. Reload with a fresh round at the same course/hole/tee color → confirm the hole is no longer degraded (marking screen doesn't reappear).
4. Repeat with a different tee color at the same hole → confirm the tee-marking step reappears (the green step doesn't).
5. Use "Skip" → confirm nothing is saved and the hole behaves like today's plain degraded mode.
