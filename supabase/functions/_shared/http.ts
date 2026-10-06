/** Request headers a browser preflight may send. Every function allows this same list. */
export const corsAllowHeaders = "authorization, x-client-info, apikey, content-type, x-flow-cron";

export const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": corsAllowHeaders,
  "access-control-allow-methods": "POST, OPTIONS",
};

/** Same methods and request headers as `corsHeaders`, with the caller's origin echoed. */
export function corsHeadersFor(origin: string): Record<string, string> {
  return {
    ...corsHeaders,
    "access-control-allow-origin": origin,
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

export function empty(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}
