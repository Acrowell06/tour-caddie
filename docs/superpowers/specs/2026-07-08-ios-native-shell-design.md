# iOS Native Shell (Capacitor) — Minimal Wrap

## Context

Tour Caddie is a plain HTML/JS/Supabase web app (no build step, no framework, no bundler — see [[project-stack]]). On 2026-07-01 the user decided this web app is the real product going forward, packaged as "a wrapped native shell (Capacitor/Cordova/Tauri)... not a plain website and not Swift/Xcode" — but that decision left the specific wrapping technology, target platform, and scope unresolved. This spec resolves all three for the first pass.

Today the app has no `index.html` — its real entry point is `login.html` (referenced directly, e.g. `pages/login.html`), reached via a `PAGES`/`ORDER` map in `tc-utils.js` that every other page's `navigate()` call reads from. `TcAuth.requireAuth()` (called at the top of every protected page) already handles bouncing an unauthenticated visitor to `login.html`, so nothing about the existing auth-gate logic needs to change for this work.

## Decisions

- **Platform: iOS only**, not Android, not both. The user has (or will get) Mac access for the Xcode-only steps this requires — no cloud Mac CI service is being used.
- **Wrapping technology: Capacitor** (not Tauri — mobile support there is newer/less mature and Rust-centric; not Cordova — Capacitor is its actively-maintained successor). Capacitor is purpose-built for exactly this: wrapping an existing web app's static assets into a native WKWebView-based iOS app with minimal rework.
- **Package manager: Swift Package Manager (SPM)**, Capacitor 8's default (Capacitor 8 requires Xcode 26.0+). CocoaPods remains available as an opt-in flag but isn't needed here — SPM avoids a Ruby/Homebrew dependency and is Capacitor's own recommendation when there's no specific reason to need CocoaPods, which there isn't for a fresh wrap with no existing native plugins.
- **Scope: minimal wrap only.** Get the existing web app installable as a real iOS app end-to-end (icon, splash screen, signed build running on a device/simulator) with **zero changes** to how GPS (`navigator.geolocation`) or camera (file-input `capture` attributes, used by the scorecard scan and post-round scanner features) work today — both already function inside a standard WKWebView without native plugins. Upgrading either to Capacitor's native Geolocation/Camera plugins is explicitly deferred to a future sub-project.
- **Bundle ID:** `com.tourcaddie.app` (placeholder — the user confirmed this is fine to change later, before any real App Store submission, since it's only permanent once actually submitted).
- **App icon/splash source:** user-provided logo image (not yet placed in the repo — required as an input before the icon-staging task can run).
- **`webDir: "pages"`** — Capacitor points directly at the existing `pages/` directory as-is. No build/bundle step is introduced; this app has never had one and doesn't need one to be wrapped.
- **New `pages/index.html`** — a minimal redirect to `login.html`, since Capacitor's WebView needs a default document and none exists today. This is the only change to the existing web app's file set; no existing page's logic changes.

## Architecture — the Windows/Mac split

This is the one structural fact that shapes how this sub-project's tasks are organized, because it's the first sub-project in this repo's history where **not everything can be implemented and verified in this (Windows) session**:

**Windows-side (implementable and verifiable here, via the normal subagent-driven-development process):**
- `package.json` at the repo root, with `@capacitor/core`, `@capacitor/cli`, and `@capacitor/ios` as dependencies (the `@capacitor/ios` *package* installs fine via npm on any OS — only *adding the native iOS platform* with it requires macOS, per Capacitor's own docs: "To build iOS applications with Capacitor, you need macOS").
- `capacitor.config.json` (or `.ts`) — `appId: "com.tourcaddie.app"`, `appName: "Tour Caddie"`, `webDir: "pages"`.
- `pages/index.html` — redirect to `login.html`.
- An `assets/` folder staging the user's provided icon in the filename Capacitor's asset generator (`@capacitor/assets`) expects (`icon-only.png`, plus a splash image if provided) — this tool itself runs fine on any OS with Node, but the actual `--ios` generation target only exists once the native `ios/` project has been created, so generation itself happens on the Mac (see below).
- A written runbook (`docs/ios-shell-runbook.md` or similar) covering every remaining step in order, referencing exact current Capacitor CLI commands.

**Mac-side (documented as a runbook, executed and verified by the user — not something a subagent in this session can run or check):**
- Confirm Xcode 26.0+ and Command Line Tools installed.
- `npx cap add ios` (SPM is Capacitor 8's default package manager, no extra flag needed).
- `npx capacitor-assets generate --ios` (generates all required icon/splash sizes into the now-existing `ios/` project from the staged source image).
- `npx cap sync ios`.
- `npx cap open ios` → configure a signing team in Xcode → build and run on a simulator or a real device.

The native `ios/` directory Capacitor generates gets committed to git once created (Capacitor's own convention — it can contain project-specific native configuration, not just disposable cache), but that commit happens on the Mac, as part of the runbook, not in this session.

## Testing

- **Windows-side:** config files are validated for correctness — valid JSON, `webDir` actually resolving to the real `pages/` directory, and the `index.html` redirect confirmed working via the same local static-file-server approach already used earlier in this project (serve `pages/`, load `/`, confirm it lands on `login.html`).
- **Mac-side:** no automated verification is possible from this session. The runbook itself is the deliverable; running it and confirming a real, signed build launches on a simulator or device is something only the user can do, on their own Mac, after this sub-project's Windows-side work is merged.

## Out of scope

- Android (a separate future sub-project if ever wanted).
- Native Geolocation/Camera plugin upgrades (deferred — the web APIs already work in a WKWebView).
- Push notifications.
- App Store / TestFlight submission and associated metadata/screenshots.
- Any cloud Mac CI/build service (Codemagic, GitHub Actions macOS runners, etc.) — the user has direct Mac access instead.
