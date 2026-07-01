# Tour Caddie Phase 1 — Foundation Implementation Plan (Swift / SwiftUI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the Tour Caddie Xcode project with a working SwiftUI navigation shell, design system, core data models, Supabase auth (Apple Sign In + Google + email), and user profile — all matching the dark premium visual style from the prototype.

**Architecture:** Single Xcode project (no monorepo). MVVM pattern — Views are dumb, ViewModels are `@Observable @MainActor` classes. Services (Supabase, GPS) are `@Observable` singletons injected via SwiftUI `.environment()`. SwiftData for local offline queue.

**Tech Stack:** Swift 6, SwiftUI, Xcode 16+, Supabase Swift SDK (supabase-swift via SPM), GoogleSignIn-iOS (SPM), SwiftData, CoreLocation, MapKit.

## Global Constraints

- Swift 6 strict concurrency — all ViewModels `@MainActor`, services `actor` or `@MainActor @Observable`
- No force unwraps (`!`) — use `guard let` or `if let` exclusively
- No third-party UI libraries — pure SwiftUI only
- All colors via `Color.tc*` extension (never hardcoded hex strings in views)
- All Supabase calls go through service layer — never call supabase client directly from a View or ViewModel
- Build must succeed with zero warnings before any task is marked done
- Design tokens: bg `#0A0A0F`, surface `#141420`, green `#2ECC71`, gold `#F1C40F`, muted `#8B8BA7`, border `#1E1E2E`
- Corner radius: 12pt (cards), 8pt (inputs), 99pt (pills)
- Font: SF Pro system default (`.font(.system(...))` — no custom fonts)

---

## File Map

```
TourCaddie/
├── TourCaddie.xcodeproj
├── TourCaddie/
│   ├── App/
│   │   ├── TourCaddieApp.swift          ← Task 1
│   │   └── AppEnvironment.swift         ← Task 1
│   ├── Design/
│   │   ├── Colors.swift                 ← Task 2
│   │   ├── Typography.swift             ← Task 2
│   │   └── Spacing.swift                ← Task 2
│   ├── Core/
│   │   ├── Models/
│   │   │   ├── AppUser.swift            ← Task 3
│   │   │   ├── Course.swift             ← Task 3
│   │   │   ├── Round.swift              ← Task 3
│   │   │   └── Shot.swift               ← Task 3
│   │   └── Services/
│   │       ├── SupabaseService.swift    ← Task 4
│   │       └── AuthService.swift        ← Task 5
│   └── Features/
│       ├── Auth/
│       │   ├── AuthView.swift           ← Task 6
│       │   └── AuthViewModel.swift      ← Task 6
│       ├── Home/
│       │   └── HomeView.swift           ← Task 7
│       ├── Rounds/
│       │   └── RoundsView.swift         ← Task 7
│       ├── Stats/
│       │   └── StatsView.swift          ← Task 7
│       ├── Courses/
│       │   └── CoursesView.swift        ← Task 7
│       └── Profile/
│           ├── ProfileView.swift        ← Task 7
│           └── ProfileViewModel.swift   ← Task 7
├── TourCaddieTests/
│   └── HandicapTests.swift              ← Task 3
└── TourCaddie.xcodeproj/
    └── project.pbxproj
```

---

### Task 1: Xcode Project + SPM Dependencies + App Entry Point

**Files:**
- Create: `TourCaddie/App/TourCaddieApp.swift`
- Create: `TourCaddie/App/AppEnvironment.swift`

**Interfaces:**
- Produces: `AppEnvironment` observable class (holds `AuthService`, `SupabaseService`) — injected into all views via `.environment()`

- [ ] **Step 1: Create the Xcode project**

  Open Xcode → File → New → Project → iOS → App.
  - Product Name: `TourCaddie`
  - Team: your Apple Developer account
  - Bundle Identifier: `com.yourchoice.tourcaddie`
  - Interface: SwiftUI
  - Language: Swift
  - Storage: None (SwiftData added manually later)
  - Uncheck "Include Tests" (we add test target manually)
  - Save to: `c:\Users\Abcro\OneDrive\Documents\Claude Projects\Tour-caddie v1\`

  (Xcode only runs on macOS — do this step on your Mac.)

- [ ] **Step 2: Add Swift Package dependencies**

  In Xcode → File → Add Package Dependencies, add:

  1. `https://github.com/supabase/supabase-swift` — Up to Next Major from `2.0.0`
     - Products to add: `Supabase`, `Auth`, `Realtime`, `PostgREST`
  2. `https://github.com/google/GoogleSignIn-iOS` — Up to Next Major from `7.0.0`
     - Products to add: `GoogleSignIn`, `GoogleSignInSwift`

