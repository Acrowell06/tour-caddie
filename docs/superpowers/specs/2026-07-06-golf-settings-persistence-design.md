# Golf Settings Persistence — Design Spec

## Context

Tour Caddie is a plain HTML/JS/CSS prototype backed by a real Supabase project. Sub-projects 1-4 (auth, rounds/shots persistence, WHS handicap engine, Strokes Gained engine) are merged. `pages/profile.html`'s Golf sub-screen has three settings — Default Tee, Home Course, Distance Units — that are all in-memory only today: they reset to hardcoded fake defaults ("Tips", "Pebble Beach", "Yards") on every page reload, and neither Default Tee nor Home Course connects to any real data. `pages/home.html`'s widget layout has the same in-memory-only problem but is explicitly out of scope for this sub-project (see Scope below).

## Data gap this sub-project closes

None of the three Golf settings survive a reload, and two of them are disconnected from real data:

1. **Default Tee** picks from a fake 4-option list (Tips/Back/Middle/Forward) that doesn't match the real 5 canonical tee keys (`tips`/`blue`/`white`/`gold`/`red`) `pages/rounds.html`'s `TEE_CANONICAL` already defines and uses for real per-course tee data.
2. **Home Course** picks from a hardcoded list of 13 famous courses (Augusta National, Pebble Beach, etc.), completely disconnected from the real OpenStreetMap/Nominatim course search `pages/rounds.html` already uses via `TcCourse.searchByName`.
3. **Distance Units** (Yards/Metres) toggles a variable nothing else in the app reads — it has zero effect anywhere today.

## Scope

**In scope:**
- Persisting Default Tee (as a canonical tee-key preference), Home Course (as a real, geolocated course), and Distance Units to the `profiles` table.
- Replacing `profile.html`'s fake tee list and fake course list with real data sources already used elsewhere in the app.
- Using the persisted Default Tee / Home Course to pre-fill `pages/rounds.html`'s round-setup wizard (still fully overridable).

