# Weather Conditions & True Wind — Design

## Goal

Replace the hardcoded wind reading on the hole-tracking dial (`8 mph`, fixed `rotate(225)` arrow) with live wind data, and add a live conditions banner to the home screen. No backend exists in this prototype, so the solution must be pure client-side.

## Data Source

[Open-Meteo](https://open-meteo.com) current-weather endpoint — free, no API key, CORS-enabled:

```
https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph
```

Response fields used: `current.temperature_2m`, `current.weather_code`, `current.wind_speed_10m`, `current.wind_direction_10m` (`wind_direction_10m` is meteorological — direction the wind is blowing **from**).

## Shared Utility (`pages/tc-utils.js`)

Add two functions alongside the existing `haversineYds`:

- `async function fetchWeather(lat, lng)` — returns `{ tempF, weatherCode, windMph, windDirDeg }`. Checks `localStorage` cache before calling the network.
  - Cache key: `tc_wx_<lat.toFixed(2)>_<lng.toFixed(2)>` (~1km bucket).
  - Cache TTL: 15 minutes, same expiry pattern as `tc_course_*` cache in `tc-course.js` (`{ ts, data }` wrapper).
  - On fetch failure (network error, non-200, geolocation denied upstream), returns `null` — callers must handle this by hiding their weather UI, never by fabricating a value.
- `function bearingDeg(a, b)` — great-circle initial bearing in degrees (0–360) from point `a` to point `b`, `{lat,lng}` inputs matching the existing `haversineYds` signature.
- `const WMO_CODES` — lookup table mapping Open-Meteo's `weather_code` to `{ text, icon }` for the common buckets: clear, mainly clear/partly cloudy, overcast, fog, drizzle, rain, showers, thunderstorm, snow. Unmapped codes fall back to `{ text: 'Unknown', icon: '🌡️' }`.

## Home Screen (`pages/home.html`)

A fixed strip is inserted directly under the existing header block (the "GOOD MORNING / John Doe" row), outside the draggable `widget-grid` system — it is not a stat widget and is not editable.

Flow on page load:
1. `navigator.geolocation.getCurrentPosition(...)` (same call already used in `hole.html`).
2. On success, `fetchWeather(lat, lng)`.
3. On success, render: `{icon} {tempF}° · {text} · Wind {windMph} {compassLetter(windDirDeg)}` — e.g. `⛅ 72° · Partly Cloudy · Wind 8 NW`.
4. `compassLetter(deg)` is a small local helper (8-point compass: N/NE/E/SE/S/SW/W/NW) — home screen shows the *true* compass direction, unlike the hole dial.

Failure/denial handling: if geolocation is denied, times out, or `fetchWeather` returns `null`, the strip is simply not rendered (`display:none`, no placeholder text, no retry loop). This mirrors the graceful-hide pattern already used for degraded GPS state elsewhere in the app.

## Hole Wind Dial (`pages/hole.html`)

Weather is fetched **once per round**, not once per hole, using the course's tee coordinate (`TEE_LL`, already available in this file). The fetch result is cached in-memory for the session (backed by the 15-min `tc_wx_*` localStorage cache from `tc-utils.js`, so navigating hole-to-hole doesn't trigger redundant network calls even across page loads).

Per user decision, the dial shows wind **relative to the hole's playing direction**, not true compass:

1. Compute `holeBearing = bearingDeg(TEE_LL, GREEN_CTR)` — skipped/hidden entirely when `DEGRADED` (no green data), consistent with existing DEGRADED handling in this file.
2. `relativeAngle = ((windDirDeg - holeBearing) % 360 + 360) % 360`.
3. The arrow's `rotate(...)` transform uses `relativeAngle` directly (replacing the hardcoded `225`). This orients the dial so "up" = downrange/target direction.
4. The static N/E/S/W cardinal labels are removed from the dial face — they only carry meaning in true-compass mode.
5. The `.wind-spd` text changes from a bare number (`8 mph`) to speed + a text descriptor derived from `relativeAngle` in four 90°-wide buckets centered on 0/90/180/270:
   - `0° (±45)` → **INTO** (headwind)
   - `90° (±45)` → **R→L** (crosswind, wind from golfer's right)
   - `180° (±45)` → **HELPING** (tailwind)
   - `270° (±45)` → **L→R** (crosswind, wind from golfer's left)

   Example rendered text: `8 mph · INTO`.

Failure handling: if `fetchWeather` returns `null` (no signal, geolocation blocked, API down), the entire `.wind-ov` widget is hidden — no fabricated arrow or speed is shown.

## Out of Scope

- No backend/proxy — acceptable since Open-Meteo requires no key.
- No forecast/hourly data, no radar, no severe-weather alerts.
- No settings toggle between relative/true-compass modes on the hole dial (true-compass was evaluated and explicitly not chosen).
- No change to the home screen's editable widget system — the conditions strip is intentionally separate from `STATS`/`widgetConfig`.
