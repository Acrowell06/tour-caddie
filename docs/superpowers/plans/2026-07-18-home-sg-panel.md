# Home Strokes Gained Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent, compact Strokes Gained summary panel to the top of the home screen's scrolling area, fed by the query `home.html` already runs.

**Architecture:** All panel code lives inside `pages/home.html` — CSS in its `<style>` block, markup in the `.hw-scroller`, JS in its inline `<script>`. This matches the project's existing pattern where each page is self-contained and only cross-page concerns live in `tc-*.js`. The panel is driven by four pure functions (derive, geometry, format, render) so its logic can be asserted directly in the browser. One three-line deep-link handler is added to `pages/stats.html`.

**Tech Stack:** Plain HTML/CSS/vanilla JS, Supabase JS client v2, inline SVG. No build step, no framework, no package manager.

## Global Constraints

- This project has **no test framework and no committed tests**. `package.json` has an empty `scripts` block. Do not invent `npm test`. Every verification step in this plan is a real browser observation via the probe harness defined below.
- The live project root is `c:\Users\Abcro\OneDrive\Documents\Claude Projects\Tour-caddie v1`. Edit `pages/`. **Never edit `tour-caddie/`** — it is an untracked duplicate copy of the whole project and changes made there do not reach the repo.
- Radar scale is fixed at **±3.0 strokes**. Task 4 requires checking real data for clamping and reporting it.
- Numeric formatting: two decimal places, explicit `+` for values above zero (`+0.42`, `-1.10`).
- Colour convention: `var(--green)` for values at or above 0.0, `var(--red)` below. Never hardcode hex where a variable exists.
- Category display order in the callouts and radar labels: Off Tee, Approach, Around Green, Putting.
- Empty-state copy, exactly: `No Strokes Gained data yet — play a full round at a mapped course.`
- Errors are logged with `console.error`, never silently swallowed.

## Probe Harness (used by every verification step)

The pages call `TcAuth.requireAuth()` and redirect to login, so they cannot be loaded directly. Build stubbed copies, serve them, then drive with Playwright. Run from the repo root.

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1/pages" && python - <<'EOF'
import re, json
ROUNDS = json.load(open('__fixture.json')) if __import__('os').path.exists('__fixture.json') else []
stub = '''<script>
window.supabase={createClient:()=>({})};
const _rows=''' + json.dumps(ROUNDS) + ''';
const _q={select:()=>_q,eq:()=>_q,neq:()=>_q,not:()=>_q,order:()=>_q,limit:()=>_q,
  single:async()=>({data:{display_name:'Golfer',handicap_index:8.4,widget_layout:null}}),
  update:()=>_q,insert:()=>_q,then:(r)=>r({data:_rows,error:null})};
window.TcAuth={requireAuth:async()=>({user:{id:'u1'}}),getSession:async()=>({user:{id:'u1'}}),
  client:{from:()=>_q,auth:{updateUser:async()=>({})}},signOut:async()=>{},onAuth:()=>{}};
</script>'''
for f in ['home','stats']:
    src = open(f+'.html', encoding='utf-8').read()
    src = re.sub(r'<script src="https://cdn\.jsdelivr\.net/npm/@supabase[^>]*></script>', stub, src)
    src = src.replace('<script src="tc-auth.js"></script>','')
    open('__probe-'+f+'.html','w',encoding='utf-8').write(src)
print('probes built')
EOF
python -m http.server 8791 --bind 127.0.0.1
```

Run the server with `run_in_background: true`. Load `http://127.0.0.1:8791/__probe-home.html`.

To supply test rounds, write `pages/__fixture.json` before building probes. Standard fixture (matches the approved mockup, so rendered output can be compared against it):

```json
[{"sg_ott":-0.60,"sg_app":-1.10,"sg_atg":-0.50,"sg_putt":-0.90,"sg_total":-2.40,"completed_at":"2026-06-28T15:30:00Z"},
 {"sg_ott":-0.60,"sg_app":-1.10,"sg_atg":-0.50,"sg_putt":-0.90,"sg_total":-3.80,"completed_at":"2026-06-21T15:30:00Z"}]
```

**Cleanup after every task:** `rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp`. Never commit probe or fixture files.

## File Structure

- **Modify `pages/home.html`** — panel CSS (~40 lines in `<style>`), one markup container in `.hw-scroller`, ~90 lines of JS. Responsibility: the whole panel.
- **Modify `pages/stats.html`** — 3 lines at init. Responsibility: honour `?stat=<id>`.

