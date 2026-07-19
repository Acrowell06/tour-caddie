# Midnight Theme Phase 1 — Tokenize With Zero Visible Change

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert all 555 hardcoded colour literals **and all 426 old-alias references** (`var(--green)`, `var(--red)`, `var(--white)`, `var(--muted)`, `var(--dim)`, `var(--surface2)`) to the new token set — 981 sites in total — classifying every green and red by meaning, while the app remains pixel-identical.

**Architecture:** `pages/tc.css` gains a token block: finished colours (`--accent`, `--good`) plus RGB channel triplets (`--accent-rgb`, `--ink-rgb`) so each translucent call site keeps its exact alpha. In Phase 1 every token carries today's colour, so nothing changes visually. Each page is converted in its own task and verified against a computed-style baseline captured before any edits.

**Tech Stack:** Plain HTML/CSS, no build step, no framework, no preprocessor. Verification via Playwright MCP browser tools.

## Global Constraints

- **This project has NO test framework.** `package.json` has an empty `scripts` block, no tests are committed. Do not create one. Do not run `npm test`. Verification is the capture-and-compare harness defined below.
- **Zero visible change is the whole point of Phase 1.** Every task must end with its page's capture hash identical to its baseline. A differing hash is a defect, never an acceptable improvement.
- **Never use `color-mix()`.** It computes to `color(srgb …)` rather than `rgb(…)`, which changes the captured string and breaks comparison. Verified in-browser.
- **Do not change any token's value in this phase.** Token values are today's colours exactly. Applying Midnight is Phase 2.
- Edit `pages/` at the repo root. **Never edit `tour-caddie/`** — an untracked duplicate copy whose edits never reach the repo.
- Windows/Git Bash. Use `python`, never `python3`.
- Never commit `pages/__probe-*.html`, `pages/__fixture.json`, `.playwright-mcp/`, or baseline JSON files.
- Branch: work on `feat/midnight-phase1`, branched from `master` at `22eb945` (the plan commit).

## The classification rule

`--green` currently means two different things, which diverge in Phase 2. Every green usage must be labelled:

- **UI chrome / interaction → `--accent`**: buttons, active tab, focus states, links, the Edit button, "＋ Add Widget", selected states, dashed add-borders, toggle "on" states.
- **Performance meaning → `--good`**: under par, positive strokes gained, the "Best" callout, improvement trend arrows, "under" score colours.

Red splits the same way: **`--danger`** for destructive actions (Remove, Delete, Sign Out), **`--bad`** for scoring meaning (over par, negative SG).

The deciding question when ambiguous: **would this element still be this colour if the user were playing badly?** Yes → chrome. No → performance.

Both `--accent` and `--good` hold `#2ECC71` in Phase 1, so misclassification is invisible to the capture harness. It is caught by review, not by the hash. Reviewers must check the labels, not just the hashes.

## The capture harness

Proven working before this plan was written: deterministic across reloads and within a page, and it detects a single element's colour changing by pinpointing the exact element.

**Build probes and serve** (auth is stubbed because pages redirect to login otherwise):

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1/pages" && cat > __fixture.json <<'EOF'
[{"sg_ott":-0.60,"sg_app":-1.10,"sg_atg":-0.50,"sg_putt":-0.90,"sg_total":-2.40,"completed_at":"2026-06-28T15:30:00Z"}]
EOF
python - <<'EOF'
import re, json
ROUNDS = json.load(open('__fixture.json'))
stub = '''<script>
window.supabase={createClient:()=>({})};
const _rows=''' + json.dumps(ROUNDS) + ''';
const _q={select:()=>_q,eq:()=>_q,neq:()=>_q,not:()=>_q,order:()=>_q,limit:()=>_q,
  single:async()=>({data:{display_name:'Golfer',handicap_index:8.4,widget_layout:null,distance_unit:'yards'}}),
  update:()=>_q,insert:()=>_q,then:(r)=>r({data:_rows,error:null})};
window.TcAuth={requireAuth:async()=>({user:{id:'u1',email:'a@b.c'}}),getSession:async()=>({user:{id:'u1',email:'a@b.c'}}),
  client:{from:()=>_q,auth:{updateUser:async()=>({})}},signOut:async()=>{},onAuth:()=>{}};
</script>'''
for f in ['home','stats','courses','rounds','profile','hole','scorecard','scanner','scan-scorecard','login']:
    src = open(f+'.html', encoding='utf-8').read()
    src = re.sub(r'<script src="https://cdn\.jsdelivr\.net/npm/@supabase[^>]*></script>', stub, src)
    src = src.replace('<script src="tc-auth.js"></script>','')
    open('__probe-'+f+'.html','w',encoding='utf-8').write(src)
