# Real Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every fake auth mechanism in this HTML/JS prototype (the localStorage-based "auto-login" mock) with real Supabase-backed email/password + Google + Apple sign-in, real session persistence, and a real logged-out redirect gate on every page.

**Architecture:** A new shared `pages/tc-auth.js` module (same pattern as the existing `tc-course.js`/`tc-utils.js`) wraps the Supabase JS client (loaded from its UMD CDN build — no build step, no bundler, matching every other file in this codebase). `login.html` is rewired to call it for real sign-in/sign-up/OAuth. Every other page gets two new `<script>` tags plus one line that redirects to `login.html` if there's no session. One new Postgres table (`profiles`) plus a trigger auto-creates a profile row on signup.

**Tech Stack:** Vanilla JS, `@supabase/supabase-js@2.110.0` (pinned UMD CDN build, loaded with a Subresource Integrity hash), Supabase Auth + Postgres + Row Level Security. No build step, no ES modules.

## Global Constraints

- No build step — plain `<script src="...">` tags only; no ES modules, no bundler, no npm install.
- Supabase project URL: `https://cfuxiifpvuzvysjxztax.supabase.co`
- Supabase anon/publishable key: `sb_publishable_QlnEC8AOsbV3oVlLbojpTg_9I137qgM` (safe to embed client-side — Supabase's security model is Row Level Security, not key secrecy)
- The Supabase UMD CDN script tag — pinned to an exact version with a Subresource Integrity hash (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js`, `integrity="sha384-3wY11tldQ5+yWqAvmTN4XtQvnjoTva0cV15O/O/O5NTtp0ivVopSzLOzsVXWZse9"`, `crossorigin="anonymous"` — this exact hash was computed against the real downloaded file, not fabricated; if this file is ever re-pinned to a newer version, the hash must be recomputed from the actual downloaded bytes of that version, never guessed) — must load, in the page, **before** `tc-auth.js`, and exposes a global `window.supabase`.
- OAuth redirect target for both Google and Apple: back to that page's `home.html` (i.e. `location.origin + location.pathname.replace(/[^/]+$/, 'home.html')`), regardless of which page initiated the OAuth flow.
- `TcAuth.requireAuth()` is a client-side convenience redirect only, not real security — the actual data protection is the Row Level Security policies on the `profiles` table (Task 2). Because plain `<script>` tags don't support top-level `await`, `requireAuth()` is invoked via a small async IIFE (`(async () => { await TcAuth.requireAuth(); })();`) as the very first statement in each protected page's own script block; the rest of that page's synchronous init code may still run for a brief moment before the redirect completes — this is an accepted tradeoff, not a bug to fix in this plan.
- Google sign-in will not actually work until the user completes a manual Google Cloud OAuth setup (documented in Task 3) — this plan wires the code path correctly regardless, and the resulting error before that setup is done (a provider-not-configured error from Supabase) is the *expected* pre-setup behavior.
- Apple sign-in will not actually work until the user completes a manual Apple Developer Program setup (documented in Task 3, requires a paid $99/year membership) — same as above, wire the code path now regardless of when that setup happens.

---

### Task 1: `pages/tc-auth.js` — shared auth module

**Files:**
- Create: `pages/tc-auth.js`

**Interfaces:**
- Produces: `window.TcAuth` object with methods:
  - `TcAuth.client` — the raw Supabase client instance (escape hatch for anything not wrapped below)
  - `TcAuth.signUp(email, password, displayName)` → `Promise<data>`, throws on error
  - `TcAuth.signInWithPassword(email, password)` → `Promise<data>`, throws on error
  - `TcAuth.signInWithOAuth(provider)` → `Promise<data>`, `provider` is `'google'` or `'apple'`, throws on error
  - `TcAuth.signOut()` → `Promise<void>`, throws on error
  - `TcAuth.getSession()` → `Promise<Session|null>`
  - `TcAuth.requireAuth()` → `Promise<Session|null>`, redirects to that page's `login.html` if there's no session; returns the session if there is one

- [ ] **Step 1: Create `pages/tc-auth.js`**

```js
/* tc-auth.js — Real Supabase authentication. Requires the Supabase UMD
   CDN script (https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js,
   pinned with a Subresource Integrity hash — see Global Constraints)
   to be loaded on the page BEFORE this file, so window.supabase exists. */
window.TcAuth = (() => {
  const SUPABASE_URL = 'https://cfuxiifpvuzvysjxztax.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_QlnEC8AOsbV3oVlLbojpTg_9I137qgM';

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function homeUrl() {
    return location.origin + location.pathname.replace(/[^/]+$/, 'home.html');
  }
  function loginUrl() {
    return location.origin + location.pathname.replace(/[^/]+$/, 'login.html');
  }

  async function signUp(email, password, displayName) {
    const { data, error } = await client.auth.signUp({
      email, password,
      options: { data: { display_name: displayName } }
    });
    if (error) throw error;
    return data;
  }

  async function signInWithPassword(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signInWithOAuth(provider) {
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: homeUrl() }
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  async function getSession() {
    const { data, error } = await client.auth.getSession();
    if (error) return null;
    return data.session;
  }

  async function requireAuth() {
    const session = await getSession();
    if (!session) {
      window.location.href = loginUrl();
    }
    return session;
  }

  return { client, signUp, signInWithPassword, signInWithOAuth, signOut, getSession, requireAuth };
})();
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "
const fs = require('fs');
try { new Function(fs.readFileSync('pages/tc-auth.js', 'utf8')); console.log('OK'); }
catch (e) { console.log('SYNTAX ERROR:', e.message); }
"
```
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add pages/tc-auth.js
git commit -m "feat: add tc-auth.js — Supabase-backed sign-in/sign-up/OAuth/session module"
```

---

### Task 2: `profiles` table — database migration

**Files:**
- Create: `supabase/migrations/0001_create_profiles.sql`

**Interfaces:**
- Produces: a `public.profiles` table with columns `id uuid` (PK, references `auth.users.id`), `email text`, `display_name text`, `created_at timestamptz` — auto-populated by a trigger whenever a new row is inserted into `auth.users`. Row Level Security restricts each user to their own row.
- This task's SQL must be run against the live Supabase project by the user (via the dashboard's SQL Editor) — there is no database connection string or CLI access available in this session to apply it directly. If you are an agentic implementer with no way to prompt a human synchronously, stop and report NEEDS_CONTEXT asking the controller to relay this step to the user and confirm completion before you continue to Step 3.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0001_create_profiles.sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2: Ask the user to apply the migration**

Tell the user:

> "Open your Supabase project dashboard at https://supabase.com/dashboard/project/cfuxiifpvuzvysjxztax, go to the **SQL Editor** in the left sidebar, paste the contents of `supabase/migrations/0001_create_profiles.sql`, and click **Run**. Let me know once it's run successfully (or paste any error it shows)."

Wait for the user's confirmation before proceeding to Step 3. If they report an error, read it and fix the SQL file, then ask them to run the corrected version.

- [ ] **Step 3: Verify the table exists**

Ask the user to confirm via the Supabase dashboard's **Table Editor** that a `profiles` table now exists with columns `id`, `email`, `display_name`, `created_at`. (There is no way to query this directly from this session without a database connection string.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_create_profiles.sql
git commit -m "feat: add profiles table migration (id, email, display_name + auto-create trigger + RLS)"
```

---

### Task 3: `pages/login.html` — real sign-in, sign-up, and OAuth

**Files:**
- Modify: `pages/login.html`

**Interfaces:**
- Consumes: `TcAuth.signUp`, `TcAuth.signInWithPassword`, `TcAuth.signInWithOAuth`, `TcAuth.getSession` from Task 1.

- [ ] **Step 1: Add the Supabase CDN script and `tc-auth.js` before the existing utility script**

Find in `pages/login.html`:
```html
<script src="tc-utils.js"></script>
```

Replace with:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js" integrity="sha384-3wY11tldQ5+yWqAvmTN4XtQvnjoTva0cV15O/O/O5NTtp0ivVopSzLOzsVXWZse9" crossorigin="anonymous"></script>
<script src="tc-auth.js"></script>
<script src="tc-utils.js"></script>
```

- [ ] **Step 2: Add an error-message slot and a name field to the form markup**

Find:
```html
    <div class="lg-form" style="position:relative;z-index:2;">
      <input class="lg-inp" id="lg-email" type="email" placeholder="Email address" autocomplete="email">
      <input class="lg-inp" id="lg-pass" type="password" placeholder="Password" autocomplete="current-password">
      <label class="lg-remember">
        <input type="checkbox" id="lg-rem"> Remember me
      </label>
      <button class="lg-btn" id="lg-signin" onclick="doSignIn()">Sign In</button>
      <div class="lg-div">
        <div class="lg-dl"></div>
        <span class="lg-dt">or continue with</span>
        <div class="lg-dl"></div>
      </div>
      <div class="orow">
        <button class="obtn" onclick="navigate('home')">
          <svg width="16" height="16" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.08 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.96 2.31-8.16 2.31-6.26 0-11.57-3.59-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Google
        </button>
        <button class="obtn" onclick="navigate('home')">
          <svg width="15" height="16" viewBox="0 0 814 1000" xmlns="http://www.w3.org/2000/svg" fill="white">
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-43.4-150.3-109.7c-52.8-75.2-96.1-190.9-96.1-300.9 0-186.1 121.4-279.7 240.8-279.7 60.3 0 110.7 39.5 148.5 39.5 35.8 0 92.6-42.1 161.3-42.1 25.8 0 108.2 2.6 168.4 80.6zM554.1 131.8c26.2-31.6 44.9-76.1 44.9-120.6 0-6.4-.6-12.8-1.9-18 0-.6-.6-.6-.6-.6-45.5 1.9-99.5 30.3-131.8 63.9-24.5 27.7-47 72.8-47 118.3 0 7.1.6 14.1 1.3 16.4.6.6 1.3.6 1.9.6 40.4-.6 89.7-26.9 133.2-59.9z"/>
          </svg>
          Apple
        </button>
      </div>
      <div class="lg-ft">Don't have an account? <span>Sign Up</span></div>
    </div>
```

Replace with:
```html
    <div class="lg-form" style="position:relative;z-index:2;">
      <input class="lg-inp" id="lg-name" type="text" placeholder="Full name" autocomplete="name" style="display:none;">
      <input class="lg-inp" id="lg-email" type="email" placeholder="Email address" autocomplete="email">
      <input class="lg-inp" id="lg-pass" type="password" placeholder="Password" autocomplete="current-password">
      <div id="lg-err" style="display:none;color:#E74C3C;font-size:11px;text-align:center;margin:-4px 0 8px;"></div>
      <button class="lg-btn" id="lg-signin" onclick="doSignIn()">Sign In</button>
      <div class="lg-div">
        <div class="lg-dl"></div>
        <span class="lg-dt">or continue with</span>
        <div class="lg-dl"></div>
      </div>
      <div class="orow">
        <button class="obtn" onclick="doOAuth('google')">
          <svg width="16" height="16" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.08 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.96 2.31-8.16 2.31-6.26 0-11.57-3.59-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Google
        </button>
        <button class="obtn" onclick="doOAuth('apple')">
          <svg width="15" height="16" viewBox="0 0 814 1000" xmlns="http://www.w3.org/2000/svg" fill="white">
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-43.4-150.3-109.7c-52.8-75.2-96.1-190.9-96.1-300.9 0-186.1 121.4-279.7 240.8-279.7 60.3 0 110.7 39.5 148.5 39.5 35.8 0 92.6-42.1 161.3-42.1 25.8 0 108.2 2.6 168.4 80.6zM554.1 131.8c26.2-31.6 44.9-76.1 44.9-120.6 0-6.4-.6-12.8-1.9-18 0-.6-.6-.6-.6-.6-45.5 1.9-99.5 30.3-131.8 63.9-24.5 27.7-47 72.8-47 118.3 0 7.1.6 14.1 1.3 16.4.6.6 1.3.6 1.9.6 40.4-.6 89.7-26.9 133.2-59.9z"/>
          </svg>
          Apple
        </button>
      </div>
      <div class="lg-ft"><span id="lg-ft-txt">Don't have an account? </span><span onclick="toggleMode()" id="lg-toggle">Sign Up</span></div>
    </div>
```

(Removed the "Remember me" checkbox — Supabase's client already persists and auto-refreshes sessions in `localStorage` on its own, so there's nothing left for that checkbox to control. Wrapped the leading text of `.lg-ft` in `<span id="lg-ft-txt">` so it can be swapped between sign-in/sign-up copy.)

- [ ] **Step 3: Replace the script block**

Find:
```html
<script>
  // ── Background rotation ──────────────────────────────────────────────
  const BG_IMAGES = [
    'backgrounds/Cypress+Point-0899.jpg',
    'backgrounds/rory-mcilroy.jpg',
    'backgrounds/4a49ca9fce73966e601e30975e681db2.webp',
    'backgrounds/burns-review.avif',
    'backgrounds/d53dc3a9-54ef-48d4-a41e-dbe11e89ba38_1140x641.jpg',
  ];
  (function rotateBg() {
    const key = 'tc_bg_index';
    const last = parseInt(localStorage.getItem(key) ?? '-1', 10);
    const next = (last + 1) % BG_IMAGES.length;
    localStorage.setItem(key, next);
    document.getElementById('lg-bg').style.backgroundImage = `url('${BG_IMAGES[next]}')`;
  })();

  // ── Auto-login ───────────────────────────────────────────────────────
  const emailEl = document.getElementById('lg-email');
  const passEl  = document.getElementById('lg-pass');
  const remEl   = document.getElementById('lg-rem');

  const saved = JSON.parse(localStorage.getItem('tc_autologin') || 'null');
  if (saved) {
    emailEl.value = saved.email;
    remEl.checked = true;
    if (saved.autoLogin) {
      navigate('home');
    }
  }

  function doSignIn() {
    const email = emailEl.value.trim();
    if (remEl.checked && email) {
      localStorage.setItem('tc_autologin', JSON.stringify({ email, autoLogin: true }));
    } else {
      localStorage.removeItem('tc_autologin');
    }
    navigate('home');
  }
</script>
```

Replace with:
```html
<script>
  // ── Background rotation ──────────────────────────────────────────────
  const BG_IMAGES = [
    'backgrounds/Cypress+Point-0899.jpg',
    'backgrounds/rory-mcilroy.jpg',
    'backgrounds/4a49ca9fce73966e601e30975e681db2.webp',
    'backgrounds/burns-review.avif',
    'backgrounds/d53dc3a9-54ef-48d4-a41e-dbe11e89ba38_1140x641.jpg',
  ];
  (function rotateBg() {
    const key = 'tc_bg_index';
    const last = parseInt(localStorage.getItem(key) ?? '-1', 10);
    const next = (last + 1) % BG_IMAGES.length;
    localStorage.setItem(key, next);
    document.getElementById('lg-bg').style.backgroundImage = `url('${BG_IMAGES[next]}')`;
  })();

  // ── Already signed in? Skip straight to home ──────────────────────────
  (async () => {
    const session = await TcAuth.getSession();
    if (session) navigate('home');
  })();

  // ── Sign in / Sign up ───────────────────────────────────────────────
  let mode = 'signin'; // 'signin' | 'signup'

  function toggleMode() {
    mode = mode === 'signin' ? 'signup' : 'signin';
    document.getElementById('lg-name').style.display = mode === 'signup' ? '' : 'none';
    document.getElementById('lg-signin').textContent = mode === 'signup' ? 'Sign Up' : 'Sign In';
    document.getElementById('lg-toggle').textContent = mode === 'signup' ? 'Sign In' : 'Sign Up';
    document.getElementById('lg-ft-txt').textContent = mode === 'signup' ? 'Already have an account? ' : "Don't have an account? ";
    hideError();
  }

  function showError(msg) {
    const el = document.getElementById('lg-err');
    el.textContent = msg;
    el.style.display = 'block';
  }
  function hideError() {
    document.getElementById('lg-err').style.display = 'none';
  }

  async function doSignIn() {
    hideError();
    const email = document.getElementById('lg-email').value.trim();
    const password = document.getElementById('lg-pass').value;
    const btn = document.getElementById('lg-signin');
    btn.disabled = true;
    try {
      if (mode === 'signup') {
        const name = document.getElementById('lg-name').value.trim();
        await TcAuth.signUp(email, password, name);
      } else {
        await TcAuth.signInWithPassword(email, password);
      }
      navigate('home');
    } catch (err) {
      showError(err.message || 'Something went wrong — try again.');
    } finally {
      btn.disabled = false;
    }
  }

  async function doOAuth(provider) {
    hideError();
    try {
      await TcAuth.signInWithOAuth(provider);
      // Browser will navigate away to the provider; nothing more to do here.
    } catch (err) {
      showError(err.message || (provider + ' sign-in isn\'t set up yet.'));
    }
  }
</script>
```

- [ ] **Step 4: Verify syntax**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('pages/login.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); console.log('block', i, 'OK'); } catch (e) { console.log('block', i, 'ERROR:', e.message); } });
"
```
Expected: `block 0 OK`.

- [ ] **Step 5: Manual browser verification — sign up**

Serve `pages/` locally (e.g. `python -m http.server 8931` from inside `pages/`), open `http://127.0.0.1:8931/login.html`, click "Sign Up", fill in a real name/email/password, submit.

Expected: no inline error, browser navigates to `home.html` (which at this point in the plan does not yet enforce `requireAuth()` — that's Task 4 — so it will load normally either way; the important check here is that sign-up succeeded without error).

- [ ] **Step 6: Manual browser verification — wrong password**

Go back to `login.html`, enter the email from Step 5 with a deliberately wrong password, click Sign In.

Expected: inline red error message appears (something like "Invalid login credentials"), no navigation happens, the Sign In button re-enables.

- [ ] **Step 7: Give the user the manual OAuth provider setup steps**

Tell the user (this only needs to happen once, not per test run):

> **To make Google sign-in work:**
> 1. In [Google Cloud Console](https://console.cloud.google.com), create or select a project.
> 2. APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type: Web application.
> 3. Add authorized redirect URI: `https://cfuxiifpvuzvysjxztax.supabase.co/auth/v1/callback`
> 4. Copy the generated Client ID and Client Secret.
> 5. In the Supabase dashboard → Authentication → Providers → Google: paste the Client ID + Secret, enable the provider.
>
> **To make Apple sign-in work** (requires an active Apple Developer Program membership, $99/year):
> 1. In the Apple Developer portal, ensure an App ID exists with "Sign in with Apple" capability enabled.
> 2. Create a Services ID (separate from the App ID) and configure its "Sign in with Apple" settings with your domain and the same callback URL as above.
> 3. Create a private key (Certificates, Identifiers & Profiles → Keys) with "Sign in with Apple" enabled; download the `.p8` file (only downloadable once — save it).
> 4. Note the Key ID, Team ID, and the Services ID (used as the Client ID).
> 5. In the Supabase dashboard → Authentication → Providers → Apple: enter the Services ID, Team ID, Key ID, and paste the private key contents.
>
> Until these are done, the Google/Apple buttons will show an inline error naming the unconfigured provider — that's expected, not a bug.

- [ ] **Step 8: Commit**

```bash
git add pages/login.html
git commit -m "feat: login.html — real Supabase sign-in, sign-up, and OAuth wiring"
```

---

### Task 4: Auth-gate every other page, wire real sign-out, full verification

**Files:**
- Modify: `pages/home.html`, `pages/rounds.html`, `pages/hole.html`, `pages/stats.html`, `pages/courses.html`, `pages/profile.html`, `pages/scorecard.html`, `pages/scanner.html`

**Interfaces:**
- Consumes: `TcAuth.requireAuth()` and `TcAuth.signOut()` from Task 1.

- [ ] **Step 1: Add the auth scripts to each of these 8 files**

In each of the following files, find the existing tag(s) shown and replace with the corresponding block (add the two new script tags immediately before the existing `tc-utils.js` tag; keep everything else on that line/area unchanged):

**`pages/rounds.html`** and **`pages/hole.html`** — find:
```html
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
```
Replace with:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js" integrity="sha384-3wY11tldQ5+yWqAvmTN4XtQvnjoTva0cV15O/O/O5NTtp0ivVopSzLOzsVXWZse9" crossorigin="anonymous"></script>
<script src="tc-auth.js"></script>
<script src="tc-course.js"></script>
<script src="tc-utils.js"></script>
```

**`pages/profile.html`**, **`pages/courses.html`**, **`pages/scanner.html`**, **`pages/home.html`**, **`pages/stats.html`** — find:
```html
<script src="tc-utils.js"></script>
```
Replace with:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js" integrity="sha384-3wY11tldQ5+yWqAvmTN4XtQvnjoTva0cV15O/O/O5NTtp0ivVopSzLOzsVXWZse9" crossorigin="anonymous"></script>
<script src="tc-auth.js"></script>
<script src="tc-utils.js"></script>
```

**`pages/scorecard.html`** — this page currently loads no external scripts at all (it's a standalone printable page). Find:
```html
<script>
function setMode(n) {
```
Replace with:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js" integrity="sha384-3wY11tldQ5+yWqAvmTN4XtQvnjoTva0cV15O/O/O5NTtp0ivVopSzLOzsVXWZse9" crossorigin="anonymous"></script>
<script src="tc-auth.js"></script>
<script>
function setMode(n) {
```

- [ ] **Step 2: Add the `requireAuth()` guard as the first statement in each page's own script block**

In each of the 8 files above, locate that page's own `<script>` tag — the one with no `src` attribute, containing that page's actual logic (distinct from the utility `<script src="...">` tags you just added/already had). Insert this as the very first line inside it, before any other code in that block:

```js
(async () => { await TcAuth.requireAuth(); })();
```

For `pages/scorecard.html` specifically, insert it as the first line of the existing `<script>` block (right after the `function setMode(n) {` line's enclosing tag — i.e. before `function setMode(n) {` itself, as the first statement of the script, not inside the function):

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js" integrity="sha384-3wY11tldQ5+yWqAvmTN4XtQvnjoTva0cV15O/O/O5NTtp0ivVopSzLOzsVXWZse9" crossorigin="anonymous"></script>
<script src="tc-auth.js"></script>
<script>
(async () => { await TcAuth.requireAuth(); })();

function setMode(n) {
```

- [ ] **Step 3: Verify syntax on all 8 files**

```bash
node -e "
const fs = require('fs');
const files = ['home.html','rounds.html','hole.html','stats.html','courses.html','profile.html','scorecard.html','scanner.html'];
let allOk = true;
for (const f of files) {
  const html = fs.readFileSync('pages/' + f, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  scripts.forEach((s, i) => {
    try { new Function(s); }
    catch (e) { allOk = false; console.log(f, 'block', i, 'ERROR:', e.message); }
  });
}
console.log(allOk ? 'ALL OK' : 'FAILURES FOUND');
"
```
Expected: `ALL OK`.

- [ ] **Step 4: Wire real sign-out in `pages/profile.html`**

Find the profile page's existing sign-out button/element (search for the word "Sign Out" or "sign-out" in `pages/profile.html` to locate its exact current `onclick` handler — it currently does not call any real function). Replace whatever it currently calls with:

```js
async function doSignOut() {
  await TcAuth.signOut();
  navigate('login');
}
```

and point that button's `onclick` at `doSignOut()`.

- [ ] **Step 5: Full end-to-end manual browser verification**

With `pages/` served locally:

1. Open `home.html` directly (not via login) → confirm it redirects to `login.html` (proves `requireAuth()` works when logged out).
2. Sign in with the email/password created in Task 3 Step 5 → confirm landing on `home.html` and the page loads normally (not bounced back to login).
3. Navigate to `rounds.html`, `stats.html`, `courses.html`, `profile.html` directly by URL → confirm each loads normally (session persists across pages).
4. On `profile.html`, trigger sign-out → confirm redirect to `login.html`.
5. Immediately try to open `home.html` directly again → confirm it redirects back to `login.html` (session was actually cleared, not just a UI-only sign-out).
6. Sign back in → confirm success.
7. In the Supabase dashboard's Table Editor, open the `profiles` table → confirm a row exists for the test user with the correct `email` and `display_name` (proves the Task 2 trigger fired correctly on sign-up).

- [ ] **Step 6: Commit**

```bash
git add pages/home.html pages/rounds.html pages/hole.html pages/stats.html pages/courses.html pages/profile.html pages/scorecard.html pages/scanner.html
git commit -m "feat: auth-gate every page with TcAuth.requireAuth(), wire real sign-out in profile.html"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Supabase client init from CDN, no build step | Task 1 |
| `TcAuth` API surface (signUp/signInWithPassword/signInWithOAuth/signOut/getSession/requireAuth) | Task 1 |
| `requireAuth()` redirects to `login.html`, called explicitly per protected page | Task 4 |
| `profiles` table + RLS + auto-create trigger | Task 2 |
| `login.html` real sign-in | Task 3 |
| `login.html` real sign-up (was just a text link) | Task 3 |
| `login.html` Google/Apple buttons call `signInWithOAuth` | Task 3 |
| Remove fake `tc_autologin` localStorage logic | Task 3 |
| OAuth redirect target = home.html regardless of initiating page | Task 1 (`homeUrl()`) |
| Inline error display, Supabase error message shown as-is | Task 3 |
| Manual Google/Apple provider setup steps communicated to user | Task 3 Step 7 |
| Every other page auth-gated | Task 4 |
| `profile.html` real sign-out | Task 4 |
| End-to-end verification matching spec §7 scenarios | Task 4 Step 5
