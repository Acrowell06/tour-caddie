# Account Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `profile.html`'s Account screen's Display Name, Password, and Email rows actually editable, replacing their current "coming soon" toasts.

**Architecture:** Three new tap-to-open sheets (matching the existing Tee/Home Course sheet pattern in the same file). Display Name writes to `profiles.display_name`. Password and Email both re-authenticate first via `TcAuth.signInWithPassword` (Supabase has no dedicated password-reauth verb), then call `client.auth.updateUser(...)`. Email's change is confirmation-link based — the sheet shows a "check your email" state rather than an instant success, and the displayed email is left showing the old value until the golfer actually confirms (the app already reads `session.user.email` fresh on every load, so no separate sync is needed once they do).

**Tech Stack:** Plain HTML/JS (no build step), Supabase JS client (`TcAuth.client`, `TcAuth.signInWithPassword`).

## Global Constraints

- No new database schema — Display Name uses the already-existing `profiles.display_name` column; Password and Email are Supabase Auth's own built-in fields, not `profiles` columns.
- Both Password and Email changes require re-entering the current password first (confirmed via `TcAuth.signInWithPassword(session.user.email, currentPassword)`) before calling `updateUser(...)`. If that re-auth call throws, show "Current password is incorrect" as a sheet-local error and make no `updateUser` call.
- Supabase's own validation error messages (e.g. "Password should be at least 6 characters") are shown verbatim in the sheet — never duplicated or guessed client-side.
- `profiles.email` is never written to by this plan — it's a legacy signup-time snapshot nothing currently reads; the Account screen displays `session.user.email` directly and already does so correctly.
- A network/unexpected failure on Display Name save shows the existing app-wide toast (`showToast('toast', 'Failed to save — try again')`) and leaves the sheet open with input intact — same pattern as every other setting in this app.
- Email's sheet must never claim the change succeeded instantly — it must show a distinct "check your email to confirm" state, and the Account row must keep showing the *old* email until the golfer actually confirms.

---

### Task 1: `pages/profile.html` — Account editing sheets

**Files:**
- Modify: `pages/profile.html`

**Interfaces:**
- Consumes: `TcAuth.getSession()`, `TcAuth.client` (incl. `.auth.updateUser(...)`), `TcAuth.signInWithPassword(email, password)` (all already loaded/defined in `tc-auth.js`), `showToast(elId, msg)` (from `tc-utils.js`), `escHtml(s)` (already defined in this file).
- Produces: nothing consumed by later tasks — this is the only task in this plan.

- [ ] **Step 1: Add shared sheet-button/error styles**

Find:
```css
/* ── SIGN OUT ── */
.signout-btn { margin: 0 12px 20px; background: rgba(231,76,60,0.06); border: 1px solid rgba(231,76,60,0.25); border-radius: 12px; padding: 13px; font-size: 14px; font-weight: 700; color: var(--red); text-align: center; cursor: pointer; transition: opacity 0.12s; flex-shrink: 0; }
.signout-btn:active { opacity: 0.65; }
```

Replace:
```css
/* ── SIGN OUT ── */
.signout-btn { margin: 0 12px 20px; background: rgba(231,76,60,0.06); border: 1px solid rgba(231,76,60,0.25); border-radius: 12px; padding: 13px; font-size: 14px; font-weight: 700; color: var(--red); text-align: center; cursor: pointer; transition: opacity 0.12s; flex-shrink: 0; }
.signout-btn:active { opacity: 0.65; }

/* ── SHEET SAVE BUTTON / INLINE ERROR (Account editing sheets) ── */
.sheet-save-btn { margin-top: 4px; background: rgba(46,204,113,0.12); border: 1px solid rgba(46,204,113,0.35); border-radius: 12px; padding: 13px; font-size: 14px; font-weight: 700; color: var(--green); text-align: center; cursor: pointer; transition: opacity 0.12s; }
.sheet-save-btn:active { opacity: 0.65; }
.sheet-err { color: #E74C3C; font-size: 10px; margin: 6px 0; min-height: 12px; }
```

- [ ] **Step 2: Add the three new sheets**

Find:
```html
<div class="toast" id="toast"></div>
```