**Out of scope (explicit cuts, decided during brainstorming):**
- Account editing (Display Name, Email, Password) — still "coming soon" toasts, untouched. Bigger scope: would touch Supabase Auth itself, not just the `profiles` table.
- Notification toggles (Push/Round Reminders/Friend Activity) — no push infrastructure exists at all; persisting these would just store unused preferences. Untouched.
- `home.html`'s widget layout (which widgets, sizes, order, slot contents) — currently resets to a hardcoded default every reload. A real gap, but independent of Golf settings; left for its own future sub-project.
- Actually converting displayed distances (live GPS yardages in `hole.html`, tee yardages in `rounds.html`, round history in `courses.html`/`stats.html`) to honor the Distance Units preference. The preference is persisted; no display anywhere is changed to read it. This was an explicit scope decision, not an oversight — full unit-conversion wiring across every distance display in the app is a materially bigger, separate piece of work.
- Any change to the friends system (`profile.html`'s Friends list, search, add-friend) — entirely mock data, unrelated to golf settings, not touched.

## Architecture

**Schema** (new migration, adding to the live `profiles` table — confirmed via live schema check that current columns are `id, display_name, avatar_url, home_club, handicap_index, created_at, email`):

- Reuse the existing `home_club` (`text`) column for the course name — it already exists, is currently unused by any client code, and matches semantically. No rename (avoids risk to a column that predates this repo's migrations).
- Add `home_club_lat double precision`, `home_club_lng double precision` (nullable) — `home_club` alone can't be used to re-look-up the course's real tee/hole data; `TcCourse.loadNear(lat, lng)` needs coordinates, matching exactly how `rounds.html`'s `sel.course` object already carries `{name, lat, lng}`.
- Add `default_tee_key text` (nullable) — one of `'tips'|'blue'|'white'|'gold'|'red'`, matching `rounds.html`'s existing `TEE_CANONICAL` keys. A canonical color preference, not tied to any specific course — applied whenever the chosen course has real yardage data for that key, exactly like `rounds.html`'s existing tee-list rendering already handles missing yardage (shows "Yardage unknown" / manual entry) for any tee, regardless of how it got selected.
- Add `distance_unit text default 'yards'` (nullable, defaults to today's implicit behavior) — `'yards'|'metres'`.

All writes are plain `.update({...}).eq('id', session.user.id)` against the user's own already-existing row (every authenticated user has a `profiles` row from the signup trigger). No `.insert()`/`.upsert()` is introduced anywhere in this sub-project, so the existing `UPDATE` RLS policy (`auth.uid() = id`) fully covers every write this feature makes. The previously-flagged missing-`INSERT`-policy gap remains real and open for whenever a true insert/upsert flow is built, but this sub-project never exercises that path.

**`pages/profile.html` changes:**

1. Replace the fake `TEES` array with the real `TEE_CANONICAL` list (same `{key, name, color}` shape as `rounds.html`'s, duplicated inline — this codebase has no shared constants module, and 5 static entries isn't enough to justify introducing one).
2. Replace the fake `ALL_COURSES` array and its `filterCourses`/`renderCourseList`/`selectCourse` functions with a real search calling `TcCourse.searchByName(query)` (the same Nominatim-backed call `rounds.html`'s Search tab uses), debounced the same way (600ms). No Favorites/Nearby tabs — this is a one-time settings pick, not the round-start flow, so only Search is needed.
3. On page load, fetch `home_club, home_club_lat, home_club_lng, default_tee_key, distance_unit` from `profiles` and render them into the Golf sub-screen's rows. Any null field shows an honest "Not set" placeholder — never a fake default.
4. Each selection (tee pick, course pick, unit toggle) writes immediately via `.update(...)` — no separate Save button, consistent with this screen's existing iOS-settings-row style. A failed write shows an error toast via the existing `showToast(...)` helper and does not update the displayed value as if it succeeded.

**`pages/rounds.html` changes:**

1. When the round-setup wizard's Course step first renders, if `sel.course` is not already set (i.e. the golfer hasn't picked anything yet this session — this guard prevents re-entering the Course step, e.g. via the wizard's back button, from clobbering a course they already chose) and the golfer has `home_club_lat`/`home_club_lng` set (fetched once at wizard start), pre-fill `sel.course = { name: home_club, lat: home_club_lat, lng: home_club_lng }` and trigger the same `TcCourse.loadNear(...)` call a real click on that course would — the golfer can still search and pick a different course exactly as today.
2. Once `teeCourseData` resolves for the (possibly pre-filled) course, if the golfer has `default_tee_key` set and that key has real yardage data (`yardages[key] != null`, from the existing `computeTeeYardages` logic) or a cached manual entry for that course, pre-select that tee the same way clicking it would (`sel.tee = {...}`). If the preferred key has no data at all for this course, no tee is pre-selected — identical to today's behavior when nothing has been picked yet.

## Error handling & edge cases

- **No settings ever saved** (new account, or account created before this feature existed): `rounds.html`'s wizard behaves exactly as it does today — blank course search, no pre-selected tee. `profile.html`'s Golf screen shows "Not set" for each unconfigured row instead of the current fake defaults.
- **Home Course set, but its real tee data lacks yardage for `default_tee_key`**: the tee still gets pre-selected in `rounds.html`; the existing "Yardage unknown / Enter yardage" manual-entry UI shows exactly as it does today for any tee lacking data, regardless of whether it was pre-selected or manually clicked.
- **Nominatim search failure** in `profile.html`'s Home Course picker: same "Search unavailable" fallback text `rounds.html`'s Search tab already shows on fetch failure.
- **Supabase write failure** (network error, etc.) when saving any of the three settings: an error toast is shown via `showToast(...)`; the setting's displayed value is not optimistically updated — it only changes once the write actually succeeds.
- **Supabase read failure** when `profile.html` loads: Golf screen rows fall back to "Not set" placeholders rather than blocking the rest of the page from rendering.

## Testing / verification

Manual, end-to-end, no automated suite (consistent with the rest of this codebase):

1. In `profile.html`'s Golf screen, set Default Tee to a real tee (e.g. Blue) → reload the page → confirm it still shows Blue, not reset to any default.
2. Search for and select a real Home Course → reload → confirm the same course name persists.
3. Toggle Distance Units → reload → confirm the persisted choice shows (and confirm, as expected, that no distance display anywhere in the app changes as a result — that's out of scope, not a bug).
4. Start a new round via `rounds.html` → confirm the Course step pre-fills with the saved Home Course (and is still changeable) → confirm the Tee step pre-selects the saved Default Tee when that course has real yardage data for it.
5. On an account that has never configured any Golf setting, confirm both pages degrade to today's no-preference behavior — no fake mock data appears anywhere.
