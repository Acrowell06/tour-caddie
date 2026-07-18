# Home Strokes Gained Panel — Design

**Date:** 2026-07-18
**Status:** Approved, ready for implementation planning

## Problem

The home screen shows a user-built widget grid and nothing else. Strokes Gained —
the most diagnostic number the app produces — is buried on the Stats page behind a
section toggle. The user wants a permanent, compact SG summary on Home that updates
itself as rounds are completed.

## Scope

One panel on `pages/home.html`. No changes to the Stats page, the widget system, or
the visual language of the rest of the app.

## Placement and behaviour

The panel is a fixed part of the home screen, not a widget: it cannot be removed,
resized, or added from the Add Widget picker, and it does not appear in the stat
catalogue.

It renders as the **first child of `.hw-scroller`**, above `#widget-grid`. It is the
first thing visible on landing and scrolls away with the widgets when the user scrolls
down, so it costs no permanent vertical space.

During Edit mode the panel remains visible but inert — no slot overlays, no edit bar,
no remove control.

Tapping the panel navigates to the Stats page with the Strokes Gained section open.

`stats.html` currently has no URL-parameter handling; its SG view opens only via
`openStat('sg')` from a card tap. Delivering this therefore requires one small
addition to `stats.html`: read a `?stat=<id>` parameter at init and call the existing
`openStat()` with it. This is the only permitted change to the Stats page — no layout,
styling, or data logic there may be altered.

## Layout

Target height ~128px at 320px viewport width.

Two columns:

- **Left (104px):** SVG radar chart.
- **Right (flex):** label `YOUR GAME · N ROUNDS`; the average SG total as the dominant
  number; a `Last <value> · <date>` line; then two callout lines — strongest and
  weakest category.

## Data

No new query. `home.html` already fetches exactly the rows this panel needs:

```
from('rounds')
  .select('sg_ott, sg_app, sg_atg, sg_putt, sg_total')
  .eq('user_id', session.user.id)
  .eq('status', 'complete')
  .not('sg_total', 'is', null)
  .order('completed_at', { ascending: false, nullsFirst: false })
  .limit(20)
```

The only change is adding `completed_at` to the `select` so the last-round date can be
displayed. The existing single request continues to serve both the widget stat values
and this panel.

| Panel element | Derivation |
|---|---|
| Average SG total | mean of `sg_total` across returned rows (already computed) |
| `N ROUNDS` | number of rows returned |
| Last round value and date | newest row's `sg_total` and `completed_at` |
| Four radar spokes | means of `sg_ott`, `sg_app`, `sg_atg`, `sg_putt` (already computed) |
| Strongest / weakest callouts | max and min of those four category means |

This is the same table, same filters, and same 20-round window that the Stats page's
Strokes Gained section uses, so the two screens cannot disagree, and both refresh
automatically as rounds complete.

## Radar chart

Four axes: Off Tee (top), Approach (right), Around Green (bottom), Putting (left).

A dashed circle marks Tour average (0.0). Points inside are below tour average, points
outside are above. Radius maps linearly from category value, with 0.0 on the dashed
circle. The scale is fixed at ±3.0 strokes so the shape stays comparable between
visits; values beyond that clamp to the chart edge.

The ±3.0 scale is a starting assumption. During implementation it must be checked
against the user's real category averages, and widened if values routinely clamp.

Colour follows the app's existing convention: `var(--green)` at or above tour average,
`var(--red)` below. (The source mockup read as entirely salmon only because every value
in it happened to be negative.)

## States

- **Loading:** panel frame at full height with a `Loading…` line, so the layout does
  not shift when data arrives.
- **No qualifying rounds:** panel frame at full height reading
  *"No Strokes Gained data yet — play a full round at a mapped course."* This mirrors
  the existing wording on the Stats page. The panel never disappears.
- **Query error:** treated as the no-data state. Errors are not silently swallowed —
  the failure is logged to the console.
- **Signed out:** not applicable. `TcAuth.requireAuth()` gates the page before render.

Strokes Gained requires a round played at a well-mapped course with GPS shot tracking,
so the no-data state is expected to be common early on and must look deliberate rather
than broken.

## Verification

Implementation is not complete until the following are observed in a browser and shown
to the user as screenshots:

1. Panel with real account data at 320px width.
2. Panel in the no-data state.
3. Home screen at true phone width (390×844), confirming the panel, widget grid,
   pinned Start Round button, and tab bar all coexist without overflow.
4. Edit mode, confirming the panel stays visible and inert.
5. Category values checked against the ±3.0 radar scale for clamping.

## Out of scope

- Changes to the Stats page, except the single `?stat=` deep-link handler described
  under "Placement and behaviour".
- Changes to the widget system or stat catalogue.
- Moving the home screen toward the source mockup's serif/salmon aesthetic. That is a
  larger separate change if ever wanted.
- Any period selector on the panel. The window is fixed at the last 20 qualifying
  rounds, matching Stats.