Replace:
```html
<!-- ── EDIT NAME SHEET ── -->
<div class="sheet-ov" id="name-ov">
  <div class="sheet-bd" onclick="closeNameSheet()"></div>
  <div class="sheet">
    <div class="sh-handle"></div>
    <div class="sh-top">
      <div class="sh-ttl">Display Name</div>
      <div class="sh-undo" onclick="closeNameSheet()">✕ Close</div>
    </div>
    <input class="lg-inp" id="name-inp" placeholder="e.g. Jane Smith" style="margin-bottom:8px;">
    <div class="sheet-err" id="name-err"></div>
    <div class="sheet-save-btn" onclick="saveDisplayName()">Save</div>
  </div>
</div>

<!-- ── CHANGE PASSWORD SHEET ── -->
<div class="sheet-ov" id="pwd-ov">
  <div class="sheet-bd" onclick="closePasswordSheet()"></div>
  <div class="sheet">
    <div class="sh-handle"></div>
    <div class="sh-top">
      <div class="sh-ttl">Change Password</div>
      <div class="sh-undo" onclick="closePasswordSheet()">✕ Close</div>
    </div>
    <input class="lg-inp" type="password" id="pwd-current-inp" placeholder="Current password" style="margin-bottom:8px;">
    <input class="lg-inp" type="password" id="pwd-new-inp" placeholder="New password" style="margin-bottom:8px;">
    <input class="lg-inp" type="password" id="pwd-confirm-inp" placeholder="Confirm new password" style="margin-bottom:8px;">
    <div class="sheet-err" id="pwd-err"></div>
    <div class="sheet-save-btn" onclick="savePassword()">Save</div>
  </div>
</div>

<!-- ── CHANGE EMAIL SHEET ── -->
<div class="sheet-ov" id="email-ov">
  <div class="sheet-bd" onclick="closeEmailSheet()"></div>
  <div class="sheet">
    <div class="sh-handle"></div>
    <div class="sh-top">
      <div class="sh-ttl">Change Email</div>
      <div class="sh-undo" onclick="closeEmailSheet()">✕ Close</div>
    </div>
    <div id="email-form">
      <input class="lg-inp" type="email" id="email-new-inp" placeholder="New email address" style="margin-bottom:8px;">
      <input class="lg-inp" type="password" id="email-pwd-inp" placeholder="Current password" style="margin-bottom:8px;">
      <div class="sheet-err" id="email-err"></div>
      <div class="sheet-save-btn" onclick="saveEmail()">Save</div>
    </div>
    <div id="email-pending" style="display:none;text-align:center;padding:12px 4px;font-size:12px;color:var(--muted);line-height:1.6;">
      Check your email to confirm this change.
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>
```

- [ ] **Step 3: Wire the three Account row taps to open the new sheets**

Find:
```html
      <div class="settings-row" onclick="showToast('toast','Edit name — coming soon')">
        <div class="sr-lbl">Display Name</div>
        <div class="sr-val" id="acct-name-val">— <span class="chev">›</span></div>
      </div>
      <div class="settings-row" onclick="showToast('toast','Change email — coming soon')">
        <div class="sr-lbl">Email</div>
        <div class="sr-val" id="acct-email-val">— <span class="chev">›</span></div>
      </div>
      <div class="settings-row" onclick="showToast('toast','Change password — coming soon')">
        <div class="sr-lbl">Password</div>
        <div class="sr-val">Change <span class="chev">›</span></div>
      </div>
```

Replace:
```html
      <div class="settings-row" onclick="openNameSheet()">
        <div class="sr-lbl">Display Name</div>
        <div class="sr-val" id="acct-name-val">— <span class="chev">›</span></div>
      </div>
      <div class="settings-row" onclick="openEmailSheet()">
        <div class="sr-lbl">Email</div>
        <div class="sr-val" id="acct-email-val">— <span class="chev">›</span></div>
      </div>
      <div class="settings-row" onclick="openPasswordSheet()">
        <div class="sr-lbl">Password</div>
        <div class="sr-val">Change <span class="chev">›</span></div>
      </div>
```

- [ ] **Step 4: Track the current display name as module state**

