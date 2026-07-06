/* tc-strokesgained.js — Strokes Gained baseline tables and math.
   Baseline tables are approximate, illustrative reference curves based on
   publicly-known golf-analytics research (not licensed PGA Tour ShotLink
   data) — every consumer of this module must present SG as an estimate,
   never as authoritative. Pure functions + no dependencies (no Supabase,
   no tc-course.js) — mirrors tc-handicap.js's self-contained pattern. */
window.TcStrokesGained = (() => {
  // Distance breakpoints (yards) for full-swing lies; feet for putting.
  const FULL_SWING_DISTANCES = [20, 50, 100, 150, 200, 250];
  const PUTTING_DISTANCES_FT = [3, 6, 10, 20, 30, 50];

  // Expected strokes to hole out, by tier and lie, at each breakpoint above.
  // Approximate reference values — see module comment.
  const BASELINES = {
    scratch: {
      fairway: [2.4, 2.6, 2.8, 3.0, 3.3, 3.6],
      rough:   [2.6, 2.8, 3.0, 3.2, 3.6, 3.9],
      bunker:  [2.7, 2.9, 3.1, 3.4, 3.8, 4.1],
      putting: [1.04, 1.3, 1.6, 1.8, 2.0, 2.2]
    },
    mid: {
      fairway: [2.6, 2.9, 3.2, 3.5, 3.9, 4.3],
      rough:   [2.8, 3.1, 3.5, 3.8, 4.3, 4.7],
      bunker:  [3.0, 3.3, 3.7, 4.1, 4.6, 5.0],
      putting: [1.08, 1.4, 1.75, 2.0, 2.2, 2.4]
    },
    high: {
      fairway: [2.8, 3.2, 3.6, 4.0, 4.5, 5.0],
      rough:   [3.1, 3.5, 3.9, 4.4, 5.0, 5.5],
      bunker:  [3.3, 3.7, 4.2, 4.7, 5.3, 5.8],
      putting: [1.1, 1.5, 1.9, 2.2, 2.4, 2.6]
    },
    beginner: {
      fairway: [3.0, 3.5, 4.0, 4.5, 5.1, 5.7],
      rough:   [3.3, 3.9, 4.4, 5.0, 5.7, 6.3],
      bunker:  [3.6, 4.1, 4.7, 5.3, 6.0, 6.6],
      putting: [1.15, 1.6, 2.0, 2.4, 2.6, 2.9]
    }
  };
  // recovery reuses the rough curve plus a flat penalty (per tier), rather
  // than its own breakpoint table — a defensible simplification given no
  // real reference data distinguishes "recovery" shots this granularly.
  const RECOVERY_PENALTY = { scratch: 0.5, mid: 0.6, high: 0.7, beginner: 0.8 };

  function haversineYds(a, b) {
    if (!a || !b) return null;
    const R = 6371000; // meters
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    const meters = 2 * R * Math.asin(Math.sqrt(h));
    return meters * 1.09361; // meters -> yards
  }

  function tierForHandicap(handicapIndex) {
    if (handicapIndex == null) return null;
    if (handicapIndex <= 5) return 'scratch';
    if (handicapIndex <= 15) return 'mid';
    if (handicapIndex <= 25) return 'high';
    return 'beginner';
  }

  function interpolate(breakpoints, values, x) {
    if (x <= breakpoints[0]) return values[0];
    if (x >= breakpoints[breakpoints.length - 1]) return values[values.length - 1];
    for (let i = 0; i < breakpoints.length - 1; i++) {
      const x0 = breakpoints[i], x1 = breakpoints[i + 1];
      if (x >= x0 && x <= x1) {
        const t = (x - x0) / (x1 - x0);
        return values[i] + t * (values[i + 1] - values[i]);
      }
    }
    return values[values.length - 1];
  }

  function expectedStrokes(tier, lie, distanceYds) {
    const table = BASELINES[tier];
    if (!table) return null;

    if (lie === 'green') {
      const distFt = distanceYds * 3;
      return interpolate(PUTTING_DISTANCES_FT, table.putting, distFt);
    }
    if (lie === 'recovery') {
      return interpolate(FULL_SWING_DISTANCES, table.rough, distanceYds) + RECOVERY_PENALTY[tier];
    }
    const key = lie === 'tee' ? 'fairway' : lie;
    const curve = table[key];
    if (!curve) return null;
    return interpolate(FULL_SWING_DISTANCES, curve, distanceYds);
  }

  function categorize(lie, par, distanceToPinBeforeYds) {
    if (lie === 'tee' && par >= 4) return 'ott';
    if (lie === 'green') return 'putt';
    if (distanceToPinBeforeYds <= 30) return 'atg';
    return 'app';
  }

  function shotStrokesGained(tier, lieBefore, distBeforeYds, distAfterYds, lieAfter) {
    const before = expectedStrokes(tier, lieBefore, distBeforeYds);
    const after = distAfterYds === 0 ? 0 : expectedStrokes(tier, lieAfter, distAfterYds);
    if (before == null || after == null) return null;
    return Math.round((before - after - 1) * 100) / 100;
  }

  return { haversineYds, tierForHandicap, expectedStrokes, categorize, shotStrokesGained };
})();
