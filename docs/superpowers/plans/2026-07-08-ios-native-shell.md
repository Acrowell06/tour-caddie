# iOS Native Shell (Capacitor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing Tour Caddie web app (plain HTML/JS, no build step) as a real installable iOS app via Capacitor, with zero changes to how GPS/camera work today, and hand off a clear runbook for the macOS-only steps that can't be done or verified from this (Windows) session.

**Architecture:** Capacitor points its `webDir` directly at the existing `pages/` directory — no bundler, no build step, no copying. A `package.json` and `capacitor.config.json` at the repo root configure the wrap; a new `pages/index.html` gives the WebView a default document (today the app's real entry point is `login.html`, reached with no `index.html` at all). Everything from `npx cap add ios` onward requires macOS (Capacitor's own docs: "To build iOS applications with Capacitor, you need macOS") and is documented as a runbook rather than executed here.

**Tech Stack:** Capacitor 8 (current, defaults to Swift Package Manager over CocoaPods, requires Xcode 26.0+ and Node 22+), plain HTML/JS/Supabase web app (unchanged).

## Global Constraints

- Platform: iOS only, not Android — confirmed during brainstorming.
- Package manager: Swift Package Manager (SPM), Capacitor 8's default — no CocoaPods/Homebrew dependency needed.
- Scope: minimal wrap only — no changes to `navigator.geolocation` or camera file-input usage anywhere in `pages/*.html`. Native Geolocation/Camera plugin upgrades are explicitly out of scope for this plan.
- `appId`: `com.tourcaddie.app` (placeholder, confirmed acceptable to change before any real App Store submission).
- `appName`: `Tour Caddie`.
- `webDir`: `pages` (the existing directory, as-is).
- No build step is introduced. This app has never had one and doesn't need one to be wrapped.
- The app icon is already finalized at `assets/icon-only.png` (1024×1024 PNG, no further design work needed).
- Everything from `npx cap add ios` onward is macOS-only and cannot be executed or verified in this session — it is documented as a runbook, not implemented as a testable task.

---

### Task 1: Capacitor project configuration (Windows-side, testable here)

**Files:**
- Create: `package.json`
- Create: `capacitor.config.json`
- Create: `pages/index.html`
- Modify: `.gitignore` (add Xcode/iOS-project noise patterns, proactively, so the first `git status` after `cap add ios` on the Mac is already clean)

