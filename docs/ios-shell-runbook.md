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