Find:
```js
let selectedTeeKey      = null;   // canonical key: 'tips'|'blue'|'white'|'gold'|'red' | null
let selectedHomeCourse  = null;   // { name, lat, lng } | null
let currentUnit         = 'yards';
let activeFriend        = null;
let activeFdTab         = 'rounds';
let courseSearchResults = [];     // last TcCourse.searchByName results, indexed for selectCourse(i)
let courseSearchDebounce;
```

Replace:
```js
let selectedTeeKey      = null;   // canonical key: 'tips'|'blue'|'white'|'gold'|'red' | null
let selectedHomeCourse  = null;   // { name, lat, lng } | null
let currentUnit         = 'yards';
let activeFriend        = null;
let activeFdTab         = 'rounds';
let courseSearchResults = [];     // last TcCourse.searchByName results, indexed for selectCourse(i)
let courseSearchDebounce;
let currentDisplayName  = null;   // string | null — kept in sync with profiles.display_name
```

- [ ] **Step 5: Populate `currentDisplayName` from the init fetch**

Find:
```js
    const name = data?.display_name || null;
    const nameEl = document.getElementById('pf-name');
```

Replace:
```js
    const name = data?.display_name || null;
    currentDisplayName = name;
    const nameEl = document.getElementById('pf-name');
```

- [ ] **Step 6: Add the Display Name, Password, and Email sheet functions**

Find:
```js
/* ── SUB-SCREENS ── */
function openGolfScreen()        { document.getElementById('golf-screen').classList.add('open'); }
```

Replace:
```js
/* ── EDIT NAME ── */
function openNameSheet() {
  document.getElementById('name-inp').value = currentDisplayName || '';
  document.getElementById('name-err').textContent = '';
  document.getElementById('name-ov').classList.add('open');
}
function closeNameSheet() { document.getElementById('name-ov').classList.remove('open'); }

async function saveDisplayName() {
  const name = document.getElementById('name-inp').value.trim();
  const errEl = document.getElementById('name-err');
  if (!name) { errEl.textContent = 'Enter a display name.'; return; }
  const session = await TcAuth.getSession();
  if (!session) return;
  const { error } = await TcAuth.client.from('profiles').update({ display_name: name }).eq('id', session.user.id);
  if (error) { showToast('toast', 'Failed to save — try again'); return; }
  currentDisplayName = name;
  document.getElementById('pf-name').textContent = name;
  document.getElementById('pf-avatar').textContent = name.split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();
  document.getElementById('acct-name-val').innerHTML = `${escHtml(name)} <span class="chev">›</span>`;
  closeNameSheet();
}

/* ── CHANGE PASSWORD ── */
function openPasswordSheet() {
  document.getElementById('pwd-current-inp').value = '';
  document.getElementById('pwd-new-inp').value = '';
  document.getElementById('pwd-confirm-inp').value = '';
  document.getElementById('pwd-err').textContent = '';
  document.getElementById('pwd-ov').classList.add('open');
}
function closePasswordSheet() { document.getElementById('pwd-ov').classList.remove('open'); }

async function savePassword() {
  const current = document.getElementById('pwd-current-inp').value;
  const next    = document.getElementById('pwd-new-inp').value;
  const confirm = document.getElementById('pwd-confirm-inp').value;
  const errEl = document.getElementById('pwd-err');
  errEl.textContent = '';
  if (!current || !next || !confirm) { errEl.textContent = 'Fill in all three fields.'; return; }
  if (next !== confirm) { errEl.textContent = 'New password and confirmation do not match.'; return; }
  const session = await TcAuth.getSession();
  if (!session?.user?.email) return;
  try {
    await TcAuth.signInWithPassword(session.user.email, current);
  } catch {
    errEl.textContent = 'Current password is incorrect.';
    return;
  }
  const { error } = await TcAuth.client.auth.updateUser({ password: next });
  if (error) { errEl.textContent = error.message; return; }
  closePasswordSheet();
  showToast('toast', 'Password changed');
}

/* ── CHANGE EMAIL ── */
function openEmailSheet() {
  document.getElementById('email-new-inp').value = '';
  document.getElementById('email-pwd-inp').value = '';
  document.getElementById('email-err').textContent = '';
  document.getElementById('email-form').style.display = '';
  document.getElementById('email-pending').style.display = 'none';
  document.getElementById('email-ov').classList.add('open');
}
function closeEmailSheet() { document.getElementById('email-ov').classList.remove('open'); }

async function saveEmail() {
  const newEmail = document.getElementById('email-new-inp').value.trim();
  const pwd      = document.getElementById('email-pwd-inp').value;
  const errEl = document.getElementById('email-err');
  errEl.textContent = '';
  if (!newEmail || !pwd) { errEl.textContent = 'Enter a new email and your current password.'; return; }
  const session = await TcAuth.getSession();
  if (!session?.user?.email) return;
  try {
    await TcAuth.signInWithPassword(session.user.email, pwd);
  } catch {
    errEl.textContent = 'Current password is incorrect.';
    return;
  }
  const { error } = await TcAuth.client.auth.updateUser({ email: newEmail });
  if (error) { errEl.textContent = error.message; return; }
  document.getElementById('email-form').style.display = 'none';
  document.getElementById('email-pending').style.display = '';
}

/* ── SUB-SCREENS ── */
function openGolfScreen()        { document.getElementById('golf-screen').classList.add('open'); }
```

