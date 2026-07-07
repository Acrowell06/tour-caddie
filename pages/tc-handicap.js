/* tc-handicap.js — Course Rating/Slope now reads/writes the shared
   Supabase course_data table (via tc-course-data.js), with localStorage
   as a same-device fallback cache if the shared read fails (e.g. offline).
   Also has the WHS handicap math: Net Double Bogey ESC, Score
   Differential, 9-hole pairing, and rolling index averaging (still pure
   functions, no Supabase dependency). Requires tc-course-data.js to be
   loaded first. */
window.TcHandicap = (() => {
  const LOWEST_COUNT_TABLE = [
    null, null, null, // 0, 1, 2 differentials — no index yet
    1, 1, 1,          // 3, 4, 5
    2, 2, 2,          // 6, 7, 8
    3, 3, 3,          // 9, 10, 11
    4, 4, 4,          // 12, 13, 14
    5, 5,             // 15, 16
    6, 6,             // 17, 18
    7,                // 19
    8                 // 20
  ];

  function cacheKey(geoKey, teeName, which9) {
    return `tc_handicap_${geoKey}_${teeName}_${which9}`;
  }

  async function getRatingSlope(geoKey, teeName, which9) {
    const shared = await TcCourseData.getRatingSlope(geoKey, teeName, which9);
    if (shared) return shared;
    try {
      const raw = localStorage.getItem(cacheKey(geoKey, teeName, which9));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async function saveRatingSlope(geoKey, teeName, which9, { rating, slope }, opts) {
    try { localStorage.setItem(cacheKey(geoKey, teeName, which9), JSON.stringify({ rating, slope })); } catch {}
    await TcCourseData.saveRatingSlope(geoKey, teeName, which9, { rating, slope }, opts);
  }

  function courseHandicap(handicapIndex, slope, rating, coursePar) {
    const idx = handicapIndex ?? 0;
    return Math.round(idx * (slope / 113) + (rating - coursePar));
  }

  function adjustedGrossScore(roundHoles, handicapIndex, slope, rating, coursePar) {
    const ch = courseHandicap(handicapIndex, slope, rating, coursePar);
    return roundHoles.reduce((total, h) => {
      const extra = (h.handicap != null && ch >= h.handicap) ? 1 : 0;
      const cap = h.par + 2 + extra;
      return total + Math.min(h.gross_score, cap);
    }, 0);
  }

  function scoreDifferential(adjustedGross, rating, slope) {
    return Math.round((113 / slope) * (adjustedGross - rating) * 10) / 10;
  }

  function pairNineHoleDifferentials(rows) {
    const eighteens = rows
      .filter(r => r.hole_count === 18 && r.differential != null)
      .map(r => ({ value: r.differential, at: r.completed_at, roundIds: [r.id] }));

    const nines = rows
      .filter(r => r.hole_count === 9 && r.differential != null)
      .sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at));

    const paired = [];
    for (let i = 0; i + 1 < nines.length; i += 2) {
      paired.push({
        value: nines[i].differential + nines[i + 1].differential,
        at: nines[i + 1].completed_at,
        roundIds: [nines[i].id, nines[i + 1].id]
      });
    }

    return [...eighteens, ...paired].sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function computeHandicapIndex(entries) {
    const recent = entries.slice(0, 20);
    const n = recent.length;
    const lowestCount = LOWEST_COUNT_TABLE[n] ?? null;
    if (!lowestCount) return { index: null, usedRoundIds: new Set() };

    const sorted = [...recent].sort((a, b) => a.value - b.value);
    const lowest = sorted.slice(0, lowestCount);
    const avg = lowest.reduce((a, b) => a + b.value, 0) / lowest.length;
    const index = Math.round(avg * 0.96 * 10) / 10;
    const usedRoundIds = new Set(lowest.flatMap(e => e.roundIds));
    return { index, usedRoundIds };
  }

  return {
    getRatingSlope, saveRatingSlope,
    courseHandicap, adjustedGrossScore, scoreDifferential,
    pairNineHoleDifferentials, computeHandicapIndex
  };
})();
