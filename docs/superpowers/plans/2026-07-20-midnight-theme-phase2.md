# Midnight Theme Phase 2 — Apply the Dark Palette

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the app navy-and-cyan by changing token values, having first closed the gaps Phase 1 recorded.

**Architecture:** Phase 1 left every colour behind a token, so the recolour itself is a value edit. The work is the preparation: five new tokens, three call-site reassignments the user chose, and syncing `scorecard.html`'s duplicated token block. Preparation is split into hash-neutral tasks (verified pixel-identical, exactly like Phase 1) and deliberately-visible tasks (verified by an explicit expected-change list plus screenshots).

**Tech Stack:** Plain HTML/CSS, no build step, no framework, no preprocessor. Verification via Playwright MCP browser tools.

## Global Constraints

- **This project has NO test framework.** `package.json` has an empty `scripts` block. Do not create one. Do not run `npm test`.
- **Tasks 1 and 2 must be pixel-identical** — their capture hashes must equal the Phase 1 baselines in `.superpowers/theme-baseline/hashes.json`. **Tasks 3 onward change appearance deliberately**, and each states exactly which elements are allowed to move; anything else moving is a defect.
- **Never use `color-mix()`.** It computes to `color(srgb …)` rather than `rgb(…)` and breaks the capture comparison.
- **`--accent` and `--accent-rgb` must always carry the same colour.** Changing one without the other leaves translucent tints green while solid accents turn cyan. The same pairing applies to `--good`/`--good-rgb`, `--bad`/`--bad-rgb`, `--danger`/`--danger-rgb`, `--notice`/`--notice-rgb`, `--warn`/`--warn-rgb`, `--gold`/`--gold-rgb`.
- **`pages/scorecard.html` does not load `tc.css`.** It is a standalone print template carrying its own duplicate `:root`. Any token value change must be applied there too or it silently keeps the old palette.
- Edit `pages/` at the repo root. **Never edit `tour-caddie/`** — an untracked duplicate copy whose edits never reach the repo.
- Windows/Git Bash. Use `python`, never `python3`.
- Never commit `pages/__probe-*.html`, `pages/__fixture.json`, `.playwright-mcp/`, or baseline/screenshot files.
- Branch: `feat/midnight-phase2`, from `master` at `b3906b3`.

## Baselines (Phase 1, unchanged)

`home` 104/`2815f1e3` · `stats` 167/`9028655e` · `courses` 109/`b56fc72d` · `rounds` 99/`8c79f9fa` · `profile` 275/`8d058d63` · `hole` 387/`13de1ccd` · `scorecard` 1043/`b892a92b` · `scanner` 123/`ed70368c` · `scan-scorecard` 56/`d4092a4f` · `login` 48/`f0b31ecf`

## The capture harness

Identical to Phase 1. Build probes and serve:

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1/pages" && cat > __fixture.json <<'EOF'
[{"sg_ott":-0.60,"sg_app":-1.10,"sg_atg":-0.50,"sg_putt":-0.90,"sg_total":-2.40,"completed_at":"2026-06-28T15:30:00Z"}]
EOF
python - <<'PYEOF'
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
pages = ['home','stats','courses','rounds','profile','hole','scorecard','scanner','scan-scorecard','login']
for f in pages:
    src = open(f+'.html', encoding='utf-8').read()
    src = re.sub(r'<script src="https://cdn\.jsdelivr\.net/npm/@supabase[^>]*></script>', stub, src)
    src = src.replace('<script src="tc-auth.js"></script>','')
    open('__probe-'+f+'.html','w',encoding='utf-8').write(src)
frames = '\n'.join('<iframe data-n="%s" src="__probe-%s.html" width="1000" height="900" style="border:0"></iframe>' % (p,p) for p in pages)
open('__probe-sweep.html','w',encoding='utf-8').write('<!DOCTYPE html><body style="margin:0">'+frames+'</body>')
print('probes + sweep built')
PYEOF
python -m http.server 8821 --bind 127.0.0.1
```

Run with `run_in_background: true`. Load `http://127.0.0.1:8821/__probe-sweep.html` and capture all ten pages in one call:

