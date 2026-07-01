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
      const geoKey = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
      const cached = getCache(geoKey);
      if (cached) return cached;
      const q = `[out:json][timeout:25];(relation["golf"="hole"](around:1000,${lat},${lng}););out body;>;out skel qt;`;
      const json = await fetchOverpass(q);
      const holes = parseOverpass(json);
      if (!holes.length) return null;
      const result = { holes, geoKey };
      setCache(geoKey, result);
      return result;
    } catch { return null; }
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

  return { loadNear, searchByName, nearbyCourses, haversineYds, getCache, setCache, parseOverpass };
})();