print('probes built')
EOF
python -m http.server 8807 --bind 127.0.0.1
```

Run the server with `run_in_background: true`.

**The capture expression.** Navigate to `http://127.0.0.1:8807/__probe-<page>.html`, wait for load, then `browser_evaluate` this exactly:

```javascript
async () => {
  await new Promise(r => setTimeout(r, 1200));   // let async render settle
  const rows = [];
  const walk = (el, path) => {
    if (el.closest && el.closest('.leaflet-container')) return;  // map tiles are async + irrelevant
    const cs = getComputedStyle(el);
    rows.push(path + '|' + [cs.color, cs.backgroundColor, cs.borderTopColor,
      cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor,
      cs.fill, cs.stroke, cs.outlineColor, cs.boxShadow].join('|'));
    [...el.children].forEach((c, i) => walk(c, path + '/' + c.tagName + '[' + i + ']'));
  };
  walk(document.body, 'body');
  let h = 5381;
  const joined = rows.join('\n');
  for (let i = 0; i < joined.length; i++) h = ((h * 33) ^ joined.charCodeAt(i)) >>> 0;
  return { count: rows.length, hash: h.toString(16) };
}
```

It returns only a count and a hash, so nothing bulky enters context.

**When a hash does not match**, re-run with `rows` included and diff to find the offending element:

```javascript
async () => {
  await new Promise(r => setTimeout(r, 1200));
  const rows = [];
  const walk = (el, path) => {
    if (el.closest && el.closest('.leaflet-container')) return;
    const cs = getComputedStyle(el);
    rows.push(path + '|' + [cs.color, cs.backgroundColor, cs.borderTopColor,
      cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor,
      cs.fill, cs.stroke, cs.outlineColor, cs.boxShadow].join('|'));
    [...el.children].forEach((c, i) => walk(c, path + '/' + c.tagName + '[' + i + ']'));
  };
  walk(document.body, 'body');
  return rows;
}
```

Compare against the stored baseline rows for that page and report the differing entries.

**Baselines live at** `.superpowers/theme-baseline/<page>.json`, written in Task 1. That directory is inside the git-ignored `.superpowers/`, so baselines never get committed.

## Conversion reference

Apply these mechanically; the only judgement is chrome-vs-performance.

| Literal | Becomes |
|---|---|
| `#0A0A0F` | `var(--bg)` |
| `#141420` | `var(--surface)` |
| `#1C1C2E` | `var(--surface-2)` |
| `#1E1E2E` | `var(--border)` |
| `#FFFFFF` / `#fff` | `var(--text)` |
| `#8B8BA7` | `var(--text-muted)` |
| `#5A5A7A` | `var(--text-dim)` |
| `#2ECC71` | `var(--accent)` **or** `var(--good)` — classify |
| `#E74C3C` | `var(--danger)` **or** `var(--bad)` — classify |
| `#F1C40F` | `var(--gold)` |
| `rgba(255,255,255,A)` | `rgb(var(--ink-rgb) / A)` — keep A exactly |
| `rgba(46,204,113,A)` | `rgb(var(--accent-rgb) / A)` or `rgb(var(--good-rgb) / A)` — classify, keep A |
| `rgba(231,76,60,A)` | `rgb(var(--danger-rgb) / A)` or `rgb(var(--bad-rgb) / A)` — classify, keep A |
| `rgba(0,0,0,A)` | `rgb(var(--shadow-rgb) / A)` — keep A |

Colours not in this table (one-off blues, map colours, gradient stops) stay literal in Phase 1 unless the page task says otherwise. Do not invent tokens beyond the defined set.

