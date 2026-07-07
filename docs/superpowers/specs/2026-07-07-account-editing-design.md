# Account Editing — Design Spec

## Context

Tour Caddie is a plain HTML/JS/CSS prototype backed by a real Supabase project. `pages/profile.html`'s Account sub-screen has three rows — Display Name, Email, Password — that are currently pure UI decoration: each tap shows a `showToast(..., '... — coming soon')` and nothing else. Display Name and Email are already *read* correctly (wired up as part of the [[golf-settings-persistence]] sub-project's de-mock cleanup — they show the real `profiles.display_name` and `session.user.email`), but neither is *writable* yet, and Password has no backend wiring at all.

## Scope

**In scope:**
- Display Name: editable, writes to `profiles.display_name`.
- Password: editable, requires re-entering the current password, writes via Supabase Auth.
- Email: editable, requires re-entering the current password, writes via Supabase Auth's email-change flow (confirmation-link based, not instant).

**Out of scope:**
- Keeping `profiles.email` in sync with Auth email changes — it's a legacy signup-time snapshot nothing currently reads (the Account screen displays `session.user.email` directly), so leaving it unsynced avoids needing a webhook/Auth hook for no functional benefit.
- Avatar upload/editing (no such feature exists today; `profiles.avatar_url` is untouched).
- Any change to how OAuth-based accounts (Google/Apple, not yet live per [[auth-forward-risks-for-persistence]]) would handle these same fields — this app currently only has email/password signup live.

## Architecture

**UI pattern:** each row's tap opens a `.sheet-ov`/`.sheet` overlay — the exact same overlay component already used for the Tee/Home Course/Add Friend sheets in this same file — instead of the current toast. Text inputs reuse the existing global `.lg-inp` style (already used in the Add Friend sheet).

**Display Name sheet:** one `.lg-inp`, pre-filled with the current name. On Save: `TcAuth.client.from('profiles').update({ display_name }).eq('id', session.user.id)`. On success, patches `acct-name-val`, `pf-name`, and `pf-avatar` (re-derived initials) in place — no reload needed, matching every other setting in this app.

**Password sheet:** three fields (current password, new password, confirm). Client-side check that new/confirm match before submitting. Re-authenticates by calling `TcAuth.signInWithPassword(session.user.email, currentPassword)` first — if that fails, the current password was wrong, shown as a sheet-local error, nothing else happens. Only on success does it call `client.auth.updateUser({ password: newPassword })`. Supabase's own password-strength rule is not duplicated client-side; whatever error it returns (e.g. "Password should be at least 6 characters") surfaces directly in the sheet.

**Email sheet:** two fields (new email, current password) — the same current-password re-auth step as Password, confirmed by you as the uniform policy for both sensitive fields. On success, calls `client.auth.updateUser({ email: newEmail })`, which triggers Supabase's own confirmation-link email — the change does **not** take effect immediately. The sheet replaces its form with a "Check your email to confirm this change" message rather than claiming success. The displayed email row keeps showing the *old* address until the golfer actually clicks the confirmation link in their inbox; the next time the app fetches a session after that, `session.user.email` already reflects the new value automatically (no separate sync code needed).

## Error handling

- **Wrong current password** (Password or Email sheet): re-auth via `signInWithPassword` fails → sheet-local error message ("Current password is incorrect"), nothing is changed, no request to `updateUser` is made.
- **New/confirm mismatch** (Password sheet): caught client-side before any network call, sheet-local error.
- **Supabase rejects the new password/email** (e.g. too short, already in use): the exact error message from `updateUser`'s response is shown in the sheet — not a generic failure message.
- **Network/unexpected failure on any of the three saves**: shows the existing app-wide error toast (`showToast('toast', 'Failed to save — try again')`), matching how every other settings save in this app already handles failure — the sheet stays open with the user's input intact rather than silently closing.

## Testing / verification

Manual, end-to-end, no automated suite (consistent with the rest of this codebase):
1. Change Display Name → confirm `profiles.display_name` updates in the Supabase Table Editor, and the new name appears immediately in both the Account row and the profile header (no reload).
2. Attempt a Password change with the wrong current password → confirm it's rejected before any real change is attempted.
3. Complete a real Password change with the correct current password → sign out, confirm the new password logs in and the old one doesn't.
4. Attempt an Email change → confirm the sheet shows the "check your email" message, confirm the Account screen still shows the *old* email until the confirmation link is clicked, then confirm it shows the new one on the next load after confirming.
5. Confirm a too-short new password (or any other Supabase-rejected input) surfaces Supabase's own error text in the sheet, not a generic failure.