```javascript
async () => {
  await new Promise(r => setTimeout(r, 2500));
  const capture = (doc) => {
    const rows = [];
    const walk = (el, path) => {
      if (el.closest && el.closest('.leaflet-container')) return;
      const cs = doc.defaultView.getComputedStyle(el);
      rows.push(path + '|' + [cs.color, cs.backgroundColor, cs.borderTopColor,
        cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor,
        cs.fill, cs.stroke, cs.outlineColor, cs.boxShadow].join('|'));
      [...el.children].forEach((c, i) => walk(c, path + '/' + c.tagName + '[' + i + ']'));
    };
    walk(doc.body, 'body');
    let h = 5381;
    const joined = rows.join('\n');
    for (let i = 0; i < joined.length; i++) h = ((h * 33) ^ joined.charCodeAt(i)) >>> 0;
    return { count: rows.length, hash: h.toString(16) };
  };
  const out = {};
  for (const f of document.querySelectorAll('iframe')) {
    try { out[f.dataset.n] = capture(f.contentDocument); }
    catch (e) { out[f.dataset.n] = { error: String(e).slice(0, 60) }; }
  }
  return out;
}
```

Individual pages are at `http://127.0.0.1:8821/__probe-<page>.html` for screenshots.

**Cleanup after every task:** `rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp`.

## Midnight values

Applied in Task 5. Dark theme only — the light theme is Phase 3.

| Token | Today | Midnight |
|---|---|---|
| `--bg` | `#0A0A0F` | `#080C14` |
| `--surface` | `#141420` | `#101827` |
| `--surface-2` | `#1C1C2E` | `#18202F` |
| `--border` | `#1E1E2E` | `#1D2839` |
| `--text` | `#FFFFFF` | `#E8EDF5` |
| `--text-muted` | `#8B8BA7` | `#7A8699` |
| `--text-dim` | `#5A5A7A` | `#4A5568` |
| `--text-on-accent` | `#0A0A0F` | `#04080F` |
| `--accent` | `#2ECC71` | `#38BDD0` |
| `--good` | `#2ECC71` | `#4ADE80` |
| `--bad` | `#E74C3C` | `#EF6262` |
| `--danger` | `#E74C3C` | `#EF6262` |
| `--notice` | `#E74C3C` | `#E8836A` |
| `--warn` | `#E67E22` | `#E8A33D` |
| `--gold` | `#F1C40F` | `#F1C40F` (unchanged) |
| `--map-surface` | `#141420` | `#101827` |
| `--map-surface-2` | `#1C1C2E` | `#18202F` |
| `--map-text` | `#FFFFFF` | `#E8EDF5` |
| `--pga-under` | `#E74C3C` | `#EF6262` |
| `--pga-over` | `#4A90D9` | `#4A90D9` (unchanged) |

Channel triplets take the decimal RGB of their partner: `--accent-rgb: 56 189 208`, `--good-rgb: 74 222 128`, `--bad-rgb`/`--danger-rgb: 239 98 98`, `--notice-rgb: 232 131 106`, `--warn-rgb: 232 163 61`, `--gold-rgb: 241 196 15`. `--ink-rgb` and `--shadow-rgb` do not change.

## File Structure

- **`pages/tc.css`** — the token block; all value changes and new token definitions.
- **`pages/home.html`** — PGA leaderboard reassignment.
- **`pages/courses.html`** — mid-tier `--warn` reassignment, opaque derived tints.
- **`pages/stats.html`** — category-stripe reassignment.
- **`pages/profile.html`, `pages/rounds.html`, `pages/login.html`, `pages/scan-scorecard.html`** — notice reassignment.
- **`pages/scorecard.html`** — its duplicated local `:root` synced to Midnight.

---

### Task 1: Add the new tokens at today's values

Five new token pairs, all carrying the colour they replace, so nothing moves yet.

**Files:** Modify `pages/tc.css`

**Interfaces:**
- Consumes: the existing `:root` block.
- Produces: `--notice`, `--notice-rgb`, `--warn`, `--warn-rgb`, `--gold-rgb`, `--map-surface-2`, `--pga-under`, `--pga-over`.

