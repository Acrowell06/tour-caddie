// supabase/functions/scan-scorecard/index.ts
Deno.serve(async (_req) => {
  return new Response(JSON.stringify({ ok: true, echo: 'scan-scorecard function is deployed and reachable' }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
