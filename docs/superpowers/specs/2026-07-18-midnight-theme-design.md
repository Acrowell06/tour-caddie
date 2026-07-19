# Midnight Theme — Colour System Design

**Date:** 2026-07-18
**Status:** Approved, ready for implementation planning
**Sub-project:** 1 of 3 (palette → buttons/tab bar → motion)

## Problem

The user wants a new look for the app: a different mood, better-looking buttons, and
real motion. That is three separate pieces of work. This spec covers only the first —
the colour system — because the other two depend on it. Button and tab-bar styling
cannot be designed until the accent colour exists, and motion reads differently on a
different background.

## Current state

`pages/tc.css` defines 10 CSS variables, used 607 times across the app. Alongside them
sit **555 hardcoded colour literals**:

| Family | Count |
|---|---|
| Accent green (`#2ECC71`, `rgba(46,204,113,…)`) | 134 |
| White-alpha overlays (`rgba(255,255,255,…)`) | 120 |
| Red (`#E74C3C`, `rgba(231,76,60,…)`) | 30 |
| Other | ~271 |

So the app is half-tokenized. Changing `--green` alone would recolour 144 usages and
leave 134 hardcoded greens behind.

The literals use **27 distinct white-alpha levels** and **24 distinct green-tint
alphas**. Collapsing these into a small scale would visibly change the app, so the
token design must preserve each call site's exact alpha.

## Chosen direction: Midnight

Deep navy with an electric cyan accent, selected from three rendered options.

**These values are the Phase 2 and Phase 3 targets, not Phase 1's.** Phase 1 introduces
these token *names* carrying today's existing colours, so nothing changes visually. The
values below are applied only once the token structure is proven.

### Dark values

| Token | Value |
|---|---|
| `--bg` | `#080C14` |
| `--surface` | `#101827` |
| `--surface-2` | `#18202F` |
| `--border` | `#1D2839` |
| `--text` | `#E8EDF5` |
| `--text-muted` | `#7A8699` |
| `--text-dim` | `#4A5568` |
| `--accent` | `#38BDD0` |
| `--text-on-accent` | `#04080F` |
| `--good` | `#4ADE80` |
| `--bad` | `#EF6262` |
| `--danger` | `#EF6262` |
| `--gold` | `#F1C40F` |

### Light values

| Token | Value |
|---|---|
| `--bg` | `#F4F7FB` |
| `--surface` | `#FFFFFF` |
| `--surface-2` | `#F1F5F9` |
| `--border` | `#E2E8F0` |
| `--text` | `#0F1729` |
| `--text-muted` | `#64748B` |
| `--text-dim` | `#94A3B8` |
| `--accent` | `#0E8496` |
| `--text-on-accent` | `#FFFFFF` |
| `--good` | `#15803D` |
| `--bad` | `#D32F2F` |
| `--danger` | `#D32F2F` |
| `--gold` | `#B7791F` |

The light accent is darker than the dark-theme cyan because `#38BDD0` on white fails
text contrast.

## Channel tokens

Translucent tints must keep their exact alpha per call site. Tokenizing finished
colours cannot do that, so the base colours are also exposed as space-separated RGB
channel triplets:

| Token | Dark | Light |
|---|---|---|
| `--ink-rgb` | `255 255 255` | `0 0 0` |
| `--accent-rgb` | `56 189 208` | `14 132 150` |
| `--good-rgb` | `74 222 128` | `21 128 61` |
| `--bad-rgb` | `239 98 98` | `211 47 47` |

Every existing translucent literal converts by keeping its alpha:

```css
rgba(255,255,255,0.04)  →  rgb(var(--ink-rgb) / 0.04)
rgba(46,204,113,0.3)    →  rgb(var(--accent-rgb) / 0.3)   /* if chrome */
rgba(46,204,113,0.3)    →  rgb(var(--good-rgb) / 0.3)     /* if performance */
```

This was verified in the browser: `rgb(var(--ink-rgb) / 0.04)` computes to
`rgba(255, 255, 255, 0.04)`, byte-identical to the literal.

**`color-mix()` must not be used.** It computes to a different string format
(`color(srgb …)`), which would break the automated before/after comparison that Phase 1
depends on.

## The green and red split

`--green` currently serves two unrelated purposes, which diverge under Midnight:

- **UI chrome and interaction** → `--accent` (cyan): buttons, active tab, focus states,
  links, the Edit button, "＋ Add Widget", selected states.
- **Performance meaning** → `--good` (green): under par, positive strokes gained, the
  "Best" callout, improvement trends.