- [ ] **Step 1: Add the tokens**

In `pages/tc.css`'s `:root`, after the `--gold` line add:

```css
  /* Notices: alerts and validation that are neither destructive nor score-related.
     Kept separate from --danger so a mistyped password does not shout as loudly
     as deleting an account. */
  --notice: #E74C3C;

  /* Mid tier of the three-tier performance scale (good / middling / poor). */
  --warn: #E67E22;

  /* PGA leaderboard uses the TV broadcast convention: red = under par = GOOD.
     That inverts this app's green=good/red=bad scheme, so these are deliberately
     decoupled from --good/--bad. Do not "fix" them to match. */
  --pga-under: #E74C3C;
  --pga-over: #4A90D9;
```

After the `--map-text` line add:

```css
  --map-surface-2: #1C1C2E;
```

And in the channel-triplet block, after `--danger-rgb`:

```css
  --notice-rgb: 231 76 60;
  --warn-rgb: 230 126 34;
  --gold-rgb: 241 196 15;
```

- [ ] **Step 2: Add the `.neg` / `.pos` clarifying comment**

Find the `.neg` / `.pos` rules in `pages/tc.css` (around line 85) and add directly above them:

```css
/* Golf scoring: a NEGATIVE score is under par, so .neg is --good and .pos is --bad.
   This inversion is correct — do not "fix" it. */
```

- [ ] **Step 3: Verify pixel-identical**

Build probes, run the sweep, compare all ten to the baselines. Expected: 10 of 10 identical — adding unused tokens cannot change rendering.

- [ ] **Step 4: Commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git add pages/tc.css
git commit -m "refactor: add notice, warn, gold-rgb, map-surface-2 and PGA tokens"
```

---

### Task 2: Reassign the hash-neutral call sites

Every reassignment here swaps a token or literal for one holding the identical value, so nothing moves.

**Files:** Modify `pages/tc.css`, `pages/profile.html`, `pages/rounds.html`, `pages/login.html`, `pages/scan-scorecard.html`, `pages/home.html`, `pages/courses.html`, `pages/hole.html` (not `pages/scanner.html` — it has no `--danger` uses)

**Interfaces:** Consumes Task 1's tokens.

- [ ] **Step 1: Notices move from `--danger` to `--notice`**

These are alerts and validation, not destructive actions. Change `var(--danger)` → `var(--notice)` and `var(--danger-rgb)` → `var(--notice-rgb)` at exactly these:

- `pages/tc.css` — `.toast` and `.no-course-banner`
- `pages/profile.html` — `.sheet-err`
- `pages/rounds.html` — its validation-error text
- `pages/login.html` — `#lg-err`
- `pages/scan-scorecard.html` — scan-failure message text

`pages/scanner.html` has zero `var(--danger)` uses; it needs no change in this step.

**Leave on `--danger`:** Sign Out, Delete Account, the widget "− Remove" button, and any delete confirmation. Those are genuinely destructive.

`pages/tc.css`'s `.sh-undo` is an Edit action wearing a red pill — move it to `--notice` as well.

- [ ] **Step 2: The map flag/pin moves to `--notice`**

In `pages/hole.html`, the flag/pin marker currently on `--danger` is neither destructive nor score-related. Change it to `var(--notice)`.

- [ ] **Step 3: The PGA leaderboard moves to its own tokens**

In `pages/home.html`:

```css
.c-under { color:var(--pga-under); }
.c-over  { color:var(--pga-over); }
```

Keep the existing explanatory comment above them. `.c-even` stays `var(--text)`.

- [ ] **Step 4: Mid-tier orange moves to `--warn`**

In `pages/courses.html`, replace all 10 occurrences of the literal `#E67E22` with `var(--warn)`. They appear inside three-tier ternaries alongside `--good` and `--bad`. Confirm with `grep -c "#E67E22" pages/courses.html` — expected `0` after.

Also in `pages/courses.html`, the `var(--gold)` used as a mid tier in the `firC` / `girC` / `puttC` / `udC` threshold functions is the same concept: change those four to `var(--warn)`.

