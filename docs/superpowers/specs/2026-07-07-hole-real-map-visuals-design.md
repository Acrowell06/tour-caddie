# Hole View — Real Map Visuals (Green View + Hole Summary)

## Context

`pages/hole.html` is the live-play screen used for all 18 holes. Its main Hole View already shows a real Leaflet satellite map with live GPS shot tracking. Two other pieces of the same screen still fake it:

- **Green View** (`#h-view-green` toggle) swaps to a hand-drawn illustrated SVG green — fixed generic shapes for the putting surface, fringe, and a decorative bunker, none of it tied to the real course. It has its own pixel-space drag/tap/marker system (`hGreenDrag`, `greenSVGToLatLng`, `makeDraggable`/`makePannable`/`addTapToPlace` in `tc-utils.js`), separate from the real Leaflet map.
- **Hole Summary** (the sheet shown after holing out) draws shot positions on another hand-drawn illustrated SVG — a generic fairway shape with static dashed lines connecting shot markers, unrelated to the real hole's actual layout.

Both illustrations predate this app having real per-hole green geometry (front/center/back) and real per-shot GPS coordinates. Both pieces of real data now exist — every shot logged already carries a real lat/lng (mirrored onto the Leaflet map even while a shot is being logged from the fake Green View), and every hole's green front/center/back comes from the existing "Mark the Green" flow. The illustrations are no longer filling a real data gap; they're just outdated.

## Scope

**In scope:**
- Green View: replace the illustrated SVG with the real satellite map (the same Leaflet instance already driving Hole View), zoomed/framed to the hole's actual mapped green.
- Hole Summary: replace the illustrated SVG with a small, fixed (non-interactive), auto-framed real map showing the tee, every logged shot, and the green for that hole, with shots revealing in sequence rather than appearing all at once.

**Out of scope:**
- Any change to element ordering/position elsewhere on the screen (hole nav, score bar, undo bar, FCB strip, GPS confirm bar, shot log, FIR/GIR toggles, Hole Out button) — confirmed during brainstorming that only these two pieces are wrong, not the overall layout.
- Any new database columns, migrations, or capture steps. Every input this redesign needs (real green geometry, real per-shot coordinates) already exists.
- Daily/round-specific pin placement — the hole-out target stays fixed at the already-mapped green center, same as today's fixed illustrated cup position.
- A curved "flight-arc" shot-trace animation (evaluated and explicitly not chosen — see Decisions).
- Any change to DEGRADED-mode behavior (holes missing a real green still show the Green View toggle disabled, exactly as today).

## Decisions

1. **Green View becomes the same Leaflet map, re-centered and re-zoomed — not a second map instance, and not the illustrated SVG.** The main map (`lmap`) already receives every shot marker regardless of which view is active (the current fake Green View mirrors its shots onto it). Reusing the single instance means Green View's markers/lines are already present with no duplication, and avoids maintaining two synced map objects.
2. **Green View framing auto-fits to the green's real front/back extent** (via `L.latLngBounds([front, back]).pad(...)`), not a fixed zoom level, since green sizes vary hole to hole.
3. **Green View interactions reuse Hole View's existing drag-a-marker flow** (`placePendingAt`/`hPendingMarker`) instead of a separate pixel-space drag system. Distance formatting already switches to feet under 10 yards (`hConfirmGPS`'s existing `yds >= 10 ? ... : ... ft` logic), so putts read naturally with no new special-casing.
4. **Holing out uses one code path in both zoom states** — tapping the flag marker (already present on `lmap`, already wired to `hHoleOutFromMap()`). Today's two separate hole-out functions (`hHoleOut()` for the fake green SVG's cup-ring tap, `hHoleOutFromMap()` for the real map's flag tap) collapse into the one that already uses real coordinates.
5. **Real-world-scaled distance rings (10ft/20ft) are added around the green center** as Leaflet circles with true meter radii, so the quick distance intuition the illustrated concentric rings gave you isn't lost by switching to plain satellite imagery.
6. **Hole Summary map is a small, separate, non-interactive Leaflet instance** (dragging/zoom/scroll/double-click/box-zoom/keyboard all disabled) — a quick recap, not something to fiddle with. Auto-fits bounds to tee + every shot + green.
7. **Shot reveal animation is staggered sequential reveal, not a curved flight-arc trace.** Two animation styles were mocked up and compared live (a simple sequential line-and-marker reveal vs. a PGA-Tour-style curved arc with a moving ball); the sequential reveal was chosen as simpler to build reliably and still a clear improvement over the current instant, static illustration. Implemented as incremental marker/line addition on a short timer (~400-600ms apart) with a fade/scale-in transition — not true SVG `stroke-dashoffset` path animation, since a geographic polyline's on-screen length varies with map zoom/projection and would need extra work to get right; staggered reveal achieves the same visual effect without that complexity.
8. **Code removed as a consequence, not left behind:** `greenSVGToLatLng`, `greenToHoleSVG`, `latLngToSumSVG`, the green-mode branch inside `hConfirmGPS()`, the `#h-green-svg` markup block (including its illustrated bunker/fringe shapes and the 10ft/20ft dashed reference rings it drew by hand), and the illustrated `#sum-svg` fairway markup. `makeDraggable`/`makePannable`/`addTapToPlace` in `tc-utils.js` become unused once `hole.html` stops calling them (grep-confirmed no other page uses them) — remove them too rather than leave dead code.

## Architecture

`hole.html`'s single Leaflet instance (`lmap`) already carries every shot marker and the flag marker regardless of view mode. `hSetView('green')` changes from swapping DOM visibility between `#h-leaflet` and `#h-green-svg` to instead calling `lmap.fitBounds(...)` framed on the green; `hSetView('hole')` restores the tee-to-green framing already used today. The distance-ring circles are added once at init (skipped in DEGRADED mode, same as the rest of Green View).

The Hole Summary sheet gets a new `#sum-leaflet` container replacing `#sum-svg`. `buildSummaryMap()` is rewritten to create/reset a small Leaflet map on `showSheet()`, fit its bounds to the real positions already stored in `hLoggedShots`, then reveal the tee→shot1→shot2→...→green path and markers on a staggered timer instead of drawing everything synchronously.

No changes to `tc-rounds.js`, `tc-course.js`, or any Supabase schema — this is confined to `hole.html`'s rendering layer.

## Testing

No automated test suite exists for this app (established pattern) — manual browser walkthrough, using the same local-server approach already used earlier in this session:

1. Play a hole at a course with a real mapped green — confirm Green View shows the real satellite map zoomed to the green (not the illustration), drag-to-place works, distance shows in feet for short distances, the 10ft/20ft rings render, and tapping the flag holes out correctly.
2. Hole out and confirm the Hole Summary sheet shows a real, auto-framed aerial map with the tee, each shot, and the green, revealing in sequence rather than appearing all at once.
3. Play a hole with no real mapped green (DEGRADED) — confirm Green View's toggle is still disabled, exactly as today, and nothing about this change affects that path.
4. Confirm a par-3 (tee shot judged directly for GIR) and a par-4/5 (fairway shot first) both still work through the unified hole-out path with no regression to FIR/GIR auto-detection.
