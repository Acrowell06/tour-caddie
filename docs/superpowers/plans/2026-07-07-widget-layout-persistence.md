# Widget Layout Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `home.html`'s dashboard widget layout (`widgetConfig`) to Supabase so a golfer's customized dashboard survives reload and follows them across devices.

**Architecture:** One new nullable `profiles.widget_layout jsonb` column stores the `widgetConfig` array directly. `home.html`'s existing init fetch is extended to load it (falling back to today's hardcoded default on `null` or any error), and a new `saveWidgetLayout()` helper is wired into the four existing mutating actions (remove, resize, slot-assign, add) — no new UI.

**Tech Stack:** Plain HTML/JS (no build step), Supabase JS client (`TcAuth.client`).

## Global Constraints

- The write is always a plain `.update({...}).eq('id', session.user.id)` against the golfer's own already-existing `profiles` row — never `.insert()`/`.upsert()`.
- A golfer who has never customized their dashboard (`widget_layout` is `null`) sees today's hardcoded default layout, unchanged.
- Malformed/unexpected saved data must never break the dashboard — fall back to the hardcoded default and re-render successfully.
- A failed save shows an error toast (`showToast('toast', 'Failed to save layout — try again')`) and does not roll back the golfer's local edit — matching the existing no-rollback pattern already used for Default Tee/Home Course/Distance Units.
- No new UI, no new user-facing controls — every mutating action (remove, resize, slot-assign, add) already exists; this plan only adds a save call alongside each.
- `nextId` (used to generate new widget ids) is *derived* from the loaded widgets' own ids, never persisted as a separate field, so it can't drift out of sync with the array it describes.

---

### Task 1: Migration — add `widget_layout` column to `profiles`

**Files:**
- Create: `supabase/migrations/0006_add_widget_layout.sql`

**Interfaces:**
- Produces: `profiles.widget_layout` (`jsonb`, nullable) — consumed by Task 2.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0006_add_widget_layout.sql

-- Stores home.html's widgetConfig array ({id, size, slots[]}[]) directly as
-- jsonb. Null means "never customized" — home.html falls back to its
-- hardcoded default layout in that case.
alter table public.profiles add column if not exists widget_layout jsonb;
```

- [ ] **Step 2: Run the migration against the live Supabase project**

Paste the contents of `supabase/migrations/0006_add_widget_layout.sql` into the Supabase SQL Editor and run it. Confirm no errors.

Verify the column exists:

```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='profiles' and column_name='widget_layout';
```

Expected: one row, `widget_layout | jsonb`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0006_add_widget_layout.sql
git commit -m "feat: add widget_layout column to profiles"
```

---

### Task 2: `pages/home.html` — read/write the widget layout

**Files:**
- Modify: `pages/home.html`

**Interfaces:**
- Consumes: `TcAuth.getSession()`, `TcAuth.client` (already loaded), `showToast(elId, msg)` (from `tc-utils.js`, already loaded), `profiles.widget_layout` from Task 1.
- Produces: nothing consumed by later tasks — this is the final task in the plan.

- [ ] **Step 1: Add a toast element**

`home.html` doesn't have one today (unlike `profile.html`/`rounds.html`), so a failed save would silently show nothing. The CSS (`.toast`/`.toast.show`) already exists globally in `tc.css`.

Find:
```html
    <div class="picker-list" id="picker-list"></div>
  </div>
</div>

</div><!-- /wrap -->
```

Replace:
```html
    <div class="picker-list" id="picker-list"></div>
  </div>
</div>

<div class="toast" id="toast"></div>

</div><!-- /wrap -->
```

- [ ] **Step 2: Add `deriveNextId()` and `saveWidgetLayout()`**

Find:
```js
function closePicker() {
  document.getElementById('picker-ov').classList.remove('open');
}
```

Replace:
```js
function closePicker() {
  document.getElementById('picker-ov').classList.remove('open');
}

/* ══ WIDGET LAYOUT PERSISTENCE ══ */
// Derives the next widget id from the loaded widgets' own ids (rather than
// persisting a separate counter) so it can never drift out of sync with the
// array it's supposed to describe.
function deriveNextId(widgets) {
  let max = -1;
  widgets.forEach(w => {
    const n = parseInt(String(w.id).replace(/^w/, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max + 1;
}

async function saveWidgetLayout() {
  const session = await TcAuth.getSession();
  if (!session) return;
  const { error } = await TcAuth.client.from('profiles').update({ widget_layout: widgetConfig }).eq('id', session.user.id);
  if (error) showToast('toast', 'Failed to save layout — try again');
}
```

- [ ] **Step 3: Wire `saveWidgetLayout()` into the remove-widget action**

Find:
```js
    rm.onclick = () => { widgetConfig = widgetConfig.filter(x => x.id !== w.id); renderWidgets(); };
```

Replace:
```js
    rm.onclick = () => { widgetConfig = widgetConfig.filter(x => x.id !== w.id); renderWidgets(); saveWidgetLayout(); };
```

- [ ] **Step 4: Wire `saveWidgetLayout()` into resize**

Find:
```js
function changeSize(id, newSize) {
  const w = widgetConfig.find(x => x.id === id);
  if (!w || w.size === newSize) return;
  const n   = SIZE_SLOTS[newSize];
  const old = w.slots.slice();
  // Grow: pad with nulls. Shrink: trim from end.
  w.slots = n > old.length
    ? [...old, ...Array(n - old.length).fill(null)]
    : old.slice(0, n);
  w.size = newSize;
  renderWidgets();
}
```