**This is not hash-neutral on its own** — `--gold` is `#F1C40F` and `--warn` is `#E67E22`. Those four sites are JavaScript-only and never render under the capture harness, so the hash will not move, but note it in your report as a deliberate appearance change to a code path the harness cannot reach.

- [ ] **Step 5: `.fcb-strip` moves to `--map-surface-2`**

In `pages/hole.html`, `.fcb-strip` is the distance readout under the satellite map. It sits on `var(--surface-2)`; change it to `var(--map-surface-2)` so it stops inverting in Phase 3. Same value today, so no pixel moves.

- [ ] **Step 6: Verify pixel-identical**

Build probes, run the sweep, compare all ten to the baselines. Expected: 10 of 10 identical.

If a hash moved, you reassigned something whose values differ — find it with the rows diff and fix it. **Never edit a baseline.**

- [ ] **Step 7: Commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git add pages/
git commit -m "refactor: reassign notices, PGA leaderboard, mid-tier and map strip to their own tokens"
```

---

### Task 3: Tokenize the opaque derived tints

Four opaque colours were derived from the accent or bad hues but written as flat hex, so Phase 1's `rgba()`-only conversion table missed them. Left alone, Phase 2 turns their foreground cyan and leaves the backing green.

**Files:** Modify `pages/courses.html`, `pages/tc.css`

**Interfaces:** Consumes Task 1's tokens.

- [ ] **Step 1: Replace each with a translucent token tint**

| File | Current | Replace with |
|---|---|---|
| `pages/courses.html` (background under accent text) | `#0D2B1A` | `rgb(var(--accent-rgb) / 0.14)` |
| `pages/courses.html` `.score-t` | `#8B0000` | `rgb(var(--bad-rgb) / 0.55)` |
| `pages/tc.css` `.map` | `#0B1210` | `rgb(var(--accent-rgb) / 0.06)` |
| `pages/tc.css` `.gmap` | `#0C160C` | `rgb(var(--accent-rgb) / 0.08)` |

**The alpha values above are starting points, not measured matches.** A translucent tint over the page background will not be identical to the flat hex it replaces — that is intended, since the point is to follow the palette rather than freeze at today's green. But if a value reads visibly wrong on screen (washed out, too dark, or losing the panel edge), adjust the alpha until it looks right and **record the final value and why you changed it** in your report. Do not silently keep a bad-looking value just because it was written here.

- [ ] **Step 2: Capture and record the expected diff**

Run the sweep. `courses` and any page using `.map` / `.gmap` will differ from baseline. That is expected here and only here.

For each page whose hash moved, run the rows-capture variant, diff against its stored baseline, and **confirm every differing element is one of the four you just changed**. If anything else moved, you broke something — fix it.

Record the new hashes in your report; they become the reference for Task 4.

- [ ] **Step 3: Screenshot before and after**

Screenshot `courses.html` and `hole.html` at 390x844, and confirm by eye that the tinted areas still read as intended — no washed-out or over-dark panels.

- [ ] **Step 4: Commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git add pages/courses.html pages/tc.css
git commit -m "refactor: tokenize opaque accent-derived tints"
```

---

### Task 4: Unify the stat category stripes

The user chose: the coloured stripes all become the accent colour.

**Files:** Modify `pages/stats.html`

**Interfaces:** Consumes `--accent`.

- [ ] **Step 1: Change the category colours**

In `pages/stats.html`, the `CATS` array has **8 entries**, each with a `color` property driving its `.sc-accent` stripe:

| Category | Today | Set to |
|---|---|---|
| `scoring` | `var(--good)` | `var(--accent)` |
| `ott` | `var(--good)` | `var(--accent)` |
| `approach` | `var(--bad)` | `var(--accent)` |
| `atg` | `var(--good)` | `var(--accent)` |
| `putting` | `var(--bad)` | `var(--accent)` |
| `sg` | `var(--good)` | `var(--accent)` |
| `handicap` | `var(--good)` | `var(--accent)` |
| `conditions` | `var(--text-muted)` | **leave unchanged** |

`conditions` is deliberately neutral grey rather than a performance colour, so it is not part of this unification. Change the other seven.

- [ ] **Step 2: Verify only the two red stripes moved**

Run the sweep. `stats` will differ from its baseline: the five `--good` stripes were already the same value as `--accent`, so only the two `--bad` ones change.

Run the rows capture, diff against `.superpowers/theme-baseline/stats.json`, and confirm **exactly two elements differ** and both are category stripes. Anything else means you edited too much.

Record the new `stats` hash.

- [ ] **Step 3: Screenshot**

Screenshot `stats.html` at 390x844. All seven stripes should now be one colour.

- [ ] **Step 4: Commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git add pages/stats.html
git commit -m "refactor: unify stat category stripes on the accent colour"
```