## File Structure

- **`pages/tc.css`** — gains the `:root` token block; its own 95 literals convert.
- **The 10 other page files** — one conversion task each, sized by literal count.
- **No new files.** No JS changes anywhere in Phase 1.

---

### Task 1: Token block and baseline capture

Defines the tokens and records what every page looks like *before* any conversion. Nothing else can be verified until this exists.

**Files:**
- Modify: `pages/tc.css` — replace the `:root` block
- Create: `.superpowers/theme-baseline/<page>.json` (11 files, git-ignored)

**Interfaces:**
- Consumes: nothing.
- Produces: the token names every later task uses — `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--text-on-accent`, `--accent`, `--good`, `--bad`, `--danger`, `--gold`, `--map-surface`, `--map-text`, and channel triplets `--ink-rgb`, `--shadow-rgb`, `--accent-rgb`, `--good-rgb`, `--bad-rgb`, `--danger-rgb`.

- [ ] **Step 1: Capture baselines BEFORE touching anything**

Build probes and start the server per the harness section. For each of the 10 pages, navigate and run the full-rows capture expression, saving the returned array to `.superpowers/theme-baseline/<page>.json`. Also record each page's `{count, hash}` in `.superpowers/theme-baseline/hashes.json` as `{"home": {"count": 104, "hash": "2815f1e3"}, …}`.

The hashes are the contract for every later task. If this step is done after any conversion, the entire plan's verification is worthless.

- [ ] **Step 2: Replace the `:root` block in `pages/tc.css`**

Replace the existing `:root { … }` (currently at the top of the file, defining `--bg` through `--red`) with:

```css
:root {
  /* Phase 1: every value is TODAY'S colour. Midnight values land in Phase 2. */

  /* Structure */
  --bg: #0A0A0F;
  --surface: #141420;
  --surface-2: #1C1C2E;
  --border: #1E1E2E;

  /* Text */
  --text: #FFFFFF;
  --text-muted: #8B8BA7;
  --text-dim: #5A5A7A;
  --text-on-accent: #0A0A0F;

  /* Accent — UI chrome and interaction */
  --accent: #2ECC71;

  /* Semantic — meaning, not chrome */
  --good: #2ECC71;
  --bad: #E74C3C;
  --danger: #E74C3C;
  --gold: #F1C40F;

  /* Map chrome — deliberately does NOT invert in Phase 3 */
  --map-surface: #141420;
  --map-text: #FFFFFF;

  /* Channel triplets: let each call site keep its own alpha.
     Usage: rgb(var(--ink-rgb) / 0.04)
     Never use color-mix() — it computes to a different string form
     and breaks the capture comparison. */
  --ink-rgb: 255 255 255;
  --shadow-rgb: 0 0 0;
  --accent-rgb: 46 204 113;
  --good-rgb: 46 204 113;
  --bad-rgb: 231 76 60;
  --danger-rgb: 231 76 60;

  /* Deprecated aliases — every remaining var(--green)/var(--red) call site
     still resolves while pages are converted one at a time. Task 12 removes
     these once no references remain. */
  --green: var(--accent);
  --red: var(--bad);
  --white: var(--text);
  --muted: var(--text-muted);
  --dim: var(--text-dim);
}
```

The aliases matter: pages are converted one per task, so unconverted pages must keep working between commits.

- [ ] **Step 3: Verify nothing changed**

Rebuild probes (tc.css is loaded fresh) and re-capture all 10 pages. Every hash must equal its baseline in `hashes.json`.

Expected: 10 of 10 match. If any differs, the token block changed a value — find it with the rows diff and fix before committing.

