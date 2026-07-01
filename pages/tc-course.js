/* tc-course.js — Course data via OpenStreetMap */
window.TcCourse = (() => {
  const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
  const TEE_MAP = { black:'tips', tips:'tips', gold:'gold', blue:'blue', white:'white', red:'red', yellow:'gold' };

  function haversineYds(a, b) {
    const R = 6378137, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(s)) / 0.9144;
  }

  function getCache(geoKey) {
    try {
      const raw = localStorage.getItem('tc_course_' + geoKey);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem('tc_course_' + geoKey); return null; }
      return data;
    } catch { return null; }
  }

  function setCache(geoKey, data) {
    try { localStorage.setItem('tc_course_' + geoKey, JSON.stringify({ ts: Date.now(), data })); } catch {}
  }

  function geoKeyFor(lat, lng) {
    return `${lat.toFixed(3)}_${lng.toFixed(3)}`;
  }

  function centroid(pts) {
    return {
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length
    };
  }

  // Reasonable tee-to-green yardage bounds per par, used to reject
  // implausible tee/green matches rather than confidently show a wrong number.
  const PAR_YARDAGE_RANGE = { 3: [80, 280], 4: [200, 560], 5: [380, 700] };

  // Fallback for courses that tag golf=hole as a standalone way (common in
  // OSM) instead of a relation with tee/green members. There's no explicit
  // link between a hole way and its tee/green ways in this scheme, so each
  // hole is matched to its nearest tee and green by proximity to the hole
  // way's two endpoints (trying both endpoint orientations). Holes are
  // resolved in order of match confidence and claim their tee/green so two
  // holes can't be silently matched to the same feature, and any match that
  // produces an implausible yardage for the hole's stated par is discarded
  // (green set to null) instead of shown.
  function parseOverpassWays(json) {
    const nodeMap = {};
    for (const el of json.elements) if (el.type === 'node') nodeMap[el.id] = { lat: el.lat, lng: el.lon };

    const holeWays = [], teeWays = [], greenWays = [];
    for (const el of json.elements) {
      if (el.type !== 'way' || !el.tags?.golf) continue;
      const pts = (el.nodes || []).map(id => nodeMap[id]).filter(Boolean);
      if (!pts.length) continue;
      if (el.tags.golf === 'hole') {
        const num = parseInt(el.tags.ref);
        if (num >= 1 && num <= 18) {
          holeWays.push({ num, par: parseInt(el.tags.par) || null, handicap: parseInt(el.tags.handicap) || null, pts });
        }
      } else if (el.tags.golf === 'tee') {
        teeWays.push({ centroid: centroid(pts) });
      } else if (el.tags.golf === 'green') {
        greenWays.push({ pts, centroid: centroid(pts) });
      }
    }
    if (!holeWays.length) return [];

    function nearest(list, ll, claimed) {
      let best = null, bestD = Infinity;
      for (const item of list) {
        if (claimed && claimed.has(item)) continue;
        const d = haversineYds(ll, item.centroid);
        if (d < bestD) { bestD = d; best = item; }
      }
      return best ? { item: best, dist: bestD } : null;
    }

    // First pass (no claiming yet): find each hole's best orientation and
    // confidence score, so the most confident holes get first pick below.
    const prelim = holeWays.map(h => {
      const a = h.pts[0], b = h.pts[h.pts.length - 1];
      const teeAtA = nearest(teeWays, a), teeAtB = nearest(teeWays, b);
      const greenAtA = nearest(greenWays, a), greenAtB = nearest(greenWays, b);
      const costForward  = (teeAtA?.dist ?? Infinity) + (greenAtB?.dist ?? Infinity);
      const costBackward = (teeAtB?.dist ?? Infinity) + (greenAtA?.dist ?? Infinity);
      const forward = costForward <= costBackward;
      return { h, teeEnd: forward ? a : b, greenEnd: forward ? b : a, cost: forward ? costForward : costBackward };
    }).sort((x, y) => x.cost - y.cost);

    const claimedTees = new Set(), claimedGreens = new Set();

    const holes = prelim.map(({ h, teeEnd, greenEnd }) => {
      const teePick = nearest(teeWays, teeEnd, claimedTees);
      const greenPick = nearest(greenWays, greenEnd, claimedGreens);
      if (teePick) claimedTees.add(teePick.item);
      if (greenPick) claimedGreens.add(greenPick.item);

      const tees = {};
      if (teePick) {
        for (const k of ['tips', 'gold', 'blue', 'white', 'red']) tees[k] = teePick.item.centroid;
      }
      let green = null;
      if (greenPick) {
        const gw = greenPick.item;
        const ref = teePick?.item.centroid ?? gw.centroid;
        let front = gw.pts[0], back = gw.pts[0], minD = Infinity, maxD = -Infinity;
        for (const p of gw.pts) {
          const d = haversineYds(ref, p);
          if (d < minD) { minD = d; front = p; }
          if (d > maxD) { maxD = d; back = p; }
        }
        green = { center: gw.centroid, front, back };

        const range = h.par && PAR_YARDAGE_RANGE[h.par];
        if (range && teePick) {
          const yds = haversineYds(teePick.item.centroid, green.center);
          if (yds < range[0] || yds > range[1]) green = null;
        }
      }
      return { number: h.num, par: h.par, handicap: h.handicap, tees, green };
    });

    return holes.sort((a, b) => a.number - b.number);
  }

  function parseOverpass(json) {
    const nodeMap = {}, wayMap = {};
    for (const el of json.elements) {
      if (el.type === 'node') nodeMap[el.id] = { lat: el.lat, lng: el.lon, tags: el.tags || {} };
      if (el.type === 'way')  wayMap[el.id]  = { nodeIds: el.nodes, tags: el.tags || {} };
    }
    const holes = {};
    for (const el of json.elements) {
      if (el.type !== 'relation' || el.tags?.golf !== 'hole') continue;
      const num = parseInt(el.tags.ref);
      if (!num || num < 1 || num > 18) continue;
      const tees = {};
      let greenData = null, firstTeeLL = null;
      for (const m of (el.members || [])) {
        if (m.type === 'node' && (m.role === 'tee' || m.role?.startsWith('tee'))) {
          const n = nodeMap[m.ref];
          if (!n) continue;
          const key = TEE_MAP[(n.tags.colour || n.tags.tee || 'white').toLowerCase()] || 'white';
          tees[key] = { lat: n.lat, lng: n.lng };
          if (!firstTeeLL) firstTeeLL = { lat: n.lat, lng: n.lng };
        }
        if (m.type === 'way' && m.role === 'green') {
          const w = wayMap[m.ref];
          if (!w) continue;
          const pts = w.nodeIds.map(id => nodeMap[id]).filter(Boolean);
          if (!pts.length) continue;
          const center = {
            lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
            lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length
          };
          const ref = firstTeeLL || center;
          let front = pts[0], back = pts[0], minD = Infinity, maxD = -Infinity;
          for (const p of pts) {
            const d = haversineYds(ref, p);
            if (d < minD) { minD = d; front = p; }
            if (d > maxD) { maxD = d; back = p; }
          }
          greenData = { center, front: { lat: front.lat, lng: front.lng }, back: { lat: back.lat, lng: back.lng } };
        }
      }
      // Fill missing tee colours from any available tee
      const anyTee = Object.values(tees)[0];
      if (anyTee) { for (const k of ['tips','gold','blue','white','red']) { if (!tees[k]) tees[k] = anyTee; } }
      holes[num] = {
        number: num,
        par: parseInt(el.tags.par) || null,
        handicap: parseInt(el.tags.handicap) || null,
        tees,
        green: greenData
      };
    }
    return Object.values(holes).sort((a, b) => a.number - b.number);
  }

  async function fetchOverpass(query) {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: 'data=' + encodeURIComponent(query)
    });
    if (!r.ok) throw new Error('Overpass ' + r.status);
    return r.json();
  }

  async function loadNear(lat, lng) {
    try {
      const geoKey = geoKeyFor(lat, lng);
      const cached = getCache(geoKey);
      if (cached) return cached;
      // Some courses tag golf=hole as a relation with tee/green members (parseOverpass);
      // others tag it as a standalone way with tee/green as separate unlinked ways
      // (parseOverpassWays). Fetch both shapes in one query and try both parsers.
      // 1500m, not 1000m: an 18-hole course can legitimately have holes
      // 1-1.5km from whatever single point Nominatim/OSM reports as the
      // course's location (e.g. the clubhouse), so a tighter radius silently
      // clips real, correctly-mapped holes.
      const q = `[out:json][timeout:25];(relation["golf"="hole"](around:1500,${lat},${lng});way["golf"="hole"](around:1500,${lat},${lng});way["golf"="tee"](around:1500,${lat},${lng});way["golf"="green"](around:1500,${lat},${lng}););out body;>;out skel qt;`;
      const json = await fetchOverpass(q);
      let holes = parseOverpass(json);
      if (!holes.length) holes = parseOverpassWays(json);
      if (!holes.length) return null;
      const result = { holes, geoKey };
      setCache(geoKey, result);
      return result;
    } catch { return null; }
  }

  // Merges a manually-marked tee and/or green into the cached course entry
  // for geoKey, in the exact same shape loadNear()/parseOverpass() already
  // produce, so nothing downstream needs to know a hole's data came from a
  // user's own pin drop instead of OpenStreetMap. Creates a stub hole entry
  // if this hole wasn't in the cache at all (e.g. the course had zero OSM
  // coverage for it).
  function saveManualHole(geoKey, holeNumber, patch) {
    if (!geoKey || !holeNumber) return;
    try {
      const cached = getCache(geoKey) || { holes: [], geoKey };
      let hole = cached.holes.find(h => h.number === holeNumber);
      if (!hole) {
        hole = { number: holeNumber, par: null, handicap: null, tees: {}, green: null };
        cached.holes.push(hole);
        cached.holes.sort((a, b) => a.number - b.number);
      }
      if (patch.teeColor && patch.teeLL) {
        hole.tees = { ...hole.tees, [patch.teeColor]: patch.teeLL };
      }
      if (patch.green) {
        hole.green = patch.green;
      }
      setCache(geoKey, cached);
    } catch {}
  }

  async function searchByName(query) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ' golf course')}&format=json&limit=6`;
      const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      if (!r.ok) return [];
      const results = await r.json();
      return results.map(x => ({
        name: x.display_name.split(',').slice(0, 2).join(',').trim(),
        lat: parseFloat(x.lat),
        lng: parseFloat(x.lon)
      }));
    } catch { return []; }
  }

  async function nearbyCourses(lat, lng) {
    try {
      const q = `[out:json][timeout:10];(way["leisure"="golf_course"](around:5000,${lat},${lng});relation["leisure"="golf_course"](around:5000,${lat},${lng}););out center tags;`;
      const json = await fetchOverpass(q);
      return json.elements
        .filter(el => el.tags?.name)
        .map(el => {
          const elLat = el.center?.lat ?? el.lat;
          const elLng = el.center?.lon ?? el.lon;
          const distMi = (haversineYds({ lat, lng }, { lat: elLat, lng: elLng }) / 1760).toFixed(1);
          return { name: el.tags.name, lat: elLat, lng: elLng, dist: distMi + ' mi' };
        })
        .sort((a, b) => parseFloat(a.dist) - parseFloat(b.dist));
    } catch { return []; }
  }

  return { loadNear, searchByName, nearbyCourses, haversineYds, getCache, setCache, parseOverpass, parseOverpassWays, geoKeyFor, saveManualHole };
})();
