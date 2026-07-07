// supabase/functions/scan-scorecard/index.ts
//
// Accepts a base64-encoded photo of a golf scorecard, sends it to Claude's
// vision API, and returns structured Course Rating/Slope + per-hole
// Par/Handicap/Yardage data. Never fabricates a number the model couldn't
// actually read — missing/illegible fields come back as null, and a photo
// with no recognizable scorecard grid returns ok:false rather than a
// fabricated shape. Supabase's platform-level JWT verification (the
// project default) already rejects unauthenticated calls before this code
// runs, so there's no separate auth check here.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CANONICAL_TEES = ['tips', 'gold', 'blue', 'white', 'red'];

const PROMPT = `You are reading a photo of a golf course scorecard. Extract every hole's Par, Handicap (stroke index), and Yardage for each tee color shown, plus each tee's Course Rating and Slope Rating if printed on the card.

Map whatever tee color/name labels appear on the card onto exactly these canonical keys: tips (also called Black, Championship, or Tips), gold (also called Gold or Yellow), blue (Blue), white (White), red (Red, also called Forward or Ladies). Only include a canonical key if that tee color actually appears on the card.

Respond with STRICT JSON ONLY, no prose, no markdown code fences, matching exactly this shape:
{
  "ok": true,
  "course_name": string or null,
  "tees_present": [array of canonical tee keys actually visible on the card],
  "rating_slope": { "<tee_key>": { "rating": number or null, "slope": number or null }, ... one entry per tee in tees_present },
  "holes": [ { "number": 1-18, "par": number or null, "handicap": number or null, "yardage": { "<tee_key>": number or null, ... one entry per tee in tees_present } }, ... one entry per hole legible on the card, up to 18 ]
}

If a number is not legible or not printed on the card, use null for it — never guess or estimate a value. If the photo does not show a recognizable golf scorecard grid at all, respond with exactly: {"ok": false, "reason": "no_scorecard_detected"}`;

function clamp(value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return (value >= min && value <= max) ? value : null;
}

function validateAndClamp(parsed) {
  const teesPresent = Array.isArray(parsed.tees_present)
    ? parsed.tees_present.filter((t) => CANONICAL_TEES.includes(t))
    : [];

  const ratingSlope = {};
  for (const tee of teesPresent) {
    const rs = parsed.rating_slope?.[tee] || {};
    ratingSlope[tee] = {
      rating: clamp(rs.rating, 60, 80),
      slope: clamp(rs.slope, 55, 155)
    };
  }

  const holes = Array.isArray(parsed.holes) ? parsed.holes
    .filter((h) => Number.isInteger(h?.number) && h.number >= 1 && h.number <= 18)
    .map((h) => {
      const yardage = {};
      for (const tee of teesPresent) {
        yardage[tee] = clamp(h.yardage?.[tee], 50, 700);
      }
      return {
        number: h.number,
        par: clamp(h.par, 3, 6),
        handicap: clamp(h.handicap, 1, 18),
        yardage
      };
    }) : [];

  return {
    ok: true,
    course_name: typeof parsed.course_name === 'string' ? parsed.course_name : null,
    tees_present: teesPresent,
    rating_slope: ratingSlope,
    holes
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const { image_base64, mime_type } = await req.json();
    if (!image_base64 || typeof image_base64 !== 'string') {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_image', message: 'No image provided.', retryable: false }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    // Base64 is ~4/3 the size of the raw bytes — reject anything whose
    // decoded size would exceed ~8MB, before spending anything on Claude.
    if (image_base64.length > 11_000_000) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_image', message: 'Photo is too large — try a smaller image.', retryable: false }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: 'server_misconfigured', message: 'Scanning is temporarily unavailable.', retryable: true }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime_type || 'image/jpeg', data: image_base64 } },
            { type: 'text', text: PROMPT }
          ]
        }]
      })
    });

    if (!claudeRes.ok) {
      const retryable = claudeRes.status === 429 || claudeRes.status >= 500;
      return new Response(JSON.stringify({ ok: false, error: 'claude_api_error', message: 'Could not analyze the photo right now — please try again.', retryable }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const claudeJson = await claudeRes.json();
    const rawText = claudeJson.content?.[0]?.text || '';

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_response', message: 'Could not read a scorecard in that photo.', retryable: true }),
          { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }
      try { parsed = JSON.parse(match[0]); }
      catch {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_response', message: 'Could not read a scorecard in that photo.', retryable: true }),
          { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }
    }

    if (!parsed.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'no_scorecard_detected', message: 'Could not find a scorecard grid in that photo — try a clearer, straight-on shot.', retryable: true }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const result = validateAndClamp(parsed);
    return new Response(JSON.stringify(result), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

  } catch (_err) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_response', message: 'Something went wrong reading that photo — please try again.', retryable: true }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
});