- [ ] **Step 4: Commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git add pages/tc.css
git commit -m "refactor: add theme token block with today's colours"
```

---

## The Conversion Procedure (Tasks 2-11)

> **Dispatchers: paste this whole section verbatim into every Task 2-11 dispatch.** Each of those tasks is one file's application of this procedure; the task section alone does not restate it.

**There are TWO kinds of site to convert in every file.** Missing the second kind is the most likely way to fail this plan.

1. **List the colour literals:** `grep -noE "#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)" pages/<FILE>`
2. **List the old-alias references:** `grep -noE "var\(--(green|red|white|muted|dim|surface2)\)" pages/<FILE>`

   These appear in CSS *and inside JavaScript strings* — e.g. `courses.html` builds `style="color:${… 'var(--green)' … }"` in template literals, and `home.html`'s `sgColor()` returns `'var(--green)'`. A literal-only grep will not surface them, and Task 12 deletes the aliases they depend on. Convert them in the same task as the file they live in.

3. **Convert every site from both lists** using the conversion reference table. Work top to bottom. **Never blind find-and-replace**: greens and reds need individual classification. For each, decide chrome vs performance with the classification rule and record the decision — the reviewer checks the labels, because the hash cannot.

   Alias mapping: `var(--green)` → `var(--accent)` or `var(--good)` (classify); `var(--red)` → `var(--danger)` or `var(--bad)` (classify); `var(--white)` → `var(--text)`; `var(--muted)` → `var(--text-muted)`; `var(--dim)` → `var(--text-dim)`; `var(--surface2)` → `var(--surface-2)`.

   Note `--surface2` has no hyphen in the old name and `--surface-2` does in the new one. 19 references exist across 7 files.

4. **Keep every alpha exactly.** `rgba(46,204,113,0.08)` → `rgb(var(--accent-rgb) / 0.08)`, never `/ 0.1`.
5. **Confirm none remain — both greps:**
   - `grep -oE "#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)" pages/<FILE> | sort | uniq -c` — every `#2ECC71`, `#E74C3C`, `rgba(255,255,255,…)`, `rgba(46,204,113,…)`, `rgba(231,76,60,…)`, `rgba(0,0,0,…)` gone. Survivors must be deliberate exceptions (one-off blues, map colours, gradient stops).
   - `grep -cE "var\(--(green|red|white|muted|dim|surface2)\)" pages/<FILE>` — expected `0`.
6. **Verify pixel-identical:** rebuild probes, capture the page, compare `count` and `hash` to its Task 1 baseline. On mismatch, run the rows capture, diff against the stored baseline JSON, fix the element. **Never adjust the baseline.**
7. **Commit:** clean up probes first, then `git add pages/<FILE>` and commit as `refactor: tokenize colours in <FILE>`.

`pages/index.html` is a 9-line redirect stub (`location.replace('login.html')`), loads no stylesheet, has an empty body, and contains zero literals. It is excluded entirely — no task, no baseline, no capture.

---

### Task 2: Tokenize `pages/tc.css`

95 literals + 64 alias references · 19 greens · 9 reds. The shared stylesheet — every page loads it, so this task's verification is app-wide.

**Files:** Modify `pages/tc.css`
**Interfaces:** Consumes the tokens from Task 1. Produces nothing new.

- [ ] **Step 1:** Apply the Conversion Procedure to `pages/tc.css`.
- [ ] **Step 2:** Capture **all 10 pages** and compare every hash to its Task 1 baseline — not just one page, because this file styles all of them.
- [ ] **Step 3:** Expected: 10 of 10 hashes identical. Commit.

---

### Task 3: Tokenize `pages/scorecard.html`

106 literals + 0 alias references · 11 greens · 0 reds. The densest file in the app. Colour carries scoring meaning here (birdie/bogey cells), so expect most greens to classify as `--good`, not `--accent`.

**Files:** Modify `pages/scorecard.html`
**Interfaces:** Consumes Task 1 tokens.

- [ ] **Step 1:** Apply the Conversion Procedure to `pages/scorecard.html`.
- [ ] **Step 2:** Capture `scorecard` and compare to baseline. Expected: identical. Commit.

---

### Task 4: Tokenize `pages/hole.html`

69 literals + 38 alias references · 5 greens · 3 reds.

**Files:** Modify `pages/hole.html`
**Interfaces:** Consumes Task 1 tokens, including `--map-surface` and `--map-text`.

**Additional requirement unique to this task:** the overlay panels sitting over the Leaflet satellite map must NOT invert in Phase 3. Convert their surface and text colours to `var(--map-surface)` and `var(--map-text)` rather than `var(--surface)` / `var(--text)`. This covers the panels positioned above the map — the shot-marking controls, the distance readouts, and the hole header strip. Everything else on the page (sheets, buttons, the score bar) uses the normal tokens.

