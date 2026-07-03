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
        scramble: payload.upAndDown
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
        distance_yds: s.distanceYards
      }));
      const { error: shotsError } = await TcAuth.client.from('shots').insert(shotRows);
      if (shotsError) { console.error('TcRounds: failed to sync shots', shotsError); return false; }
    }
    return true;
  }

  async function computeRoundDifferential(session, roundId, courseRating, slopeRating) {
    if (!window.TcHandicap || courseRating == null || slopeRating == null) return null;

    try {
      const { data: holes, error } = await TcAuth.client
        .from('round_holes')
        .select('par, gross_score, handicap')
        .eq('round_id', roundId);
      if (error || !holes || holes.length === 0) return null;

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

    const diffResult = await computeRoundDifferential(session, roundId, payload?.courseRating, payload?.slopeRating);

    const update = { status: 'complete', completed_at: new Date().toISOString() };
    if (diffResult) {
      update.differential = diffResult.differential;
      update.adjusted_score = diffResult.adjustedGross;
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
      sg: null,
      holes, pars,
      chips: [`${fir}% FIR`, `${gir}% GIR`, `${putts} putts`]
    };
  }

  async function fetchUserRounds() {
    const session = await TcAuth.getSession();
    if (!session) return null;
    const { data, error } = await TcAuth.client
      .from('rounds')
      .select('id, course_name, tee_name, tee_yardage, played_at, completed_at, status, round_holes(hole_number, par, gross_score, putts, fairway_hit, gir, scramble)')
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