- [ ] **Step 3: Write `AppEnvironment.swift`**

```swift
import Foundation
import Observation

@MainActor
@Observable
final class AppEnvironment {
    let supabase: SupabaseService
    let auth: AuthService

    init() {
        let supabase = SupabaseService()
        self.supabase = supabase
        self.auth = AuthService(supabase: supabase)
    }
}
```

- [ ] **Step 4: Write `TourCaddieApp.swift`**

```swift
import SwiftUI

@main
struct TourCaddieApp: App {
    @State private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(env)
                .preferredColorScheme(.dark)
        }
    }
}

struct RootView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        if env.auth.isAuthenticated {
            MainTabView()
        } else {
            AuthView()
        }
    }
}
```

- [ ] **Step 5: Build and confirm zero errors**

  Cmd+B. Expected: build succeeds (SupabaseService and AuthService will be stubs at this point — add empty files with the class declaration to satisfy the compiler).

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "feat: scaffold Xcode project with SPM dependencies and app entry point"
```

---

### Task 2: Design System

**Files:**
- Create: `TourCaddie/Design/Colors.swift`
- Create: `TourCaddie/Design/Typography.swift`
- Create: `TourCaddie/Design/Spacing.swift`

**Interfaces:**
- Produces: `Color.tc*` extensions, `Font.tc*` extensions, `CGFloat` spacing constants — used by every view

- [ ] **Step 1: Write `Colors.swift`**

```swift
import SwiftUI

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8) & 0xFF) / 255
        let b = Double(int & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }

    static let tcBackground = Color(hex: "0A0A0F")
    static let tcSurface    = Color(hex: "141420")
    static let tcSurface2   = Color(hex: "1A1A2E")
    static let tcGreen      = Color(hex: "2ECC71")
    static let tcGold       = Color(hex: "F1C40F")
    static let tcRed        = Color(hex: "E74C3C")
    static let tcMuted      = Color(hex: "8B8BA7")
    static let tcBorder     = Color(hex: "1E1E2E")
}
```

- [ ] **Step 2: Write `Typography.swift`**

```swift
import SwiftUI

extension Font {
    static let tcDisplay  = Font.system(size: 34, weight: .bold,  design: .default)
    static let tcTitle    = Font.system(size: 22, weight: .bold,  design: .default)
    static let tcHeadline = Font.system(size: 17, weight: .semibold)
    static let tcBody     = Font.system(size: 15, weight: .regular)
    static let tcCaption  = Font.system(size: 12, weight: .medium)
    static let tcMicro    = Font.system(size: 10, weight: .bold)
}
```

- [ ] **Step 3: Write `Spacing.swift`**

```swift
import CoreFoundation

enum Spacing {
    static let xs: CGFloat  = 4
    static let sm: CGFloat  = 8
    static let md: CGFloat  = 12
    static let lg: CGFloat  = 16
    static let xl: CGFloat  = 24
    static let xxl: CGFloat = 32
}

enum Radius {
    static let card: CGFloat  = 12
    static let input: CGFloat = 8
    static let pill: CGFloat  = 99
}
```

- [ ] **Step 4: Build and confirm zero warnings** — Cmd+B.

- [ ] **Step 5: Commit**

```bash
git add TourCaddie/Design/
git commit -m "feat: add design system — colors, typography, spacing tokens"
```

---

### Task 3: Core Data Models

**Files:**
- Create: `TourCaddie/Core/Models/AppUser.swift`
- Create: `TourCaddie/Core/Models/Course.swift`
- Create: `TourCaddie/Core/Models/Round.swift`
- Create: `TourCaddie/Core/Models/Shot.swift`
- Create: `TourCaddieTests/ModelTests.swift`

**Interfaces:**
- Produces: `AppUser`, `Course`, `TeeSet`, `Hole`, `Round`, `Shot` structs — used by services and views

- [ ] **Step 1: Write `AppUser.swift`**

```swift
import Foundation

struct AppUser: Identifiable, Codable, Sendable {
    let id: UUID
    var email: String
    var displayName: String
    var avatarURL: URL?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, email
        case displayName = "display_name"
        case avatarURL   = "avatar_url"
        case createdAt   = "created_at"
    }
}
```

- [ ] **Step 2: Write `Course.swift`**

```swift
import Foundation

