# Real Authentication — Design Spec
**Date:** 2026-07-01
**Status:** Approved

---

## Overview

This is sub-project 1 of the post-pivot rebuild (see `docs/superpowers/plans/` weather/manual-marking specs for prior context, and project memory `project-stack.md` for the pivot itself: on 2026-07-01 the plan changed from a native Swift/SwiftUI rewrite to shipping this HTML/JS/CSS codebase as the real product, wrapped later via Capacitor — not this spec's concern). Everything else planned (persistence, handicap engine, Strokes Gained, group scoring) depends on having real signed-in users to attach data to. This spec covers only: a real Supabase backend connection, real email/password + Google + Apple sign-in, session persistence, and gating the rest of the app behind a logged-in session.

**Explicitly out of scope for this spec:** saving rounds/shots/settings to the backend (sub-project 2), any handicap/SG calculation, group/match-play accounts, the Capacitor wrapper.

---

## 1. Backend

Supabase project already created by the user. Connection details (project URL + anon/publishable key) are supplied directly rather than through the Supabase MCP connector, since this session cannot complete the MCP OAuth flow.

- Project URL: `https://cfuxiifpvuzvysjxztax.supabase.co`
- Anon/publishable key: supplied by user (starts `sb_publishable_...`) — safe to embed in client-side code; Supabase's security model relies on Row Level Security policies, not key secrecy.

---

## 2. `pages/tc-auth.js` — shared auth module

New file, same pattern as the existing `tc-course.js`/`tc-utils.js` (plain `<script>` tag, no build step, exposes a global). Loads the Supabase JS client from its UMD CDN build (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js`, which exposes `window.supabase.createClient(...)` — not to be confused with this file's own exported global, which will be named `TcAuth` to avoid collision), then wraps it:

```js
window.TcAuth = (() => {
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function signUp(email, password, displayName) { ... }
  async function signInWithPassword(email, password) { ... }
  async function signInWithOAuth(provider) { ... } // provider: 'google' | 'apple'; passes { options: { redirectTo: location.origin + location.pathname.replace(/[^/]+$/, 'home.html') } } so the provider round-trip lands back on home.html regardless of which page's login form initiated it
  async function signOut() { ... }
  async function getSession() { ... } // returns current session or null
  async function requireAuth() { ... } // redirects to login.html if no session; call at top of every protected page

  return { client, signUp, signInWithPassword, signInWithOAuth, signOut, getSession, requireAuth };
})();
```

`requireAuth()` is called explicitly at the top of every protected page's own script (not silently baked into `tc-utils.js`), matching this codebase's existing convention of explicit per-page init logic. It is **not** called on `login.html` itself (that page instead redirects *to* `home.html` if a session already exists, mirroring the current auto-login mockup behavior).

---

## 3. Data model

One new table, created via Supabase migration:

```sql
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

-- Auto-create a profile row whenever a new user signs up.
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

This is intentionally minimal — just enough for the profile row to exist. Settings, handicap index, round history, etc. are sub-project 2.

---

## 4. UI changes

**`login.html`:**
- `doSignIn()` calls `TcAuth.signInWithPassword(email, password)` instead of writing to `localStorage`. On success, navigate to `home.html`. On failure, show the error inline (reuse existing `.lg-*` styling — no new error-display component needed, just a text node under the password field).
- The Google/Apple buttons call `TcAuth.signInWithOAuth('google')` / `TcAuth.signInWithOAuth('apple')` instead of `navigate('home')`. These will not work until the user completes the manual provider setup below.
- The "Sign Up" link becomes a real toggle to a sign-up form (email, password, display name) that calls `TcAuth.signUp(...)`. Reuse the existing `.lg-form`/`.lg-inp` styling — this is a form-fields swap, not a new screen.
- Remove the fake `tc_autologin` localStorage logic entirely — Supabase's client already persists and auto-refreshes sessions in `localStorage` on its own.

**Every other page** (`home.html`, `rounds.html`, `hole.html`, `stats.html`, `courses.html`, `profile.html`, `scorecard.html`, `scanner.html`): add `<script src="tc-auth.js"></script>` before `tc-utils.js`, and call `TcAuth.requireAuth()` near the top of each page's own script block.

**`profile.html`:** wire the existing (currently non-functional) sign-out affordance to `TcAuth.signOut()`, then redirect to `login.html`.

---

## 5. Manual prerequisites (cannot be done by the agent)

**Google sign-in** — requires a Google Cloud OAuth client:
1. In [Google Cloud Console](https://console.cloud.google.com), create or select a project.
2. APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type: Web application.
3. Add authorized redirect URI: `https://cfuxiifpvuzvysjxztax.supabase.co/auth/v1/callback` (Supabase's dashboard shows this exact URL on the Google provider config page too).
4. Copy the generated Client ID and Client Secret.
5. In the Supabase dashboard → Authentication → Providers → Google: paste the Client ID + Secret, enable the provider.

**Apple sign-in** — requires an active Apple Developer Program membership ($99/year):
1. In the Apple Developer portal, ensure an App ID exists with "Sign in with Apple" capability enabled.
2. Create a Services ID (separate from the App ID — this is the one used for web/OAuth) and configure its "Sign in with Apple" settings with your domain and the same Supabase callback URL as above.
3. Create a private key (Certificates, Identifiers & Profiles → Keys) with "Sign in with Apple" enabled; download the `.p8` file (only downloadable once — save it).
4. Note the Key ID, Team ID, and the Services ID (used as the Client ID).
5. In the Supabase dashboard → Authentication → Providers → Apple: enter the Services ID, Team ID, Key ID, and paste the private key contents.

(Exact menu labels in Google Cloud Console / Apple Developer portal / Supabase's dashboard may shift slightly over time — the overall flow above is stable.)

Email/password sign-in requires no external setup and will work as soon as this spec is implemented.

---

## 6. Error handling

- Network/Supabase-unreachable errors on sign-in/sign-up: show a generic "Couldn't connect — check your connection and try again" inline message (don't leak raw error text from the client).
- Wrong password / unknown email: Supabase returns a generic "Invalid login credentials" error by design (doesn't reveal which field was wrong) — display it as-is.
- `requireAuth()` failing (no session): redirect to `login.html`, no error message needed (this is the expected logged-out state, not a failure).
- OAuth provider not yet configured (Google/Apple before manual setup is done): Supabase returns an error naming the misconfigured provider — surface it as-is so it's obvious setup isn't complete yet, rather than masking it.

---

## 7. Verification

Manual browser walkthrough (this codebase has no automated test suite):
1. Sign up with a new email/password → confirm a session is created, a `profiles` row exists for that user (check via Supabase dashboard's Table Editor), and the app lands on `home.html`.
2. Sign out from `profile.html` → confirm redirect to `login.html` and that visiting `home.html` directly now redirects back to `login.html` (via `requireAuth()`).
3. Sign back in with the same email/password → confirm success and landing on `home.html`.
4. Attempt sign-in with a wrong password → confirm the inline error shows, no navigation happens.
5. Google/Apple buttons: confirm they attempt the OAuth flow (will fail with a provider-not-configured error until the manual setup above is done — that failure itself is the expected/correct behavior pre-setup).