No new files. `home.html` grows from ~580 to ~715 lines, which stays in line with the project's other pages (`stats.html` is ~830, `profile.html` ~870).

---

### Task 1: Data derivation and radar geometry

Pure functions only — no DOM, no network. Everything here is directly assertable.

**Files:**
- Modify: `pages/home.html` — add to the inline `<script>`, immediately after the `SIZE_SLOTS` constant (~line 258)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SG_CATS` — array of `{ key, label, name, angle }` for the four categories.
  - `deriveSgPanel(rounds)` → `null` when `rounds` is empty/missing, else `{ total, count, lastValue, lastDate, cats, best, worst }` where `cats` is an array of `{ key, label, name, angle, value }` and `best`/`worst` are members of that array.
  - `sgRadarPoint(value, angleDeg, cx, cy, rZero, rMax)` → `{ x, y }`.
  - `fmtSg(value)` → string, two decimals with explicit sign.
  - `sgColor(value)` → CSS variable string.

- [ ] **Step 1: Add the constants and pure functions**

Insert after the `const SIZE_SLOTS = ...` line in `pages/home.html`:

```javascript
/* ══ SG PANEL — DATA ══
   Radar scale is fixed so the shape stays comparable between visits.
   Values beyond ±SG_RADAR_SCALE clamp to the chart edge. */
const SG_RADAR_SCALE = 3.0;

const SG_CATS = [
  { key:'sg_ott',  label:'OFF TEE',    name:'Off tee',    angle:0   },
  { key:'sg_app',  label:'APPROACH',   name:'Approach',   angle:90  },
  { key:'sg_atg',  label:'AROUND GRN', name:'Around grn', angle:180 },
  { key:'sg_putt', label:'PUTTING',    name:'Putting',    angle:270 },
];

function fmtSg(v) { return (v > 0 ? '+' : '') + v.toFixed(2); }

function sgColor(v) { return v >= 0 ? 'var(--green)' : 'var(--red)'; }

/* rounds: newest first, each with the five sg_* columns and completed_at. */
function deriveSgPanel(rounds) {
  if (!rounds || rounds.length === 0) return null;
  const avg = k => rounds.reduce((a, r) => a + (r[k] || 0), 0) / rounds.length;
  const cats = SG_CATS.map(c => ({ ...c, value: avg(c.key) }));
  const ranked = [...cats].sort((a, b) => b.value - a.value);
  return {
    total:     avg('sg_total'),
    count:     rounds.length,
    lastValue: rounds[0].sg_total,
    lastDate:  rounds[0].completed_at,
    cats,
    best:      ranked[0],
    worst:     ranked[ranked.length - 1],
  };
}

/* Maps a category value onto the radar. rZero is the dashed tour-average
   circle; rMax is the outer ring. Angle 0 is straight up, growing clockwise. */