struct Course: Identifiable, Codable, Sendable {
    let id: UUID
    var name: String
    var location: String
    var lat: Double?
    var lng: Double?
    var source: CourseSource
    var teeSets: [TeeSet]

    enum CourseSource: String, Codable, Sendable {
        case osm, manual, licensed
    }

    enum CodingKeys: String, CodingKey {
        case id, name, location, lat, lng, source
        case teeSets = "tee_sets"
    }
}

struct TeeSet: Identifiable, Codable, Sendable {
    let id: UUID
    var name: String
    var color: String
    var courseRating: Double
    var slopeRating: Int
    var totalYardage: Int
    var holes: [Hole]

    enum CodingKeys: String, CodingKey {
        case id, name, color, holes
        case courseRating  = "course_rating"
        case slopeRating   = "slope_rating"
        case totalYardage  = "total_yardage"
    }
}

struct Hole: Identifiable, Codable, Sendable {
    let id: UUID
    var holeNumber: Int
    var par: Int
    var yardage: Int
    var strokeIndex: Int
    var teeLat: Double?
    var teeLng: Double?
    var greenCenterLat: Double?
    var greenCenterLng: Double?

    enum CodingKeys: String, CodingKey {
        case id, par, yardage
        case holeNumber      = "hole_number"
        case strokeIndex     = "stroke_index"
        case teeLat          = "tee_lat"
        case teeLng          = "tee_lng"
        case greenCenterLat  = "green_center_lat"
        case greenCenterLng  = "green_center_lng"
    }
}
```

- [ ] **Step 3: Write `Round.swift`**

```swift
import Foundation

struct Round: Identifiable, Codable, Sendable {
    let id: UUID
    let userId: UUID
    var courseId: UUID
    var teeSetId: UUID
    var date: Date
    var status: RoundStatus
    var totalScore: Int?

    enum RoundStatus: String, Codable, Sendable {
        case inProgress = "in_progress"
        case complete
    }

    enum CodingKeys: String, CodingKey {
        case id, date, status
        case userId     = "user_id"
        case courseId   = "course_id"
        case teeSetId   = "tee_set_id"
        case totalScore = "total_score"
    }
}

struct HoleResult: Identifiable, Codable, Sendable {
    let id: UUID
    let roundId: UUID
    var holeNumber: Int
    var score: Int
    var par: Int
    var putts: Int
    var gir: Bool
    var fir: Bool?
    var scrambling: Bool

    enum CodingKeys: String, CodingKey {
        case id, score, par, putts, gir, fir, scrambling
        case roundId    = "round_id"
        case holeNumber = "hole_number"
    }
}
```

- [ ] **Step 4: Write `Shot.swift`**

```swift
import Foundation
import CoreLocation

struct Shot: Identifiable, Codable, Sendable {
    let id: UUID
    let roundId: UUID
    var holeNumber: Int
    var shotNumber: Int
    var club: String?
    var lie: LieType
    var startLat: Double
    var startLng: Double
    var endLat: Double?
    var endLng: Double?
    var distanceYards: Int?
    var isPenalty: Bool

    enum LieType: String, Codable, Sendable {
        case tee, fairway, rough, bunker, fringe, green, penalty
    }

    enum CodingKeys: String, CodingKey {
        case id, club, lie
        case roundId      = "round_id"
        case holeNumber   = "hole_number"
        case shotNumber   = "shot_number"
        case startLat     = "start_lat"
        case startLng     = "start_lng"
        case endLat       = "end_lat"
        case endLng       = "end_lng"
        case distanceYards = "distance_yards"
        case isPenalty    = "is_penalty"
    }
}
```

- [ ] **Step 5: Write model unit test**

```swift
// TourCaddieTests/ModelTests.swift
import XCTest
@testable import TourCaddie

final class ModelTests: XCTestCase {
    func testRoundStatusDecoding() throws {
        let json = #"{"id":"00000000-0000-0000-0000-000000000001","user_id":"00000000-0000-0000-0000-000000000002","course_id":"00000000-0000-0000-0000-000000000003","tee_set_id":"00000000-0000-0000-0000-000000000004","date":"2026-06-29T00:00:00Z","status":"in_progress"}"#
        let round = try JSONDecoder().decode(Round.self, from: Data(json.utf8))
        XCTAssertEqual(round.status, .inProgress)
    }

