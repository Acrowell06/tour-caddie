/* tc-course-data.js — Shared, crowd-sourced course data (Course Rating/Slope
   per tee, per-hole Par/Handicap/Yardage per tee) stored in Supabase's
   course_data table, keyed by TcCourse.geoKeyFor(lat,lng). Every write here
   reads the current row first and deep-merges onto it — never a blind
   overwrite — since a scan that only covers some tees/holes must not erase
   another tee's/hole's already-good data from an earlier scan or manual
   entry. Requires tc-auth.js to be loaded first. */
window.TcCourseData = (() => {
  async function fetchRow(geoKey) {
    const { data, error } = await TcAuth.client
      .from('course_data')
      .select('*')
      .eq('geo_key', geoKey)
      .maybeSingle();
    if (error) { console.error('TcCourseData: failed to fetch', error); return null; }
    return data;
  }

  // teeName is the tee's display name ("Black","Blue","White","Gold","Red")
  // — matches the pre-existing cache-key convention tc-handicap.js already
  // uses, not the canonical key ("tips" etc).
  async function getRatingSlope(geoKey, teeName, which9) {
    const row = await fetchRow(geoKey);
    return row?.rating_slope?.[teeName]?.[which9] ?? null;
  }

  async function saveRatingSlope(geoKey, teeName, which9, { rating, slope }, { source = 'manual', courseName = null } = {}) {
    const session = await TcAuth.getSession();
    if (!session) return false;
    const existing = await fetchRow(geoKey);
    const ratingSlope = { ...(existing?.rating_slope || {}) };
    ratingSlope[teeName] = { ...(ratingSlope[teeName] || {}), [which9]: { rating, slope } };
    const { error } = await TcAuth.client.from('course_data').upsert({
      geo_key: geoKey,
      course_name: courseName ?? existing?.course_name ?? null,
      rating_slope: ratingSlope,
      holes: existing?.holes ?? [],
      source,
      updated_by: session.user.id,
      updated_at: new Date().toISOString()
    }, { onConflict: 'geo_key' });
    if (error) { console.error('TcCourseData: failed to save rating/slope', error); return false; }
    return true;
  }

  // holesPatch: [{ number, par, handicap, yardage: { canonicalTeeKey: yds, ... } }, ...]
  // Only the fields actually present in each patch entry are merged onto the
  // existing hole (par/handicap only overwritten when non-null; yardage
  // merged key-by-key) — holes/tee-keys not included in holesPatch are left
  // exactly as they were.
  async function saveHoles(geoKey, holesPatch, { source = 'manual', courseName = null } = {}) {
    const session = await TcAuth.getSession();
    if (!session) return false;
    const existing = await fetchRow(geoKey);
    const merged = (existing?.holes || []).slice();
    for (const patch of holesPatch) {
      let hole = merged.find(h => h.number === patch.number);
      if (!hole) {
        hole = { number: patch.number, par: null, handicap: null, yardage: {} };
        merged.push(hole);
      }
      if (patch.par != null) hole.par = patch.par;
      if (patch.handicap != null) hole.handicap = patch.handicap;
      if (patch.yardage) hole.yardage = { ...(hole.yardage || {}), ...patch.yardage };
    }
    merged.sort((a, b) => a.number - b.number);
    const { error } = await TcAuth.client.from('course_data').upsert({
      geo_key: geoKey,
      course_name: courseName ?? existing?.course_name ?? null,
      rating_slope: existing?.rating_slope ?? {},
      holes: merged,
      source,
      updated_by: session.user.id,
      updated_at: new Date().toISOString()
    }, { onConflict: 'geo_key' });
    if (error) { console.error('TcCourseData: failed to save holes', error); return false; }
    return true;
  }

  async function getCourseData(geoKey) {
    return fetchRow(geoKey);
  }

  return { getRatingSlope, saveRatingSlope, saveHoles, getCourseData };
})();