---

### Task 5: Apply the Midnight values

The recolour itself. One file, one block.

**Files:** Modify `pages/tc.css`

**Interfaces:** Consumes every token defined so far.

- [ ] **Step 1: Rewrite the token values**

In `pages/tc.css`'s `:root`, set each token to its Midnight value from the "Midnight values" table above, and each channel triplet to the decimal RGB of its partner:

```css
  --bg: #080C14;
  --surface: #101827;
  --surface-2: #18202F;
  --border: #1D2839;

  --text: #E8EDF5;
  --text-muted: #7A8699;
  --text-dim: #4A5568;
  --text-on-accent: #04080F;

  --accent: #38BDD0;

  --good: #4ADE80;
  --bad: #EF6262;
  --danger: #EF6262;
  --notice: #E8836A;
  --warn: #E8A33D;
  --gold: #F1C40F;

  --pga-under: #EF6262;
  --pga-over: #4A90D9;

  --map-surface: #101827;
  --map-surface-2: #18202F;
  --map-text: #E8EDF5;

  --ink-rgb: 255 255 255;
  --shadow-rgb: 0 0 0;
  --accent-rgb: 56 189 208;
  --good-rgb: 74 222 128;
  --bad-rgb: 239 98 98;
  --danger-rgb: 239 98 98;
  --notice-rgb: 232 131 106;
  --warn-rgb: 232 163 61;
  --gold-rgb: 241 196 15;
```

Update the block's leading comment — it currently says values are today's colours pending Phase 2. Replace with: `/* Midnight palette — dark theme. Light theme values land in Phase 3. */`

- [ ] **Step 2: Confirm every token moved together with its triplet**

```bash
grep -A40 "^:root" pages/tc.css | grep -E "^\s+--(accent|good|bad|danger|notice|warn|gold)(-rgb)?:"
```

Check by eye that each hex and its decimal triplet describe the same colour. `#38BDD0` is `56 189 208`; `#4ADE80` is `74 222 128`; `#EF6262` is `239 98 98`; `#E8836A` is `232 131 106`; `#E8A33D` is `232 163 61`; `#F1C40F` is `241 196 15`. A mismatch here leaves translucent tints one colour and solid fills another.

- [ ] **Step 3: Screenshot all ten pages**

At 390x844, saved under `.superpowers/sdd/`. Inspect each. Look specifically for: text that has become hard to read, panels that vanished into the background, and any element still rendering green that should have moved.

- [ ] **Step 4: Commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git add pages/tc.css
git commit -m "feat: apply the Midnight dark palette"
```

---

### Task 6: Sync the scorecard's duplicate token block

`pages/scorecard.html` is a standalone print template that does not load `tc.css`, so it carries its own copy of the tokens. Without this task it keeps the old dark-green palette while every other page turns navy.

**Files:** Modify `pages/scorecard.html`

**Interfaces:** Consumes the Midnight values from Task 5.

- [ ] **Step 1: Update the local `:root`**

Its local `:root` (near the top of the `<style>` block) duplicates 9 values. Set each to its Midnight value:

```css
  --bg: #080C14;
  --surface: #101827;
  --text: #E8EDF5;
  --text-muted: #7A8699;
  --text-on-accent: #04080F;
  --accent: #38BDD0;
  --good: #4ADE80;
  --ink-rgb: 255 255 255;
  --shadow-rgb: 0 0 0;