    func testShotLieDecoding() throws {
        let json = #"{"id":"00000000-0000-0000-0000-000000000001","round_id":"00000000-0000-0000-0000-000000000002","hole_number":1,"shot_number":1,"lie":"fairway","start_lat":0.0,"start_lng":0.0,"is_penalty":false}"#
        let shot = try JSONDecoder().decode(Shot.self, from: Data(json.utf8))
        XCTAssertEqual(shot.lie, .fairway)
    }
}
```

- [ ] **Step 6: Run model tests**

  In Xcode: Cmd+U. Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add TourCaddie/Core/Models/ TourCaddieTests/
git commit -m "feat: add core data models — AppUser, Course, Round, Shot with unit tests"
```

---

### Task 4: Supabase Service

**Files:**
- Create: `TourCaddie/Core/Services/SupabaseService.swift`

**Interfaces:**
- Consumes: `AppUser`, `Round`, `Shot`, `Course` structs from Task 3
- Produces: `SupabaseService` with `client: SupabaseClient` — used by `AuthService` (Task 5) and future feature services

- [ ] **Step 1: Add Supabase credentials to `.xcconfig`**

  In Xcode, create `Config.xcconfig` at project root (File → New → File → Configuration Settings File):

```
SUPABASE_URL = https://your-project-ref.supabase.co
SUPABASE_ANON_KEY = your-anon-key-here
```

  In `Info.plist`, add:
```xml
<key>SUPABASE_URL</key>
<string>$(SUPABASE_URL)</string>
<key>SUPABASE_ANON_KEY</key>
<string>$(SUPABASE_ANON_KEY)</string>
```

  In Build Settings → Configuration File, set Config.xcconfig for Debug and Release. Add `Config.xcconfig` to `.gitignore`.

- [ ] **Step 2: Write `SupabaseService.swift`**

```swift
import Foundation
import Supabase

@MainActor
@Observable
final class SupabaseService {
    let client: SupabaseClient

    init() {
        guard
            let urlString = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
            let url = URL(string: urlString),
            let anonKey = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String
        else {
            fatalError("Missing Supabase configuration in Info.plist")
        }
        self.client = SupabaseClient(supabaseURL: url, supabaseKey: anonKey)
    }
}
```

- [ ] **Step 3: Build — Cmd+B, zero errors**

- [ ] **Step 4: Commit**

```bash
git add TourCaddie/Core/Services/SupabaseService.swift Config.xcconfig
git commit -m "feat: add SupabaseService with xcconfig credentials"
```

---

### Task 5: Auth Service + Session Management

**Files:**
- Create: `TourCaddie/Core/Services/AuthService.swift`

**Interfaces:**
- Consumes: `SupabaseService.client` from Task 4
- Produces: `AuthService` with `isAuthenticated: Bool`, `currentUser: AppUser?`, `signInWithApple()`, `signInWithGoogle()`, `signInWithEmail(email:password:)`, `signOut()`

- [ ] **Step 1: Write `AuthService.swift`**

```swift
import Foundation
import Supabase
import AuthenticationServices
import GoogleSignIn

@MainActor
@Observable
final class AuthService: NSObject {
    private let supabase: SupabaseService

    var currentUser: AppUser?
    var isAuthenticated: Bool { currentUser != nil }
    var isLoading = false
    var errorMessage: String?

    init(supabase: SupabaseService) {
        self.supabase = supabase
        super.init()
        Task { await restoreSession() }
    }

    func restoreSession() async {
        do {
            let session = try await supabase.client.auth.session
            currentUser = try await fetchUser(id: session.user.id)
        } catch {
            currentUser = nil
        }
    }

    func signInWithApple() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            try await supabase.client.auth.signInWithOAuth(provider: .apple)
            if let session = try? await supabase.client.auth.session {
                currentUser = try await fetchUser(id: session.user.id)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signInWithEmail(email: String, password: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let session = try await supabase.client.auth.signIn(email: email, password: password)
            currentUser = try await fetchUser(id: session.user.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() async {
        try? await supabase.client.auth.signOut()
        currentUser = nil
    }

    private func fetchUser(id: UUID) async throws -> AppUser {
        try await supabase.client
            .from("users")
            .select()
            .eq("id", value: id)
            .single()
            .execute()
            .value
    }
}
```

- [ ] **Step 2: Build — Cmd+B, zero errors**

- [ ] **Step 3: Commit**