Replace:
```js
function changeSize(id, newSize) {
  const w = widgetConfig.find(x => x.id === id);
  if (!w || w.size === newSize) return;
  const n   = SIZE_SLOTS[newSize];
  const old = w.slots.slice();
  // Grow: pad with nulls. Shrink: trim from end.
  w.slots = n > old.length
    ? [...old, ...Array(n - old.length).fill(null)]
    : old.slice(0, n);
  w.size = newSize;
  renderWidgets();
  saveWidgetLayout();
}
```

- [ ] **Step 5: Wire `saveWidgetLayout()` into slot assignment**

Find:
```js
    item.onclick = () => {
      const ww = widgetConfig.find(x => x.id === editSlot.widgetId);
      if (ww) ww.slots[editSlot.slotIdx] = key;
      closePicker();
      renderWidgets();
    };
```

Replace:
```js
    item.onclick = () => {
      const ww = widgetConfig.find(x => x.id === editSlot.widgetId);
      if (ww) ww.slots[editSlot.slotIdx] = key;
      closePicker();
      renderWidgets();
      saveWidgetLayout();
    };
```

- [ ] **Step 6: Wire `saveWidgetLayout()` into add-widget**

Find:
```js
    item.onclick = () => {
      widgetConfig.push({ id:'w'+nextId++, size:opt.size, slots:Array(SIZE_SLOTS[opt.size]).fill(null) });
      closePicker();
      renderWidgets();
    };
```

Replace:
```js
    item.onclick = () => {
      widgetConfig.push({ id:'w'+nextId++, size:opt.size, slots:Array(SIZE_SLOTS[opt.size]).fill(null) });
      closePicker();
      renderWidgets();
      saveWidgetLayout();
    };
```

- [ ] **Step 7: Load the saved layout in the init fetch, with a safe fallback**

Find:
```js
(async () => {
  const session = await TcAuth.getSession();
  if (!session) return;
  const { data } = await TcAuth.client.from('profiles').select('handicap_index, display_name').eq('id', session.user.id).single();
  const nameEl = document.getElementById('greet-name');
  if (nameEl && data?.display_name) nameEl.textContent = data.display_name;
  if (data?.handicap_index != null) {
    STATS['handicap'].value = (data.handicap_index >= 0 ? '+' : '') + data.handicap_index;
    renderWidgets();
  }
```

Replace:
```js
(async () => {
  const session = await TcAuth.getSession();
  if (!session) return;
  const { data } = await TcAuth.client.from('profiles').select('handicap_index, display_name, widget_layout').eq('id', session.user.id).single();
  const nameEl = document.getElementById('greet-name');
  if (nameEl && data?.display_name) nameEl.textContent = data.display_name;
  if (data?.handicap_index != null) {
    STATS['handicap'].value = (data.handicap_index >= 0 ? '+' : '') + data.handicap_index;
    renderWidgets();
  }

  if (data?.widget_layout != null && Array.isArray(data.widget_layout)) {
    const previousConfig = widgetConfig;
    try {
      widgetConfig = data.widget_layout;
      nextId = deriveNextId(widgetConfig);
      renderWidgets();
    } catch {
      // Malformed saved layout — restore and re-render today's hardcoded default.
      widgetConfig = previousConfig;
      renderWidgets();
    }
  }
```

Note: `data.widget_layout == null` (never customized) or not an array (unexpected shape) both fall through silently — `widgetConfig` stays the hardcoded default that was already rendered synchronously at page load, before this async block ran.

- [ ] **Step 8: Syntax check**

```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('pages/home.html', 'utf8');
const scripts = [...content.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```

Expected: all blocks `OK`, no errors.

- [ ] **Step 9: Manual browser verification**

With `pages/` served locally and signed in:

1. Enter Edit mode, add a widget, resize one, reassign a slot, remove one → reload the page → confirm the exact customized layout is still there, not the hardcoded default.
2. Check `profiles.widget_layout` in the Supabase Table Editor after each of those actions — confirm it updates each time.
3. Sign in as (or simulate) an account that has never customized its dashboard → confirm it still shows today's hardcoded 4-widget default.
4. Remove every widget, reload → confirm an empty dashboard renders without error (an intentionally-emptied `[]` layout, not a fallback to the default).

- [ ] **Step 10: Commit**

```bash
git add pages/home.html
git commit -m "feat: persist dashboard widget layout to profiles"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| New nullable `profiles.widget_layout jsonb` column | Task 1 |
| Read on init, patch in place, matching existing handicap/SG pattern | Task 2 Step 7 |
| Never-customized (`null`) falls back to hardcoded default | Task 2 Step 7 (falls through, `widgetConfig` untouched) |
| Malformed data falls back safely, no crash | Task 2 Step 7 (`previousConfig` restore in catch) |
| `nextId` derived, never persisted separately | Task 2 Step 2 (`deriveNextId`), Step 7 (called on load) |
| Save on every mutating action (remove/resize/assign/add) | Task 2 Steps 3, 4, 5, 6 |
| Failed save shows a toast, no rollback of local edit | Task 2 Step 2 (`saveWidgetLayout`'s `if (error) showToast(...)`) |
| `home.html` needs a toast element (doesn't have one today) | Task 2 Step 1 |
| No new UI/controls | Task 2 (confirmed — every step only adds a function call alongside existing handlers, or a hidden-by-default toast div) |

**Placeholder scan:** no TBD/TODO; every step has literal code or an exact verification procedure.

**Type consistency:** `widgetConfig`'s `{id, size, slots[]}` shape is unchanged from what already exists in the file — Task 2 only ever assigns a full replacement array to the same variable, never a differently-shaped object. `deriveNextId(widgets)` takes the same array shape `widgetConfig` already is. `saveWidgetLayout()` takes no arguments and reads the current module-level `widgetConfig` directly, consistent with how the file's existing functions (`changeSize`, the picker handlers) already mutate that same module-level variable in place.