Red splits the same way: `--danger` for destructive actions (Delete, Sign Out
confirmations), `--bad` for scoring meaning (over par, negative strokes gained). Both
carry the same value initially; the distinction exists so they can diverge later.

**Every one of the 144 `var(--green)` uses and 134 hardcoded greens must be classified
individually.** This cannot be a find-and-replace. The same applies to the 30 reds.
This classification is the substantive work of this sub-project.

Where a usage is genuinely ambiguous, the deciding question is: *would this element
still be this colour if the user were playing badly?* If yes, it is chrome (`--accent`).
If no, it is performance (`--good`).

## Theme selection

`prefers-color-scheme` provides the default. A `data-theme="light"` or
`data-theme="dark"` attribute on `<html>` overrides it when the user has chosen
explicitly.

```css
:root { /* dark values */ }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { /* light */ } }
:root[data-theme="light"] { /* light values */ }
```

A new shared `pages/tc-theme.js` reads the stored preference and sets the attribute.
**It must execute before first paint** — included in `<head>`, before the stylesheet
renders content — otherwise the wrong theme flashes on load.

The preference is stored in `profiles.theme_preference` (`'light' | 'dark' | 'auto'`,
default `'auto'`), following the existing pattern used by `default_tee_key` and
`distance_unit` (added in `supabase/migrations/0005_add_golf_settings.sql`). It requires
a new migration, `0009_add_theme_preference.sql` — the latest existing migration is
`0008_add_profiles_insert_policy.sql`. Because the value is needed before the
network round-trip completes, it is also mirrored to `localStorage` and read from there
on startup; the database value is the source of truth across devices and reconciles the
local copy when it arrives.

Profile gets a Light / Dark / Automatic control in the existing Golf or Display
settings section.

## The hole screen

`pages/hole.html` keeps dark chrome in **both** themes. Its panels sit over Leaflet
satellite photography, where light panels are a legibility problem; mapping apps
universally keep dark or heavily shaded controls over satellite view regardless of
theme.

Its overlay surfaces use a separate `--map-surface` / `--map-text` token pair whose
values do not change between themes.

## Phasing

Each phase is independently shippable and independently verifiable.

**Phase 1 — Tokenize with no visible change.** Introduce the full token set with dark
values set to *exactly today's colours*. Convert all 555 literals. Classify every green
and red. The app must look pixel-identical when this lands.

**Phase 2 — Apply Midnight to dark.** Change the dark token values to the table above.
A small edit, because Phase 1 did the structural work.

**Phase 3 — Add light.** Second value set, `prefers-color-scheme`, `tc-theme.js`, the
migration, and the Profile control. Checked screen by screen.

**Each phase gets its own implementation plan.** They are not one plan with three
sections: Phase 1 is a large mechanical conversion across 11 files, Phase 2 is a handful
of value edits, and Phase 3 adds a migration, a shared script, and a settings control.
Combining them would produce a plan too large to execute or review in one pass, and
would forfeit the checkpoint after Phase 1 that makes the rest safe.

## Verification

**Phase 1 is verified programmatically, not by eye.** For every page, capture the
computed colour of a fixed list of elements before the change, capture again after, and
diff the two JSON files. Any difference is a defect.

The captured properties are `color`, `background-color`, `border-color`, and `fill`, for
every element in the DOM, keyed by a stable path. Both captures run in the same browser
at the same viewport so the comparison is exact.

This matters because a 555-instance edit is far too large to eyeball, and "looks about
right" would let a wrong tint through.

Phases 2 and 3 are verified by screenshots at 320px and 390×844, in both themes, on
every page, plus a contrast check: body text against its background must meet WCAG AA
(4.5:1) in both themes.

Pages requiring verification: all 11 in `pages/`.

## Out of scope

- Tab bar and button restyling — sub-project 2.
- Motion, transitions, and `prefers-reduced-motion` — sub-project 3.
- Typography, layout, spacing, corner radii.
- Consolidating the 27 alpha levels into a smaller scale. Tempting, but it changes
  appearance and would undermine Phase 1's guarantee. It can be a later cleanup.
- `pages/index.html` has no colour literals and needs no changes beyond the theme
  script if it renders UI.

## Risks

- **Misclassifying a green** produces a cyan element that should read as "good", or a
  green button. Caught by review of the classification, not by the automated diff —
  Phase 1's diff proves colours did not *change*, not that they were labelled correctly.
- **Flash of wrong theme** if `tc-theme.js` loads late. Mitigated by head placement and
  the localStorage mirror.
- **Light mode on dense screens.** `scorecard.html` (106 literals) and `stats.html` carry
  meaning in colour; they need the most care in Phase 3.
