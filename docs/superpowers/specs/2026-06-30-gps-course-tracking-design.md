# GPS Course Tracking — Design Spec
**Date:** 2026-06-30  
**Status:** Approved

---

## Overview

Replace hardcoded hole coordinates in the Tour Caddie prototype with a real course data pipeline. The app detects the course from GPS or search, loads tee box and green coordinates from a Supabase database (populated from OpenStreetMap), caches the data locally for offline use, and calculates live F/C/B distances during the round.

---

## 1. Data Model

### Supabase Tables

**`courses`**
| field | type | notes |
|---|---|---|
| id | uuid | primary key |
| osm_id | text | OpenStreetMap relation ID |
| name | text | e.g. "Riviera Country Club" |
| lat | float | course center latitude |
| lng | float | course center longitude |
| hole_count | int | 9 or 18 |

**`holes`**
| field | type | notes |
|---|---|---|
| id | uuid | primary key |
| course_id | uuid | FK → courses |
| number | int | 1–18 |
| par | int | 3, 4, or 5 |
| handicap | int | 1–18 |
| tee_tips | jsonb | `{ lat, lng }` |
| tee_gold | jsonb | `{ lat, lng }` |
| tee_blue | jsonb | `{ lat, lng }` |
| tee_white | jsonb | `{ lat, lng }` |
| tee_red | jsonb | `{ lat, lng }` |
| green_front | jsonb | `{ lat, lng }` |
| green_center | jsonb | `{ lat, lng }` |
| green_back | jsonb | `{ lat, lng }` |

Green front/back are derived geometrically from the OSM green polygon: front = perimeter point closest to the tee, back = farthest point along the tee-to-green axis.

---

## 2. Course Detection & Data Loading

### Triggered at: "Start Round" tap in the rounds wizard

**Step 1 — Auto-detect**
- Read device GPS on rounds wizard open
- Query Supabase: courses within 500m of current position
- One result → pre-select it
- Multiple results → show a picker list
- No results → show name search

**Step 2 — Name search (fallback/override)**
- Text search against Supabase `courses.name`
- If the course isn't found in Supabase → trigger Overpass fetch

**Step 3 — Overpass API fetch (for unknown courses)**
- Query: `https://overpass-api.de/api/interpreter`
- Bounding box: 1km radius around user's GPS position
- Fetch all `golf=hole` relations and their linked `golf=tee` nodes and `golf=green` ways
- Parse into the holes data structure (hole number from `ref` tag, tee colour from `colour`/`tee` tag)
- Save parsed result back to Supabase `courses` + `holes` tables (so next user gets it instantly)

**Step 4 — Local cache**
- On round start, write all 18 holes' data to `localStorage`:
  - Key: `tc_course_{osmId}`
  - Value: full holes JSON
  - TTL: 30 days
- During the round, all distance calculations read from cache — no network calls

**Step 5 — Degraded mode**
- If both Supabase and Overpass fail (no signal, unmapped course):
  - F/C/B strip shows `—` instead of distances
  - Subtle banner: "No course data — shot tracking only"
  - Satellite map and shot logging still work normally

### Performance targets
- Cached course load: < 0.5s
- Supabase fetch: < 2s
- Overpass fetch + parse + save: < 5s

---

## 3. GPS Distance Logic

### On the tee (Shot 1)
- F/C/B distances calculated from the **selected tee box coords** for the current hole
- Tee is chosen based on the tee colour selected in the rounds wizard (tips/blue/white/red)
- No device GPS required yet — position is already known

### After first shot confirmed
- App switches to **live device GPS** via `navigator.geolocation.watchPosition`
- F/C/B update continuously as player walks
- Front = `haversineYds(currentPosition, green_front)`
- Center = `haversineYds(currentPosition, green_center)`
- Back = `haversineYds(currentPosition, green_back)`

### Shot distance calculation
- Shot distance = `haversineYds(previousPosition, confirmedPosition)`
- Shot 1: `previousPosition` = selected tee box coords
- Shots 2+: `previousPosition` = last confirmed shot GPS location

### Green view auto-suggest
- When `haversineYds(currentPosition, green_center)` < 50 yards, prompt user to switch to Green View
- Green SVG overlay anchors pin and distance rings to `green_center` coords

### Hole transition
- On "Confirm → Next Hole":
  - GPS reference resets to next hole's selected tee box coords
  - `watchPosition` listener paused until shot 1 is confirmed on next hole

---

## 4. Overpass Query Format

```
[out:json][timeout:25];
(
  relation["golf"="hole"](around:1000,{lat},{lng});
);
out body;
>;
out skel qt;
```

OSM tag mapping:
- `golf=tee` node with `ref=7` → hole 7 tee
- `colour=white` or `tee=white` → tee colour
- `golf=green` way → green polygon; compute centroid (center), nearest perimeter point to tee (front), farthest (back)

---

## 5. Degraded Mode Behaviour

| Condition | F/C/B | Shot tracking | Map |
|---|---|---|---|
| Full course data | ✓ Live distances | ✓ | ✓ Satellite |
| No course data | — (hidden) | ✓ | ✓ Satellite |

No blocking UI — the round always starts. Missing data is surfaced as a quiet indicator, not an error.
