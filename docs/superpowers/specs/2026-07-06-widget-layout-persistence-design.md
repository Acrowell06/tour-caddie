# Widget Layout Persistence — Design Spec

## Context

Tour Caddie is a plain HTML/JS/CSS prototype backed by a real Supabase project. This is the last remaining piece of the "profile/settings + widget-layout persistence" pairing started after the Strokes Gained engine — [[golf-settings-persistence]] already shipped Default Tee, Home Course, and Distance Units.

`pages/home.html`'s dashboard already has a fully-working widget system: golfers can add widgets (small/medium/large), remove them, resize them, and assign any stat from the `STATS` catalogue to any slot via a tap-to-pick sheet. None of it is fake or mocked — the gap is purely that `widgetConfig` (the array of `{id, size, slots[]}` describing the current layout) lives only in an in-memory `let`, resetting to the same hardcoded 4-widget default on every reload.

## Scope

**In scope:**
- Persisting `widgetConfig` to Supabase so a golfer's customized dashboard survives reload and follows them across devices.
- Wiring the save into every existing mutating action (remove, resize, slot-assign, add) — no new UI.
- Graceful fallback to today's hardcoded default layout when nothing has been saved yet, or if saved data is ever malformed.

**Out of scope:**
- Any change to the widget system's existing behavior, UI, or the `STATS` catalogue itself.
- Drag-to-reorder (no such feature exists in the current code — only add/remove/resize/reassign).

## Architecture

**Data model:** one new nullable column, `profiles.widget_layout jsonb`, storing the `widgetConfig` array directly (`[{id, size, slots[]}, ...]`). No new table — consistent with how the golf settings columns were added directly to `profiles`.

**Read flow:** `home.html`'s existing init fetch (which already selects `handicap_index, display_name`) extends its `.select(...)` to also pull `widget_layout`. If present, it replaces the in-memory `widgetConfig` and calls `renderWidgets()` again — mirroring the exact same "render default immediately, then patch in the real value once the fetch resolves" pattern already used for the `handicap`/`sg-*` stat values in this same file. If `null` (never customized), today's hardcoded default array is left untouched. The whole replacement is wrapped in a try/catch that falls back to the hardcoded default on any error, so a future schema change or corrupted row can never break the dashboard.

A new `nextId` (used to generate the next widget's id, e.g. `'w4'`) is *derived* from the loaded widgets' own ids (`1 + the highest existing numeric suffix`) rather than persisted as a separate field — this makes it impossible for a stored `nextId` to drift out of sync with the widgets array it's supposed to describe.

**Write flow:** a new `saveWidgetLayout()` async helper (`getSession()` → `.update({ widget_layout: widgetConfig }).eq('id', ...)`) is called at the end of the four existing mutating functions: the remove-widget handler, `changeSize()`, the slot-picker's assign handler, and the add-widget handler. Each of those already calls `renderWidgets()` immediately after mutating `widgetConfig` — the save call sits right alongside that, firing in the background without blocking the UI.

## Error handling

- **No saved layout yet:** today's hardcoded default renders, exactly as it does now — nothing changes for a golfer who's never opened Edit mode.
- **Malformed saved data** (wrong shape, unknown future format): caught during the read, falls back to the hardcoded default rather than crashing or rendering a broken grid.
- **A failed save:** shows an error toast (`showToast('toast', 'Failed to save layout — try again')`), same pattern as every other setting in this app. The local UI change is not rolled back — matching the existing no-rollback behavior already accepted for Default Tee/Home Course/Distance Units. This requires adding one small `<div class="toast" id="toast"></div>` element to `home.html`, since it doesn't have one today (unlike `profile.html`/`rounds.html`) — the CSS for it already exists globally in `tc.css`.

## Testing / verification

Manual, end-to-end, no automated suite (consistent with the rest of this codebase):
1. Enter Edit mode, add a widget, resize one, reassign a slot, remove one → reload the page → confirm the exact customized layout is still there, not the default.
2. Sign in as (or simulate) an account that has never customized its dashboard → confirm it still shows today's hardcoded default layout.
3. Remove every widget, reload → confirm an empty dashboard renders without error (not a fallback to the default — the golfer explicitly chose empty).
4. Confirm a save failure (e.g. simulate by briefly going offline mid-edit) shows the error toast and doesn't silently pretend to succeed.