- [ ] **Step 1:** Apply the Conversion Procedure to `pages/hole.html`, honouring the map-token requirement above.
- [ ] **Step 2:** Capture `hole` and compare to baseline. Expected: identical (the capture skips `.leaflet-container`, so map tiles do not affect it). Commit.

---

### Task 5: Tokenize `pages/courses.html`

50 literals + 59 alias references · 4 greens · 1 red. The alias references include many inside JavaScript template literals — see the Conversion Procedure's second grep.

**Files:** Modify `pages/courses.html`
**Interfaces:** Consumes Task 1 tokens.

- [ ] **Step 1:** Apply the Conversion Procedure to `pages/courses.html`.
- [ ] **Step 2:** Capture `courses` and compare to baseline. Expected: identical. Commit.

---

### Task 6: Tokenize `pages/home.html`

47 literals + 31 alias references · 13 greens · 3 reds. Contains the Strokes Gained panel, whose `sgColor()` returns `'var(--green)'` / `'var(--red)'` as JS strings — those are **not** CSS literals and this task must update them too, to `'var(--good)'` and `'var(--bad)'` respectively, since they express performance, not chrome.

**Files:** Modify `pages/home.html`
**Interfaces:** Consumes Task 1 tokens.

- [ ] **Step 1:** Apply the Conversion Procedure to `pages/home.html`.
- [ ] **Step 2:** Update the JS colour strings: in `sgColor`, `'var(--green)'` → `'var(--good)'` and `'var(--red)'` → `'var(--bad)'`. Check `sgRadarSvg` too — its `stroke` uses the same pair and is also performance, not chrome.
- [ ] **Step 3:** Capture `home` and compare to baseline. Expected: identical, because `--good` and `--bad` currently hold the same values the aliases did. Commit.

---

### Task 7: Tokenize `pages/profile.html`

46 literals + 57 alias references · 13 greens · 2 reds. Note this page has destructive actions (Sign Out, account changes) — those reds are `--danger`, not `--bad`.

**Files:** Modify `pages/profile.html`
**Interfaces:** Consumes Task 1 tokens.

- [ ] **Step 1:** Apply the Conversion Procedure to `pages/profile.html`.
- [ ] **Step 2:** Capture `profile` and compare to baseline. Expected: identical. Commit.

---

### Task 8: Tokenize `pages/rounds.html`

44 literals + 57 alias references · 10 greens · 2 reds. Round deletion lives here, so expect at least one `--danger`.

**Files:** Modify `pages/rounds.html`
**Interfaces:** Consumes Task 1 tokens.

- [ ] **Step 1:** Apply the Conversion Procedure to `pages/rounds.html`.
- [ ] **Step 2:** Capture `rounds` and compare to baseline. Expected: identical. Commit.

---

### Task 9: Tokenize `pages/stats.html`

41 literals + 52 alias references · 8 greens · 2 reds. Strokes-gained bars and score colours here are performance meaning (`--good` / `--bad`); the category card chrome and the period tabs are `--accent`.

**Files:** Modify `pages/stats.html`
**Interfaces:** Consumes Task 1 tokens.

- [ ] **Step 1:** Apply the Conversion Procedure to `pages/stats.html`.
- [ ] **Step 2:** Capture `stats` and compare to baseline. Expected: identical. Commit.

---

### Task 10: Tokenize `pages/scanner.html`

34 literals + 37 alias references · 10 greens · 1 red.

**Files:** Modify `pages/scanner.html`
**Interfaces:** Consumes Task 1 tokens.

- [ ] **Step 1:** Apply the Conversion Procedure to `pages/scanner.html`.
- [ ] **Step 2:** Capture `scanner` and compare to baseline. Expected: identical. Commit.

---

### Task 11: Tokenize `pages/scan-scorecard.html` and `pages/login.html`

18 + 5 literals, 12 + 0 alias references · 5 + 0 greens · 0 + 1 red. Two trivial files in one task.