function sgRadarPoint(value, angleDeg, cx, cy, rZero, rMax) {
  const clamped = Math.max(-SG_RADAR_SCALE, Math.min(SG_RADAR_SCALE, value));
  const r = Math.max(3, rZero + (clamped / SG_RADAR_SCALE) * (rMax - rZero));
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
```

- [ ] **Step 2: Build probes and start the server**

Write the standard fixture to `pages/__fixture.json`, then run the probe harness block above with `run_in_background: true`.

- [ ] **Step 3: Assert the pure functions in the browser**

Navigate to `http://127.0.0.1:8791/__probe-home.html`, then evaluate:

```javascript
() => {
  const out = [];
  const ok = (name, actual, expected) =>
    out.push({ name, actual, expected, pass: JSON.stringify(actual) === JSON.stringify(expected) });

  ok('empty returns null', deriveSgPanel([]), null);
  ok('missing returns null', deriveSgPanel(null), null);

  const d = deriveSgPanel([
    { sg_ott:-0.60, sg_app:-1.10, sg_atg:-0.50, sg_putt:-0.90, sg_total:-2.40, completed_at:'2026-06-28T15:30:00Z' },
    { sg_ott:-0.60, sg_app:-1.10, sg_atg:-0.50, sg_putt:-0.90, sg_total:-3.80, completed_at:'2026-06-21T15:30:00Z' },
  ]);
  ok('count', d.count, 2);
  ok('total is the mean', Math.round(d.total * 100) / 100, -3.1);
  ok('lastValue is newest row', d.lastValue, -2.40);
  ok('lastDate is newest row', d.lastDate, '2026-06-28T15:30:00Z');
  ok('worst is approach', d.worst.key, 'sg_app');
  ok('best is around green', d.best.key, 'sg_atg');
  ok('cats keep display order', d.cats.map(c => c.key), ['sg_ott','sg_app','sg_atg','sg_putt']);

  ok('format negative', fmtSg(-1.1), '-1.10');
  ok('format positive carries +', fmtSg(0.42), '+0.42');
  ok('format zero has no sign', fmtSg(0), '0.00');
  ok('colour below tour', sgColor(-0.1), 'var(--red)');
  ok('colour at tour', sgColor(0), 'var(--green)');

  const zero = sgRadarPoint(0, 0, 70, 70, 30, 55);
  ok('zero sits on the dashed ring', [Math.round(zero.x), Math.round(zero.y)], [70, 40]);
  const max = sgRadarPoint(3, 90, 70, 70, 30, 55);
  ok('full positive reaches outer ring (east)', [Math.round(max.x), Math.round(max.y)], [125, 70]);
  const over = sgRadarPoint(99, 90, 70, 70, 30, 55);
  ok('beyond scale clamps to outer ring', [Math.round(over.x), Math.round(over.y)], [125, 70]);
  const under = sgRadarPoint(-99, 180, 70, 70, 30, 55);
  ok('far negative clamps to inner radius (south)', [Math.round(under.x), Math.round(under.y)], [70, 75]);

  return { failures: out.filter(t => !t.pass), passed: out.filter(t => t.pass).length };
}
```

Expected: `{ failures: [], passed: 18 }`. If any test fails, fix the implementation — do not adjust the expectation to match the code.

- [ ] **Step 4: Clean up and commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git add pages/home.html
git commit -m "feat: add SG panel data derivation and radar geometry"
```

---

### Task 2: Panel CSS, markup, and renderer

Renders a fully populated panel from a `deriveSgPanel` result. Still no network — Task 3 wires live data.

**Files:**
- Modify: `pages/home.html` — CSS into `<style>`; container into `.hw-scroller`; JS after the Task 1 functions

**Interfaces:**
- Consumes: `deriveSgPanel`, `sgRadarPoint`, `fmtSg`, `sgColor`, `SG_RADAR_SCALE` from Task 1.
- Produces:
  - `sgRadarSvg(cats, colorHex)` → SVG markup string.
  - `renderSgPanel(data)` → void; renders into `#sg-panel`. `null` renders the empty state.
  - `sgPanelMessage(text)` → void; renders a one-line message at full panel height.

- [ ] **Step 1: Add the CSS**

Insert into the `<style>` block, after the `.wx-strip` rules:

```css
/* ─── SG PANEL ─── */
.sg-panel { flex-shrink:0; margin:4px 12px 0; padding:11px 12px; background:var(--surface); border:1px solid var(--border); border-radius:12px; min-height:106px; box-sizing:border-box; cursor:pointer; }
.sg-panel:active { background:rgba(255,255,255,0.03); }
.sg-panel.inert { cursor:default; }
.sg-panel.inert:active { background:var(--surface); }
.sg-row { display:flex; gap:10px; align-items:center; }
.sg-radar { flex-shrink:0; }
.sg-info { flex:1; min-width:0; }
.sg-cap { font-size:8px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sg-total-row { display:flex; align-items:baseline; gap:5px; margin:3px 0 2px; }
.sg-total { font-size:32px; font-weight:900; letter-spacing:-1.2px; line-height:1; }
.sg-unit { font-size:8px; font-weight:700; letter-spacing:0.8px; text-transform:uppercase; color:var(--muted); line-height:1.25; }
.sg-last { font-size:9.5px; color:var(--muted); }
.sg-callouts { margin-top:6px; font-size:9px; line-height:1.5; }
.sg-callouts strong { color:#fff; font-weight:700; }
.sg-msg { display:flex; align-items:center; justify-content:center; min-height:84px; text-align:center; font-size:11px; color:var(--muted); line-height:1.5; padding:0 8px; }
```

- [ ] **Step 2: Add the container markup**

In `pages/home.html`, make `#sg-panel` the first child of `.hw-scroller`, before `#widget-grid`:

```html
  <div class="hw-scroller">
    <div class="sg-panel" id="sg-panel"></div>
    <div class="widget-grid" id="widget-grid"></div>
```

- [ ] **Step 3: Add the renderer**

Append after the Task 1 functions:

```javascript
/* ══ SG PANEL — RENDER ══ */
const SG_R = { CX:70, CY:70, R0:30, RMAX:55 };

function sgRadarSvg(cats, colorHex) {
  const pts = cats.map(c => sgRadarPoint(c.value, c.angle, SG_R.CX, SG_R.CY, SG_R.R0, SG_R.RMAX));
  const poly = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dots = pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6" fill="${colorHex}"/>`).join('');
  const fill = colorHex === '#2ECC71' ? 'rgba(46,204,113,0.22)' : 'rgba(231,76,60,0.22)';
  return `<svg class="sg-radar" width="104" height="104" viewBox="0 0 140 140" aria-hidden="true">
    <circle cx="70" cy="70" r="55" fill="none" stroke="var(--border)" stroke-width="1"/>
    <circle cx="70" cy="70" r="30" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1" stroke-dasharray="3 3"/>
    <line x1="15" y1="70" x2="125" y2="70" stroke="var(--border)"/>
    <line x1="70" y1="15" x2="70" y2="125" stroke="var(--border)"/>
    <polygon points="${poly}" fill="${fill}" stroke="${colorHex}" stroke-width="1.6"/>
    ${dots}
  </svg>`;
}