```

Keep the existing "keep in sync with pages/tc.css" comment and strengthen it to name Phase 3 as the next time it must be revisited.

- [ ] **Step 2: Confirm no value drifted from `tc.css`**

For each of the nine, check the value matches `tc.css`'s. A mismatch is the exact failure this task exists to prevent.

- [ ] **Step 3: Screenshot**

Screenshot `scorecard.html` at 390x844. Its printed-card area stays white paper with dark ink — that is correct and unchanged. Confirm the surrounding app chrome went navy.

- [ ] **Step 4: Commit**

```bash
cd "c:/Users/Abcro/OneDrive/Documents/Claude Projects/Tour-caddie v1"
rm -f pages/__probe-*.html pages/__fixture.json && rm -rf .playwright-mcp
git add pages/scorecard.html
git commit -m "feat: sync scorecard's local token block to Midnight"
```

---

### Task 7: Contrast audit and final sweep

No files change. This produces the evidence.

- [ ] **Step 1: Measure text contrast on every page**

Build probes and run the sweep page, then evaluate:

```javascript
async () => {
  await new Promise(r => setTimeout(r, 2500));
  const lum = (rgb) => {
    const [r,g,b] = rgb.match(/\d+/g).slice(0,3).map(Number).map(v => {
      v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    });
    return 0.2126*r + 0.7152*g + 0.0722*b;
  };
  const ratio = (a,b) => { const l1=lum(a), l2=lum(b);
    return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
  const solid = (el, doc) => {
    let n = el;
    while (n && n !== doc.documentElement) {
      const bg = doc.defaultView.getComputedStyle(n).backgroundColor;
      if (bg && !bg.includes('rgba(0, 0, 0, 0)')) return bg;
      n = n.parentElement;
    }
    return 'rgb(8, 12, 20)';
  };
  const out = {};
  for (const f of document.querySelectorAll('iframe')) {
    const doc = f.contentDocument; const fails = [];
    doc.querySelectorAll('*').forEach(el => {
      if (!el.textContent || !el.textContent.trim()) return;
      if (el.children.length) return;
      const cs = doc.defaultView.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3.0 : 4.5;
      const r = ratio(cs.color, solid(el, doc));
      if (r < need) fails.push({ text: el.textContent.trim().slice(0,24),
        color: cs.color, size, ratio: Math.round(r*100)/100, need });
    });
    out[f.dataset.n] = { failCount: fails.length, worst: fails.sort((a,b)=>a.ratio-b.ratio).slice(0,5) };
  }
  return out;
}
```

Report per page: how many text elements fall below WCAG AA (4.5:1 normal, 3:1 large) and the five worst.

**Do not silently "fix" failures by editing token values.** Report them. Some will be pre-existing — the same measurement on `master` tells you which. Run it there for comparison if any page fails, so the report distinguishes "Midnight made this worse" from "this was always like that".

- [ ] **Step 2: Screenshot every page**

All ten at 390x844, saved under `.superpowers/sdd/`. List the paths.

- [ ] **Step 3: Confirm nothing is still green that should not be**

```bash
grep -rn "#2ECC71\|46, *204, *113\|rgba(46,204,113" pages/ | grep -v "^pages/__probe"
```

Expected: no output. Any hit is a colour that escaped the token system and will stay green forever.

- [ ] **Step 4: Report**

State: per-page contrast results with the master comparison for any failures, all screenshot paths, the green-residue grep result, and anything that looks wrong. No commit — this task changes nothing.

---

## Definition of Done

- [ ] Tasks 1 and 2 landed pixel-identical (10/10 hashes).
- [ ] Task 3's and Task 4's diffs contain only the elements those tasks changed.
- [ ] Every token and its channel triplet describe the same colour.
- [ ] `scorecard.html`'s local `:root` matches `tc.css`'s values exactly.
- [ ] Contrast measured on all ten pages, with any failure classified as pre-existing or newly introduced.
- [ ] Ten screenshots produced and inspected.
- [ ] No `#2ECC71` or `46,204,113` remains anywhere in `pages/`.
- [ ] No probe, fixture, or screenshot files committed; `tour-caddie/` untouched.