**Files:** Modify `pages/scan-scorecard.html`, `pages/login.html`
**Interfaces:** Consumes Task 1 tokens.

- [ ] **Step 1:** Apply the Conversion Procedure to `pages/scan-scorecard.html`.
- [ ] **Step 2:** Apply the Conversion Procedure to `pages/login.html`.
- [ ] **Step 3:** Capture both `scan-scorecard` and `login`, compare each to its baseline. Expected: both identical. Single commit for both files.

---

### Task 12: Remove the deprecated aliases

Once every page is converted, no `var(--green)`, `var(--red)`, `var(--white)`, `var(--muted)`, `var(--dim)`, or `var(--surface2)` reference should remain.

**Files:**
- Modify: `pages/tc.css` — delete the alias block

**Interfaces:**
- Consumes: all tokens from Task 1.
- Produces: nothing.

- [ ] **Step 1: Prove no references remain**

```bash
grep -rn "var(--green)\|var(--red)\|var(--white)\|var(--muted)\|var(--dim)\|var(--surface2)" pages/
```

Expected: no output. If anything matches, that page's conversion task was incomplete — fix it there and re-verify that page before continuing.

- [ ] **Step 2: Delete the alias block**

Remove the six alias lines (`--green`, `--red`, `--white`, `--muted`, `--dim`, `--surface2`) and their explanatory comments from the `:root` block in `pages/tc.css`.

- [ ] **Step 3: Verify all 10 pages unchanged**

Rebuild probes and capture every page. All 10 hashes must still equal their Task 1 baselines.

Expected: 10 of 10 match. A mismatch means something still referenced an alias and has now fallen back to an unset variable.

- [ ] **Step 4: Commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git add pages/tc.css
git commit -m "refactor: drop deprecated colour aliases"
```

---

### Task 13: Whole-app confirmation

**Files:** none modified.

- [ ] **Step 1: Confirm the literal count is near zero**

```bash
for f in pages/tc.css pages/*.html; do n=$(grep -oE "#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)" "$f" | wc -l); echo "$n  $f"; done | sort -rn
```

Report the remaining count per file and what each survivor is. Every survivor must be a deliberate exception named in this plan (one-off blues, map colours, gradient stops), not an oversight.

- [ ] **Step 2: Full capture sweep**

All 10 pages, hashes compared to Task 1 baselines. Expected: 10 of 10 identical.

- [ ] **Step 3: Screenshot every page at 390×844**

Capture all 10 and inspect them. The harness compares colours, not layout — a malformed `rgb(var(…) / A)` that failed to parse could leave an element transparent in a way the hash catches, but a broken *rule* could also drop a declaration entirely. Eyes on each page confirms nothing collapsed.

- [ ] **Step 4: Prove Phase 2 is now a one-line job**

Temporarily change `--accent` to `#38BDD0` in `pages/tc.css`, screenshot `home.html`, and confirm buttons and the active tab turn cyan while under-par/positive-SG values stay green. Then revert the change.

This is the proof that the classification was done correctly — it is the only check that distinguishes a correct `--accent`/`--good` split from a wrong one. Report what turned cyan and what stayed green. **Revert before committing; Phase 1 ends with today's colours intact.**

- [ ] **Step 5: Report**

State: remaining literal count per file, 10/10 hash confirmation, the accent-swap result, and any survivor literals. No commit — this task changes nothing.

---

## Definition of Done

- [ ] All 555 literals converted except deliberate, named exceptions.
- [ ] All 426 old-alias references converted, including those inside JavaScript strings.
- [ ] All 10 page hashes identical to their Task 1 baselines.
- [ ] Every green classified `--accent` or `--good`; every red `--danger` or `--bad`.
- [ ] No `var(--green)` / `var(--red)` / `var(--white)` / `var(--muted)` / `var(--dim)` / `var(--surface2)` references remain.
- [ ] `hole.html` overlay panels use `--map-surface` / `--map-text`.
- [ ] The temporary accent swap turns chrome cyan and leaves performance green — then is reverted.
- [ ] No probe, fixture, baseline, or `.playwright-mcp` files committed; `tour-caddie/` untouched.