function sgPanelMessage(text) {
  const el = document.getElementById('sg-panel');
  if (el) el.innerHTML = `<div class="sg-msg">${text}</div>`;
}

function renderSgPanel(data) {
  const el = document.getElementById('sg-panel');
  if (!el) return;
  if (!data) { sgPanelMessage('No Strokes Gained data yet — play a full round at a mapped course.'); return; }

  const colorHex = data.total >= 0 ? '#2ECC71' : '#E74C3C';
  const dateLbl  = data.lastDate
    ? new Date(data.lastDate).toLocaleDateString('en-US', { month:'short', day:'numeric' })
    : '—';
  const lastVal = data.lastValue == null ? '—' : fmtSg(data.lastValue);

  el.innerHTML = `<div class="sg-row">
    ${sgRadarSvg(data.cats, colorHex)}
    <div class="sg-info">
      <div class="sg-cap">Your game · ${data.count} round${data.count === 1 ? '' : 's'}</div>
      <div class="sg-total-row">
        <span class="sg-total" style="color:${sgColor(data.total)}">${fmtSg(data.total)}</span>
        <span class="sg-unit">avg sg<br>vs tour</span>
      </div>
      <div class="sg-last">Last <span style="color:${sgColor(data.lastValue ?? 0)};font-weight:700">${lastVal}</span> · ${dateLbl}</div>
      <div class="sg-callouts">
        <span style="color:var(--green)">▲</span> Best ${data.best.name} <strong>${fmtSg(data.best.value)}</strong><br>
        <span style="color:var(--red)">▼</span> Worst ${data.worst.name} <strong>${fmtSg(data.worst.value)}</strong>
      </div>
    </div>
  </div>`;
}
```

All interpolated values are numbers or literals from `SG_CATS` — no user-supplied text reaches `innerHTML`, so no escaping is required here.

- [ ] **Step 4: Verify rendering and height**

Build probes with the standard fixture, start the server, load the probe page, then evaluate:

```javascript
() => {
  renderSgPanel(deriveSgPanel([
    { sg_ott:-0.60, sg_app:-1.10, sg_atg:-0.50, sg_putt:-0.90, sg_total:-2.40, completed_at:'2026-06-28T15:30:00Z' },
    { sg_ott:-0.60, sg_app:-1.10, sg_atg:-0.50, sg_putt:-0.90, sg_total:-3.80, completed_at:'2026-06-21T15:30:00Z' },
  ]));
  const el = document.getElementById('sg-panel');
  const r = el.getBoundingClientRect();
  const txt = el.innerText;
  return {
    height: Math.round(r.height),
    width: Math.round(r.width),
    radarPresent: !!el.querySelector('svg polygon'),
    polygonPoints: el.querySelector('svg polygon').getAttribute('points'),
    showsTotal: txt.includes('-3.10'),
    showsCount: txt.includes('2 rounds'),
    showsLast: txt.includes('-2.40') && txt.includes('Jun 28'),
    showsBest: txt.includes('Around grn') && txt.includes('-0.50'),
    showsWorst: txt.includes('Approach') && txt.includes('-1.10'),
    isAboveWidgets: el.nextElementSibling.id === 'widget-grid',
  };
}
```

Expected: `height` between 100 and 135; `width` 296; `radarPresent` true; `polygonPoints` exactly `"70.0,45.0 90.8,70.0 70.0,95.8 47.5,70.0"`; all five `shows*` true; `isAboveWidgets` true.

- [ ] **Step 5: Screenshot the panel**

Screenshot the `.phone` element. Confirm by eye: radar left, numbers right, nothing clipped, no text overlapping the radar.

- [ ] **Step 6: Verify the empty state**

```javascript
() => { renderSgPanel(null);
  const el = document.getElementById('sg-panel');
  return { height: Math.round(el.getBoundingClientRect().height), text: el.innerText.trim() }; }