- [ ] **Step 7: Syntax check**

```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('pages/profile.html', 'utf8');
const scripts = [...content.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```

Expected: all blocks `OK`, no errors.

- [ ] **Step 8: Manual browser verification**

With `pages/` served locally and signed in:

1. Change Display Name → confirm `profiles.display_name` updates in the Supabase Table Editor, and the new name appears immediately in the Account row, the profile header name, and the avatar initials — no reload.
2. Open the Password sheet, enter the wrong current password → confirm "Current password is incorrect" shows and nothing else happens.
3. Open the Password sheet, enter the correct current password and a new password (with confirmation matching) → confirm success, then sign out and confirm the new password logs in (and the old one no longer does).
4. Open the Email sheet, enter a new email and the correct current password → confirm the sheet switches to the "check your email to confirm" message, and confirm the Account screen still shows the *old* email afterward (not the new one yet).
5. Enter a deliberately too-short new password → confirm Supabase's own error text appears in the sheet (not a generic message).

- [ ] **Step 9: Commit**

```bash
git add pages/profile.html
git commit -m "feat: enable Account editing (display name, password, email)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Display Name editable, writes to `profiles.display_name` | Task 1 Steps 4-6 (`saveDisplayName`) |
| Password editable, requires current-password re-auth | Task 1 Step 6 (`savePassword`) |
| Email editable, requires current-password re-auth, confirmation-link flow | Task 1 Step 6 (`saveEmail`) |
| Sheet UI pattern matches existing Tee/Home Course sheets | Task 1 Step 2 (`.sheet-ov`/`.sheet`/`.sh-handle`/`.sh-top`/`.lg-inp`, all pre-existing classes reused) |
| Wrong current password → sheet-local error, no `updateUser` call | Task 1 Step 6 (`try { signInWithPassword... } catch { errEl.textContent = ...; return; }` in both `savePassword`/`saveEmail`) |
| Supabase's own validation errors shown verbatim | Task 1 Step 6 (`errEl.textContent = error.message`) |
| `profiles.email` untouched | Task 1 Step 6 (`saveEmail` never writes to `profiles`, only `client.auth.updateUser`) |
| Email sheet shows "check your email," never claims instant success | Task 1 Step 2 (`#email-pending`), Step 6 (`saveEmail` toggles `#email-form`/`#email-pending` display, no `acct-email-val` update) |
| Failed Display Name save shows app-wide toast, sheet stays open | Task 1 Step 6 (`saveDisplayName`'s `if (error) { showToast(...); return; }` — no `closeNameSheet()` call on that path) |

**Placeholder scan:** no TBD/TODO; every step has literal code or an exact verification procedure.

**Type consistency:** `currentDisplayName` is a plain `string | null`, matching the same pattern as `selectedTeeKey`/`selectedHomeCourse`/`currentUnit`. `TcAuth.signInWithPassword(email, password)` and `TcAuth.client.auth.updateUser({...})` are used with the exact signatures already defined in `tc-auth.js`/the Supabase JS SDK — no new wrapper functions invented. `escHtml(s)` (already defined earlier in this same file) is reused for the Display Name's own innerHTML update, consistent with how it's already used for Home Course names elsewhere in this file.