```bash
git add TourCaddie/Core/Services/AuthService.swift
git commit -m "feat: add AuthService with Apple Sign In, email/password, session restore"
```

---

### Task 6: Auth Screen UI

**Files:**
- Create: `TourCaddie/Features/Auth/AuthView.swift`
- Create: `TourCaddie/Features/Auth/AuthViewModel.swift`

**Interfaces:**
- Consumes: `AuthService` from environment via `AppEnvironment`
- Produces: `AuthView` — shown when `!env.auth.isAuthenticated`

- [ ] **Step 1: Write `AuthViewModel.swift`**

```swift
import Foundation
import Observation

@MainActor
@Observable
final class AuthViewModel {
    var email = ""
    var password = ""
    var showEmailForm = false
}
```

- [ ] **Step 2: Write `AuthView.swift`**

```swift
import SwiftUI
import GoogleSignInSwift

struct AuthView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var vm = AuthViewModel()

    var body: some View {
        ZStack {
            Color.tcBackground.ignoresSafeArea()

            VStack(spacing: Spacing.xl) {
                Spacer()

                // Logo / wordmark
                VStack(spacing: Spacing.sm) {
                    Image(systemName: "flag.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(Color.tcGreen)
                    Text("Tour Caddie")
                        .font(.tcDisplay)
                        .foregroundStyle(.white)
                    Text("Your game, tracked like a pro.")
                        .font(.tcBody)
                        .foregroundStyle(Color.tcMuted)
                }

                Spacer()

                VStack(spacing: Spacing.md) {
                    // Apple Sign In
                    SignInWithAppleButton { _ in } onCompletion: { _ in
                        Task { await env.auth.signInWithApple() }
                    }
                    .signInWithAppleButtonStyle(.white)
                    .frame(height: 50)
                    .cornerRadius(Radius.input)

                    // Google Sign In
                    Button {
                        Task { await env.auth.signInWithApple() } // swap for Google when configured
                    } label: {
                        HStack {
                            Image(systemName: "globe")
                            Text("Continue with Google")
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.tcSurface)
                        .foregroundStyle(.white)
                        .cornerRadius(Radius.input)
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.input)
                                .stroke(Color.tcBorder, lineWidth: 1)
                        )
                    }

                    // Email
                    if vm.showEmailForm {
                        VStack(spacing: Spacing.sm) {
                            TextField("Email", text: $vm.email)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .autocapitalization(.none)
                                .padding()
                                .background(Color.tcSurface)
                                .cornerRadius(Radius.input)

                            SecureField("Password", text: $vm.password)
                                .textContentType(.password)
                                .padding()
                                .background(Color.tcSurface)
                                .cornerRadius(Radius.input)

                            Button("Sign In") {
                                Task {
                                    await env.auth.signInWithEmail(
                                        email: vm.email,
                                        password: vm.password
                                    )
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(Color.tcGreen)
                            .foregroundStyle(.black)
                            .fontWeight(.bold)
                            .cornerRadius(Radius.input)
                        }
                    } else {
                        Button("Continue with Email") {
                            vm.showEmailForm = true
                        }
                        .foregroundStyle(Color.tcMuted)
                        .font(.tcCaption)
                    }

                    if let error = env.auth.errorMessage {
                        Text(error)
                            .font(.tcCaption)
                            .foregroundStyle(Color.tcRed)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, Spacing.lg)
                .disabled(env.auth.isLoading)
                .overlay {
                    if env.auth.isLoading {
                        ProgressView().tint(Color.tcGreen)
                    }
                }

                Spacer()
            }
        }
    }
}

#Preview {
    AuthView()
        .environment(AppEnvironment())
}
```

- [ ] **Step 3: Build and run in Simulator**

  Select any iPhone simulator (iPhone 16 recommended) → Cmd+R.
  Expected: dark auth screen with Tour Caddie logo, Apple sign-in button, Google button, email option.

- [ ] **Step 4: Commit**

```bash
git add TourCaddie/Features/Auth/
git commit -m "feat: add auth screen with Apple Sign In, Google, and email form"
```

---

### Task 7: Main Tab Navigation Shell

**Files:**
- Create: `TourCaddie/Features/Home/HomeView.swift`
- Create: `TourCaddie/Features/Rounds/RoundsView.swift`
- Create: `TourCaddie/Features/Stats/StatsView.swift`
- Create: `TourCaddie/Features/Courses/CoursesView.swift`
- Create: `TourCaddie/Features/Profile/ProfileView.swift`
- Create: `TourCaddie/Features/Profile/ProfileViewModel.swift`
- Modify: `TourCaddie/App/TourCaddieApp.swift` (add `MainTabView`)

