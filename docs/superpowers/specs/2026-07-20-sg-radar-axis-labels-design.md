# Strokes Gained Radar — Axis Labels

**Date:** 2026-07-20
**Status:** Approved, ready to implement

## Problem

The home screen's Strokes Gained radar plots four categories but labels none of them, so a spoke cannot be identified from the chart. The numbers appear in the text column beside it, but only for the best and worst categories — the other two are unreadable.

## Constraint

The radar is a 104px SVG on a 140-unit viewBox, and its plot fills nearly the whole box: the outer ring sits at radius 55 of a 70-unit half-width, leaving 15 units of margin. There is no room for labels without giving something up.

The user chose to keep the panel's height fixed rather than grow it, so the plot shrinks to make room. Growing the panel to roughly 155px was the rejected alternative; it would have allowed full words but costs home-screen space the user has twice said they want to preserve.

## Design

**Uniform plot shrink.** `SG_R.RMAX` goes 55 → 42 and `SG_R.R0` goes 30 → 23. Both scale by the same factor, so the rendered polygon is a uniformly scaled version of today's rather than a distorted one. The value-to-radius mapping and the ±3.0 clamp are unchanged in meaning.

**Four labels at the spoke ends**, matching the fixed category order (Off Tee top, Approach right, Around Green bottom, Putting left):

| Position | Text | x | y | anchor |
|---|---|---|---|---|
| top | `OTT` | 70 | 22 | middle |
| right | `APP` | 120 | 74 | middle |
| bottom | `ATG` | 70 | 125 | middle |
| left | `PUTT` | 21 | 74 | middle |

Styling: `font-size:11` viewBox units, `font-weight:700`, `letter-spacing:0.5`, `fill:var(--text-muted)`.

At the 104px render size, 11 viewBox units resolve to **8.2px** — the same size as the `YOUR GAME · N ROUNDS` caption beside it and the widget labels below, so no new type size is introduced.

The abbreviations already appear on the Stats page and in the widget stat catalogue, so they are existing vocabulary rather than new.

**Axis lines shorten** from `15–125` to `24–116` so they stop short of the labels instead of running underneath them.

**Colour:** `var(--text-muted)` keeps the labels secondary to the plotted data. It clears WCAG AA on `--surface` at 5.62:1 following the Phase 2 contrast fix.

## Out of scope

- Panel height. It stays 128px; the widget grid below must not move.
- Accessible labelling. The SVG keeps `aria-hidden="true"`: announcing "OTT APP ATG PUTT" with no values attached would be noise, and the real figures are in the adjacent text column, which is what a screen reader reads. Proper accessible charting is a larger separate job.
- The empty and loading states, which render a message rather than the chart.
- The ±3.0 radar scale, still unverified against real account data.

## Verification

Screenshots at 320px and at 390×844, confirming:

1. All four labels legible and none clipped at the viewBox edge.
2. The polygon still readable at the reduced size.
3. The panel measures exactly 128px and the widget grid below has not moved.
4. Empty and loading states unaffected.