**Interfaces:**
- Consumes: `assets/icon-only.png` (already exists, finalized — this task does not touch it).
- Produces: a working `npm install`-able project with Capacitor core + iOS package declared as dependencies, a valid `capacitor.config.json` pointing at `pages`, and a real default document (`pages/index.html`) that the Mac-side `npx cap add ios` step (Task 2) will need.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "tour-caddie",
  "version": "1.0.0",
  "private": true,
  "description": "Tour Caddie — golf round tracking app",
  "dependencies": {
    "@capacitor/core": "^8.0.0",
    "@capacitor/ios": "^8.0.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^8.0.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

Expected: completes without error, creates `node_modules/` (already gitignored — confirmed present in `.gitignore` from earlier work this session) and `package-lock.json`.

Then add `@capacitor/assets` (the icon/splash generator used in Task 2) the same way Capacitor's own docs install it — via `npm install`, not a hand-guessed version number, so npm resolves and records whatever the actual current version is:

```bash
npm install @capacitor/assets --save-dev
```

- [ ] **Step 3: Create `capacitor.config.json`**

```json
{
  "appId": "com.tourcaddie.app",
  "appName": "Tour Caddie",
  "webDir": "pages"
}
```

- [ ] **Step 4: Create `pages/index.html`**

The app's real entry point today is `pages/login.html` (every other page's `navigate()` call in `tc-utils.js` reads from a `PAGES` map that assumes you're already past this point). Capacitor's WebView needs a default document at `webDir`'s root, which doesn't exist yet. This redirects immediately, changing nothing about the existing auth/navigation logic.

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Tour Caddie</title>
<script>location.replace('login.html');</script>
</head>
<body></body>
</html>
```

`location.replace` (not setting `location.href`) is used deliberately so this redirect doesn't leave a back-button history entry — a user who taps "back" from `login.html` should not land on a blank redirect page.

- [ ] **Step 5: Add iOS/Xcode noise patterns to `.gitignore`**

Once `npx cap add ios` runs (Task 2, on the Mac), it generates a real Xcode project that should be committed — but Xcode itself generates a lot of per-machine noise inside that project that should not be. Adding this now means the first `git status` after that step is already clean.

Find the current `.gitignore` (already has `.playwright-mcp/`, `node_modules/`, `.superpowers/` from earlier work this session) and append:

```gitignore

# Xcode / iOS (generated once `ios/` exists, added via a future `npx cap add ios` on macOS)
ios/App/Pods/
**/xcuserdata/
*.xcuserstate
DerivedData/
```

- [ ] **Step 6: Verify `index.html` actually redirects, served the same way this app is normally tested**

```bash
cd pages && python -m http.server 8420 --bind 127.0.0.1
```

In a separate terminal (or via `curl`, since this only needs to confirm the redirect script is present and correct — not exercise a real browser):

```bash
curl -s http://127.0.0.1:8420/ | grep "location.replace"
```

Expected output: the exact line `<script>location.replace('login.html');</script>`, confirming the root document serves the redirect script. Stop the server afterward.

- [ ] **Step 7: Validate both JSON config files parse correctly**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK');"
node -e "JSON.parse(require('fs').readFileSync('capacitor.config.json','utf8')); console.log('capacitor.config.json OK');"
```

Expected: both print `OK`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json capacitor.config.json pages/index.html .gitignore
git commit -m "feat: add Capacitor project configuration for iOS wrap"
```

---

### Task 2: macOS runbook — everything Windows can't do

**Files:**
- Create: `docs/ios-shell-runbook.md`

**Interfaces:**
- Consumes: the `package.json`/`capacitor.config.json`/`pages/index.html` from Task 1 (referenced by exact filename in the runbook's prerequisites), `assets/icon-only.png` (referenced as the icon source).
- Produces: nothing consumed by a later task — this is the terminal deliverable of this plan. Execution and verification happens entirely outside this session, on the user's Mac.

- [ ] **Step 1: Write the runbook**

Create `docs/ios-shell-runbook.md` with this exact content:

````markdown
# iOS Native Shell — macOS Runbook

Everything in this document runs on macOS, not the Windows machine this
repo was configured on. Capacitor's own requirement: "To build iOS
applications with Capacitor, you need macOS."

## Prerequisites

- **macOS** with **Xcode 26.0+** installed from the App Store (Capacitor 8's
  minimum). Confirm with `xcodebuild -version`.
- **Xcode Command Line Tools**: `xcode-select --install`
- **Node.js 22+**: confirm with `node --version`. Install via the
  [official installer](https://nodejs.org), Homebrew (`brew install node`),
  or a version manager (Volta, nvm) if you don't have it.
- A clone of this repo, on this Mac, with Task 1 of
  `docs/superpowers/plans/2026-07-08-ios-native-shell.md` already merged
  (i.e. `package.json`, `capacitor.config.json`, and `pages/index.html`
  should already exist).
- An **Apple ID** enrolled in the (free tier is fine for local
  device/simulator testing — a paid Apple Developer Program membership is
  only needed for App Store submission, which is out of scope here).

## 1. Install dependencies

From the repo root:

```bash
npm install
```

## 2. Add the iOS platform

Capacitor 8 defaults to Swift Package Manager (SPM) — no extra flag needed,
no CocoaPods/Homebrew dependency required:

```bash
npx cap add ios
```

This generates a real Xcode project at `ios/App/`. Commit it once it
exists and looks right — Capacitor's own convention is to check the native
platform folders into version control (they can contain project-specific
native configuration, not just disposable build cache):

```bash
git add ios/
git commit -m "chore: add generated iOS platform project"
```

## 3. Generate app icons from the finalized source image

The app icon is already finalized at `assets/icon-only.png` (1024×1024).
Generate every iOS size Xcode needs from it:

```bash
npx capacitor-assets generate --ios
```

## 4. Sync the web app into the native project

Whenever `pages/` changes, re-run this to copy the latest web assets into
the native project (not needed the very first time if `cap add ios` just
ran, but it's harmless to run anyway):

```bash
npx cap sync ios
```

## 5. Open the project in Xcode

```bash
npx cap open ios
```

This opens `ios/App/App.xcworkspace` (or `.xcodeproj`, depending on the
exact Capacitor 8 SPM layout) in Xcode.

## 6. Configure signing

In Xcode:
1. Select the `App` target in the project navigator.
2. Go to the **Signing & Capabilities** tab.
3. Under **Team**, select your Apple ID / development team (add your Apple
   ID under Xcode → Settings → Accounts first, if you haven't already).
4. Xcode should auto-generate a development provisioning profile once a
   team is selected — confirm there's no red error banner in this tab
   before continuing.

## 7. Build and run

- **Simulator**: select any iPhone simulator from the device dropdown in
  Xcode's toolbar, then press the Run button (▶) or `Cmd+R`.
- **Real device**: connect your iPhone via USB (or over the network, once
  paired), select it from the device dropdown, then Run. The first time,
  your iPhone will ask you to trust the developer certificate — go to
  **Settings → General → VPN & Device Management** on the phone and trust
  it there if the app doesn't launch immediately.

## What to verify once it's running

This is the actual test — nothing before this point in the whole
iOS-native-shell project has been able to confirm the app really works as
a native app:

- [ ] The app launches directly into the sign-in screen (confirms the
      `pages/index.html` → `login.html` redirect works inside a real
      WebView, not just a browser).
- [ ] Sign in, and confirm the rest of the app navigates normally
      (Home → Rounds → starting a round, etc.).
- [ ] Start a round and confirm GPS shot-marking on `hole.html` works —
      this exercises `navigator.geolocation` inside Capacitor's WebView,
      which this project deliberately left untouched rather than
      upgrading to a native plugin.
- [ ] Try the scorecard scan feature (`scan-scorecard.html`) and confirm
      the camera/photo-library file input still works — same reasoning,
      this also deliberately still uses the plain web file-input API.
- [ ] Confirm the app icon shows correctly on the home screen (the trophy
      icon from `assets/icon-only.png`, not a default placeholder).

If GPS or camera don't work as expected inside the native WebView (some
iOS versions are stricter about permissions prompts for a wrapped app than
a plain mobile Safari tab), that's the signal to scope a follow-up
sub-project for upgrading to Capacitor's native Geolocation/Camera plugins
— deliberately deferred out of this first pass, not something to
troubleshoot inside this runbook.
````

- [ ] **Step 2: Commit**

```bash
git add docs/ios-shell-runbook.md
git commit -m "docs: macOS runbook for completing the iOS Capacitor wrap"
```