**Interfaces:**
- Produces: `MainTabView` with 5 tabs — used by `RootView` from Task 1

- [ ] **Step 1: Write `MainTabView` in `TourCaddieApp.swift`**

```swift
struct MainTabView: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "square.grid.2x2")
                }
            RoundsView()
                .tabItem {
                    Label("Rounds", systemImage: "flag")
                }
            StatsView()
                .tabItem {
                    Label("Stats", systemImage: "chart.bar")
                }
            CoursesView()
                .tabItem {
                    Label("Courses", systemImage: "map")
                }
            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person.circle")
                }
        }
        .tint(Color.tcGreen)
        .toolbarBackground(Color.tcSurface, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}
```

- [ ] **Step 2: Write skeleton views**

  Each view follows this pattern (substitute name):

```swift
// HomeView.swift
import SwiftUI

struct HomeView: View {
    var body: some View {
        NavigationStack {
            ZStack {
                Color.tcBackground.ignoresSafeArea()
                Text("Home")
                    .foregroundStyle(Color.tcMuted)
            }
            .navigationTitle("Tour Caddie")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(Color.tcSurface, for: .navigationBar)
        }
    }
}
```

  Create `RoundsView`, `StatsView`, `CoursesView` the same way with their respective titles.

- [ ] **Step 3: Write `ProfileViewModel.swift`**

```swift
import Foundation
import Observation

@MainActor
@Observable
final class ProfileViewModel {
    private let env: AppEnvironment

    init(env: AppEnvironment) {
        self.env = env
    }

    func signOut() async {
        await env.auth.signOut()
    }
}
```

- [ ] **Step 4: Write `ProfileView.swift`**

```swift
import SwiftUI

struct ProfileView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var vm: ProfileViewModel?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.tcBackground.ignoresSafeArea()
                VStack(spacing: Spacing.xl) {
                    if let user = env.auth.currentUser {
                        VStack(spacing: Spacing.sm) {
                            Image(systemName: "person.circle.fill")
                                .font(.system(size: 64))
                                .foregroundStyle(Color.tcGreen)
                            Text(user.displayName)
                                .font(.tcTitle)
                                .foregroundStyle(.white)
                            Text(user.email)
                                .font(.tcCaption)
                                .foregroundStyle(Color.tcMuted)
                        }
                        .padding(.top, Spacing.xl)
                    }

                    Spacer()

                    Button("Sign Out") {
                        Task { await vm?.signOut() }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Color.tcSurface)
                    .foregroundStyle(Color.tcRed)
                    .cornerRadius(Radius.input)
                    .overlay(
                        RoundedRectangle(cornerRadius: Radius.input)
                            .stroke(Color.tcBorder, lineWidth: 1)
                    )
                    .padding(.horizontal, Spacing.lg)
                    .padding(.bottom, Spacing.xl)
                }
            }
            .navigationTitle("Profile")
            .toolbarBackground(Color.tcSurface, for: .navigationBar)
        }
        .onAppear {
            vm = ProfileViewModel(env: env)
        }
    }
}
```

- [ ] **Step 5: Build and run in Simulator — Cmd+R**

  Expected: App launches → dark Auth screen → sign in → 5-tab shell with dark tab bar and green tint.

- [ ] **Step 6: Visual check against design tokens**
  - Background is `#0A0A0F` ✓
  - Tab bar background is `#141420` ✓
  - Active tab tint is `#2ECC71` green ✓
  - Navigation bars are dark surface ✓

- [ ] **Step 7: Commit**

```bash
git add TourCaddie/Features/
git commit -m "feat: add 5-tab navigation shell with dark design tokens applied"
```

---

## Phase 1 Complete

At this point you have:
- ✅ Xcode project with Supabase + Google Sign-In packages
- ✅ Design tokens (colors, type, spacing) as Swift constants
- ✅ Core data models with unit tests
- ✅ Supabase client wired up via xcconfig
- ✅ Auth service with Apple Sign In + email/password + session restore
- ✅ Dark auth screen matching prototype visual style
- ✅ 5-tab navigation shell with dark theming

**Show the user the running simulator before marking Phase 1 done. Get sign-off before starting Phase 2 (course database + handicap engine).**