```

Expected: `height` ≥ 100 (frame does not collapse) and text exactly `No Strokes Gained data yet — play a full round at a mapped course.`

- [ ] **Step 7: Clean up and commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git add pages/home.html
git commit -m "feat: render SG panel with radar chart on home screen"
```

---

### Task 3: Wire live data and states

**Files:**
- Modify: `pages/home.html` — the `select` string and the rounds block inside the init IIFE (~lines 564-581 before this task's edits)

**Interfaces:**
- Consumes: `deriveSgPanel`, `renderSgPanel`, `sgPanelMessage`.
- Produces: nothing new.

- [ ] **Step 1: Show the loading state at startup**

Immediately after the existing top-level `renderWidgets();` call, add:

```javascript
sgPanelMessage('Loading…');
```

- [ ] **Step 2: Add `completed_at` to the query and handle the result**

Replace the existing rounds query and its `if (rounds && rounds.length > 0) { ... }` block with:

```javascript
  const { data: rounds, error: sgError } = await TcAuth.client
    .from('rounds')
    .select('sg_ott, sg_app, sg_atg, sg_putt, sg_total, completed_at')
    .eq('user_id', session.user.id)
    .eq('status', 'complete')
    .not('sg_total', 'is', null)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(20);

  if (sgError) {
    console.error('Home: strokes gained query failed', sgError);
    renderSgPanel(null);
  } else {
    const sgData = deriveSgPanel(rounds);
    renderSgPanel(sgData);
    if (sgData) {
      STATS['sg-total'].value = fmtSg(sgData.total);
      STATS['sg-ott'].value   = fmtSg(sgData.cats[0].value);
      STATS['sg-app'].value   = fmtSg(sgData.cats[1].value);
      STATS['sg-atg'].value   = fmtSg(sgData.cats[2].value);
      STATS['sg-putt'].value  = fmtSg(sgData.cats[3].value);
      renderWidgets();
    }
  }
```

This replaces the old local `avg`/`fmt` helpers, so the widget stat values and the panel are now derived from one source. Note the widget values change from one decimal to two — intended, so the two displays agree.

- [ ] **Step 3: Verify with data**

Write the standard fixture, build probes, start the server, load `__probe-home.html`, wait for the panel to populate, then evaluate:

```javascript
() => {
  const el = document.getElementById('sg-panel');
  return { text: el.innerText.replace(/\s+/g,' ').trim(), stillLoading: el.innerText.includes('Loading') };
}
```

Expected: `stillLoading` false; text contains `-3.10`, `2 rounds`, `Jun 28`, `Approach`.

- [ ] **Step 4: Verify the no-data path**

Write `pages/__fixture.json` containing `[]`, rebuild probes, reload, then evaluate the same expression. Expected: text is exactly the empty-state sentence.

- [ ] **Step 5: Verify the widget values still populate**

With the standard fixture loaded, add an SG widget and confirm it reads the same number as the panel:

```javascript
() => { widgetConfig = [{ id:'w0', size:'large', slots:['sg-total','sg-ott','sg-app'] }];
  renderWidgets();
  return document.getElementById('widget-grid').innerText.replace(/\s+/g,' ').trim(); }
```

Expected: contains `-3.10` — the same total the panel shows.

- [ ] **Step 6: Clean up and commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git add pages/home.html
git commit -m "feat: wire SG panel to live round data"
```

---

### Task 4: Tap-through, edit mode, and full-screen verification

**Files:**
- Modify: `pages/home.html` — click handler; one line in `toggleEdit()`
- Modify: `pages/stats.html` — deep-link handler at init

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add the deep-link handler to `stats.html`**

Replace the final `renderCards();` at the bottom of `pages/stats.html` with:

```javascript
/* ══ INIT ══ */
renderCards();

/* Deep link: home.html links here as stats.html?stat=sg */
const _statParam = new URLSearchParams(location.search).get('stat');
if (_statParam && CATS.some(c => c.id === _statParam)) openStat(_statParam);
```

The `CATS.some(...)` guard means an unknown or hostile `?stat=` value is ignored rather than throwing.

- [ ] **Step 2: Make the panel tappable**

Append after `renderSgPanel`:

```javascript
document.getElementById('sg-panel').onclick = () => {
  if (editMode) return;              // inert while editing
  window.location.href = 'stats.html?stat=sg';
};
```

- [ ] **Step 3: Mark the panel inert in edit mode**

Inside `toggleEdit()`, after the existing `add-btn` / `start-round` display lines, add:

```javascript
  document.getElementById('sg-panel').classList.toggle('inert', editMode);
```

- [ ] **Step 4: Verify the tap-through**

With the standard fixture loaded on `__probe-home.html`, evaluate:

```javascript
() => { document.getElementById('sg-panel').click(); return location.href; }
```

Expected: URL ends with `stats.html?stat=sg`. Then load `http://127.0.0.1:8791/__probe-stats.html?stat=sg` and evaluate:

```javascript
() => ({ sheetOpen: document.getElementById('stat-ov').classList.contains('open'),
         title: document.getElementById('ds-title').textContent })
```

Expected: `sheetOpen` true, `title` `Strokes Gained`.

Then confirm a bad parameter is ignored — load `__probe-stats.html?stat=nonsense` and evaluate the same. Expected: `sheetOpen` false.

- [ ] **Step 5: Verify edit-mode inertness**

Back on `__probe-home.html`:

```javascript
() => { const before = location.href;
  toggleEdit();
  const el = document.getElementById('sg-panel');
  const inert = el.classList.contains('inert');
  el.click();
  const navigated = location.href !== before;
  const visible = !!el.offsetParent;
  toggleEdit();
  return { inert, navigated, visibleDuringEdit: visible,
           inertAfterExit: el.classList.contains('inert') }; }
```

Expected: `inert` true, `navigated` false, `visibleDuringEdit` true, `inertAfterExit` false.

- [ ] **Step 6: Verify the whole screen at true phone size**

Resize to 390×844, reload `__probe-home.html` with the standard fixture, then evaluate:

```javascript
() => {
  const r = s => document.querySelector(s).getBoundingClientRect();
  const panel = r('#sg-panel'), tbar = r('.tbar'), btn = r('#start-round');
  const sc = document.querySelector('.hw-scroller');
  return {
    panelTop: Math.round(panel.top), panelHeight: Math.round(panel.height),
    panelWithinViewport: panel.right <= window.innerWidth + 1,
    btnAboveTabBar: Math.round(tbar.top - btn.bottom),
    tabBarAtBottom: Math.round(window.innerHeight - tbar.bottom),
    noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    scrollerScrolls: sc.scrollHeight > sc.clientHeight,
  };
}
```

Expected: `panelWithinViewport` true, `noHorizontalOverflow` true, `btnAboveTabBar` 10, `tabBarAtBottom` ≤ 2.

- [ ] **Step 7: Check the radar scale against real data — REQUIRED**

The ±3.0 scale is an unverified assumption. Load the page against the **real** account (no fixture — use the app normally in a browser signed in as the user) and read the four category averages. If any `Math.abs(value) >= 3.0`, the radar is clamping and the shape is misleading.

Report the four real values to the user along with whether clamping occurred. If it did, raise `SG_RADAR_SCALE` to the next whole number above the largest absolute value and re-screenshot. If the account has no qualifying rounds, report that instead — do not claim the scale was verified.

- [ ] **Step 8: Capture the screenshots the spec requires**

Take and show: panel with data at 320px, panel in the no-data state, full home screen at 390×844, and edit mode. These four are the deliverable — do not report the task complete without them.

- [ ] **Step 9: Clean up and commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git status --short   # expect only pages/home.html and pages/stats.html
git add pages/home.html pages/stats.html
git commit -m "feat: link SG panel through to stats detail, inert in edit mode"
```

---

## Definition of Done

- [ ] Panel sits above the widget grid, scrolls with it, and is not addable/removable as a widget.
- [ ] Numbers match the Stats page's Strokes Gained section for the same account.
- [ ] Loading, populated, and no-data states all render at stable height.
- [ ] Tapping opens Stats with the SG sheet open; a bad `?stat=` value is ignored.
- [ ] Panel is visible but inert in edit mode.
- [ ] Radar scale checked against real data, with the result reported.
- [ ] Four screenshots shown to the user.
- [ ] No probe or fixture files committed; `tour-caddie/` untouched.
