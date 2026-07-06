/* tc-rounds.js — Rounds/round-holes/shots persistence to Supabase.
   Requires tc-auth.js to be loaded first (uses TcAuth.client / TcAuth.getSession()). */
window.TcRounds = (() => {
  let draining = false;

  function readQueue() {
    try { return JSON.parse(sessionStorage.getItem('tc_pending_syncs') || '[]'); }
    catch { return []; }
  }
  function writeQueue(queue) {
    sessionStorage.setItem('tc_pending_syncs', JSON.stringify(queue));
  }

  async function insertRoundRow({ courseName, teeName, teeYardage, holeCount }) {
    const session = await TcAuth.getSession();
    if (!session) return null;
    const { data, error } = await TcAuth.client
      .from('rounds')
      .insert({
        user_id: session.user.id,
        course_name: courseName,
        tee_name: teeName || null,
        tee_yardage: teeYardage || null,
        hole_count: holeCount
      })
      .select('id')
      .single();
    if (error) { console.error('TcRounds: failed to create round', error); return null; }
    return data.id;
  }

  async function createRound(meta) {
    return insertRoundRow(meta);
  }

  // Resolves the current active round's Supabase id, creating the round row
  // now if the original createRound() call (at round start) never succeeded
  // — e.g. the golfer teed off while offline. Persists the repaired id back
  // onto tc_active_round so later holes don't repeat the repair.
  async function ensureRoundId() {
    let round;
    try { round = JSON.parse(sessionStorage.getItem('tc_active_round') || 'null'); }
    catch { round = null; }
    if (!round) return null;
    if (round.roundId) return round.roundId;

    const id = await insertRoundRow({
      courseName: round.course?.name || 'Unknown Course',
      teeName: round.tee || null,
      teeYardage: round.teeYardage || null,
      holeCount: round.holes
    });
    if (id) {
      round.roundId = id;
      sessionStorage.setItem('tc_active_round', JSON.stringify(round));
    }
    return id;
  }

  async function writeHoleResult(roundId, payload) {
    const { data, error } = await TcAuth.client
      .from('round_holes')
      .upsert({
        round_id: roundId,
        hole_number: payload.holeNumber,
        par: payload.par,
        handicap: payload.handicap,
        gross_score: payload.strokes,
        putts: payload.putts,
        fairway_hit: payload.fir,
        gir: payload.gir,
        fairway_direction: payload.fairwayDirection,
        gir_direction: payload.girDirection,
        scramble: payload.upAndDown,
        tee_lat: payload.teeLat ?? null,
        tee_lng: payload.teeLng ?? null,
        green_lat: payload.greenLat ?? null,
        green_lng: payload.greenLng ?? null
      }, { onConflict: 'round_id,hole_number' })
      .select('id')
      .single();
    if (error) { console.error('TcRounds: failed to sync hole', error); return false; }

    // Idempotent under retries: clear any shots from a prior partial attempt
    // for this hole before re-inserting, so a retry never double-writes shots.
    const { error: delError } = await TcAuth.client
      .from('shots')
      .delete()
      .eq('round_id', roundId)
      .eq('hole_number', payload.holeNumber);
    if (delError) { console.error('TcRounds: failed to clear old shots before resync', delError); return false; }

    if (payload.shots && payload.shots.length > 0) {
      const shotRows = payload.shots.map(s => ({
        round_id: roundId,
        hole_number: payload.holeNumber,
        shot_number: s.shotNumber,
        club: s.club,
        lat: s.lat,
        lng: s.lng,
        result: s.result,
        lie: s.lie ?? null,
        distance_yds: s.distanceYards
      }));
      const { error: shotsError } = await TcAuth.client.from('shots').insert(shotRows);
      if (shotsError) { console.error('TcRounds: failed to sync shots', shotsError); return false; }
    }
    return true;
  }

  async function fetchRoundHoles(roundId) {
    const { data: holes, error } = await TcAuth.client
      .from('round_holes')
      .select('hole_number, par, gross_score, handicap, tee_lat, tee_lng, green_lat, green_lng')
      .eq('round_id', roundId);
    if (error) { console.error('TcRounds: failed to fetch round holes', error); return null; }
    return holes;
  }

  async function computeRoundDifferential(session, holes, courseRating, slopeRating) {
    if (!window.TcHandicap || courseRating == null || slopeRating == null || !holes || holes.length === 0) return null;

    try {
      const { data: profile, error: profileError } = await TcAuth.client
        .from('profiles')
        .select('handicap_index')
        .eq('id', session.user.id)
        .single();
      if (profileError) console.error('TcRounds: failed to fetch profile for differential calc', profileError);
      const currentIndex = profile?.handicap_index ?? null;
      const coursePar = holes.reduce((a, h) => a + (h.par ?? 4), 0);

      const adjustedGross = window.TcHandicap.adjustedGrossScore(holes, currentIndex, slopeRating, courseRating, coursePar);
      const differential = window.TcHandicap.scoreDifferential(adjustedGross, courseRating, slopeRating);
      return { adjustedGross, differential };
    } catch (e) {
      console.error('TcRounds: differential computation threw', e);
      return null;
    }
  }

  async function computeRoundStrokesGained(session, roundId, holes) {
    if (!window.TcStrokesGained) return null;
    if (!holes || holes.some(h => h.tee_lat == null || h.tee_lng == null || h.green_lat == null || h.green_lng == null)) return null;

    const { data: profile } = await TcAuth.client
      .from('profiles')
      .select('handicap_index')
      .eq('id', session.user.id)
      .single();
    const tier = window.TcStrokesGained.tierForHandicap(profile?.handicap_index ?? null);
    if (!tier) return null; // not enough rounds yet for a real handicap — skip SG rather than guess a tier

    const { data: shots, error } = await TcAuth.client
      .from('shots')
      .select('id, hole_number, shot_number, lie, lat, lng, result')
      .eq('round_id', roundId)
      .order('hole_number', { ascending: true })
      .order('shot_number', { ascending: true });
    if (error || !shots) { console.error('TcRounds: failed to fetch shots for SG', error); return null; }

    const SG = window.TcStrokesGained;
    const holeByNumber = {};
    holes.forEach(h => { holeByNumber[h.hole_number] = h; });

    const shotUpdates = [];
    const totals = { ott: 0, app: 0, atg: 0, putt: 0 };
    let anyHoleCounted = false;

    for (const holeNumKey of Object.keys(holeByNumber)) {
      const hole = holeByNumber[holeNumKey];
      const holeShots = shots.filter(s => String(s.hole_number) === String(holeNumKey));
      if (holeShots.length === 0) continue;

      const teeLL = { lat: hole.tee_lat, lng: hole.tee_lng };
      const greenLL = { lat: hole.green_lat, lng: hole.green_lng };

      // Resolve each shot's before/after distance-to-pin and lie. Before-
      // position for shot i is the tee (i===0) or the previous shot's
      // landing spot; after-position is this shot's own landing spot, or
      // "holed" (distance 0) if it went in.
      const resolved = [];
      let chainBroken = false;
      for (let i = 0; i < holeShots.length; i++) {
        const s = holeShots[i];
        if (s.lat == null || s.lng == null || !s.lie) { chainBroken = true; break; }

        const beforeLL = i === 0 ? teeLL : { lat: holeShots[i - 1].lat, lng: holeShots[i - 1].lng };
        const lieBefore = s.lie;
        const distBefore = SG.haversineYds(beforeLL, greenLL);
        const distAfter = s.result === 'holed' ? 0 : SG.haversineYds({ lat: s.lat, lng: s.lng }, greenLL);
        if (distBefore == null || distAfter == null) { chainBroken = true; break; }

        resolved.push({ id: s.id, lieBefore, distBefore, distAfter });
      }
      if (chainBroken) continue;

      // Accumulate this hole's SG contributions in per-hole temporaries first.
      // Only merge them into the round-wide totals/shotUpdates after every
      // shot in the hole has produced a valid (non-null) SG value — a single
      // unresolvable shot partway through the hole must invalidate the WHOLE
      // hole, not just leave off the failing shot.
      const holeTotals = { ott: 0, app: 0, atg: 0, putt: 0 };
      const holeShotUpdates = [];
      let holeFailed = false;
      for (let i = 0; i < resolved.length; i++) {
        const r = resolved[i];
        const lieAfter = i + 1 < resolved.length ? resolved[i + 1].lieBefore : 'green'; // holed shots never reach expectedStrokes(after) since distAfter===0 short-circuits
        const sg = SG.shotStrokesGained(tier, r.lieBefore, r.distBefore, r.distAfter, lieAfter);
        if (sg == null) { holeFailed = true; break; }
        const category = SG.categorize(r.lieBefore, hole.par, r.distBefore);
        holeTotals[category] += sg;
        holeShotUpdates.push({ id: r.id, sg_value: sg });
      }
      if (holeFailed) continue;

      anyHoleCounted = true;
      totals.ott += holeTotals.ott;
      totals.app += holeTotals.app;
      totals.atg += holeTotals.atg;
      totals.putt += holeTotals.putt;
      shotUpdates.push(...holeShotUpdates);
    }

    if (!anyHoleCounted || shotUpdates.length === 0) return null;

    for (const u of shotUpdates) {
      const { error: updateError } = await TcAuth.client.from('shots').update({ sg_value: u.sg_value }).eq('id', u.id);
      if (updateError) console.error('TcRounds: failed to write shot SG value', updateError);
    }

    const total = totals.ott + totals.app + totals.atg + totals.putt;
    return {
      ott: Math.round(totals.ott * 100) / 100,
      app: Math.round(totals.app * 100) / 100,
      atg: Math.round(totals.atg * 100) / 100,
      putt: Math.round(totals.putt * 100) / 100,
      total: Math.round(total * 100) / 100
    };
  }

  async function recomputeHandicapIndex(session) {
    if (!window.TcHandicap) return false;
    try {
      const { data: rounds, error } = await TcAuth.client
        .from('rounds')
        .select('id, hole_count, differential, completed_at')
        .eq('user_id', session.user.id)
        .eq('status', 'complete')
        .not('differential', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(50); // generously more than the 20 needed post-pairing
      if (error || !rounds) {
        console.error('TcRounds: failed to fetch round history for handicap recompute', error);
        return false;
      }

      const entries = window.TcHandicap.pairNineHoleDifferentials(rounds);
      const { index } = window.TcHandicap.computeHandicapIndex(entries);

      const { error: updateError } = await TcAuth.client
        .from('profiles')
        .update({ handicap_index: index })
        .eq('id', session.user.id);
      if (updateError) {
        console.error('TcRounds: failed to write recomputed handicap index', updateError);
        return false;
      }
      return true;
    } catch (e) {
      console.error('TcRounds: handicap index recompute threw', e);
      return false;
    }
  }

  async function writeRoundComplete(roundId, payload) {
    const session = await TcAuth.getSession();
    if (!session) return false;

    const holes = await fetchRoundHoles(roundId);
    const grossScore = holes ? holes.reduce((a, h) => a + (h.gross_score ?? 0), 0) : null;

    const diffResult = await computeRoundDifferential(session, holes, payload?.courseRating, payload?.slopeRating);

    let sgResult = null;
    try {
      sgResult = await computeRoundStrokesGained(session, roundId, holes);
    } catch (e) {
      console.error('TcRounds: Strokes Gained computation threw', e);
      sgResult = null;
    }

    const update = { status: 'complete', completed_at: new Date().toISOString() };
    if (grossScore != null) {
      update.gross_score = grossScore;
    }
    if (diffResult) {
      update.differential = diffResult.differential;
      update.adjusted_score = diffResult.adjustedGross;
    }
    if (sgResult) {
      update.sg_ott = sgResult.ott;
      update.sg_app = sgResult.app;
      update.sg_atg = sgResult.atg;
      update.sg_putt = sgResult.putt;
      update.sg_total = sgResult.total;
    }

    const { error } = await TcAuth.client
      .from('rounds')
      .update(update)
      .eq('id', roundId)
      .eq('user_id', session.user.id);
    if (error) { console.error('TcRounds: failed to complete round', error); return false; }

    if (diffResult) {
      const indexOk = await recomputeHandicapIndex(session);
      if (!indexOk) return false;
    }
    return true;
  }

  async function drainPendingSyncs() {
    if (draining) return;
    draining = true;
    try {
      let queue = readQueue();
      while (queue.length > 0) {
        const roundId = await ensureRoundId();
        if (!roundId) break; // still offline / no active round — stop, retry later

        const entry = queue[0];
        let ok = false;
        if (entry.type === 'hole') ok = await writeHoleResult(roundId, entry.payload);
        else if (entry.type === 'complete') ok = await writeRoundComplete(roundId, entry.payload);

        if (!ok) break; // leave it at the front of the queue, stop draining

        queue = queue.slice(1);
        writeQueue(queue);
      }
    } finally {
      draining = false;
    }
  }

  async function syncHole(payload) {
    const queue = readQueue();
    queue.push({ type: 'hole', payload });
    writeQueue(queue);
    return drainPendingSyncs();
  }

  async function completeRound({ courseRating, slopeRating } = {}) {
    const queue = readQueue();
    queue.push({ type: 'complete', payload: { courseRating: courseRating ?? null, slopeRating: slopeRating ?? null } });
    writeQueue(queue);
    return drainPendingSyncs();
  }

  function transformRound(row) {
    const holesData = [...row.round_holes].sort((a, b) => a.hole_number - b.hole_number);
    const holes = holesData.map(h => h.gross_score);
    const pars  = holesData.map(h => h.par ?? 4); // par is a freshly-added nullable column; guard against pre-migration rows
    const gross = holes.reduce((a, b) => a + b, 0);
    const totalPar = pars.reduce((a, b) => a + b, 0);
    const score = gross - totalPar;

    const pct = (arr, pred) => arr.length ? Math.round(arr.filter(pred).length / arr.length * 100) : 0;
    const firHoles = holesData.filter(h => h.fairway_hit !== null);
    const girHoles = holesData.filter(h => h.gir !== null);
    const udHoles  = holesData.filter(h => h.scramble !== null);
    const fir = pct(firHoles, h => h.fairway_hit);
    const gir = pct(girHoles, h => h.gir);
    const upDown = pct(udHoles, h => h.scramble);
    const putts = holesData.reduce((a, h) => a + (h.putts || 0), 0);

    const played = new Date(row.played_at);
    const date  = played.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const month = played.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    return {
      id: row.id,
      course: row.course_name || 'Unknown Course',
      date, month,
      tee: row.tee_name ? `${row.tee_name}${row.tee_yardage ? ' · ' + row.tee_yardage.toLocaleString() + ' yds' : ''}` : '—',
      type: 'Home', // no round_type column in the live schema; nothing in the UI sets this yet
      score, gross, diff: null,
      fir, gir, putts, up_down: upDown,
      sg: row.sg_total != null ? { ott: row.sg_ott, app: row.sg_app, atg: row.sg_atg, putt: row.sg_putt, total: row.sg_total } : null,
      holes, pars,
      chips: [`${fir}% FIR`, `${gir}% GIR`, `${putts} putts`]
    };
  }

  async function fetchUserRounds() {
    const session = await TcAuth.getSession();
    if (!session) return null;
    const { data, error } = await TcAuth.client
      .from('rounds')
      .select('id, course_name, tee_name, tee_yardage, played_at, completed_at, status, sg_ott, sg_app, sg_atg, sg_putt, sg_total, round_holes(hole_number, par, gross_score, putts, fairway_hit, gir, scramble)')
      .eq('user_id', session.user.id)
      .eq('status', 'complete')
      .order('completed_at', { ascending: false, nullsFirst: false })
      .order('played_at', { ascending: false });
    if (error) { console.error('TcRounds: failed to fetch rounds', error); return null; }
    return data.map(transformRound);
  }

  window.addEventListener('online', () => { drainPendingSyncs(); });

  return { createRound, syncHole, completeRound, drainPendingSyncs, fetchUserRounds };
})();
