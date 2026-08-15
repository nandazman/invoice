// Bindings and the JSON response conventions every endpoint follows.

export interface Env {
  DB: D1Database;
  // The static site. Bound explicitly because `run_worker_first` routes /api/*
  // here first, so anything that is not an API path has to be forwarded back.
  ASSETS: Fetcher;
  // e.g. "xutopia" for https://xutopia.cloudflareaccess.com
  ACCESS_TEAM_DOMAIN: string;
  // Application AUD tags. Two applications on one hostname, scoped by path.
  ACCESS_AUD_SYNC: string;
  ACCESS_AUD_ADMIN: string;
  // LOCAL DEVELOPMENT ONLY — see the bypass in access.ts. Set this ONLY in
  // `.dev.vars`, which is gitignored and which `wrangler deploy` never uploads.
  // Setting it as a real var or secret disables authentication in production.
  DEV_IDENTITY?: string;
}

// Every response — success or failure — is JSON. Cloudflare Access answers an
// unauthenticated browser request with an HTML login redirect, so a client that
// gets HTML back knows the request never reached us; a client that gets JSON
// knows it did. That distinction only works if we are never the one sending
// HTML, which is why even a 500 goes out through here.
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Sync responses are per-identity and always fresh; nothing in between
      // should hold on to them.
      "cache-control": "no-store",
    },
  });
}

export function fail(status: number, code: string, message: string): Response {
  return json({ code, message }, status);
}

// Thrown by the handlers to unwind to a JSON error without threading a result
// type through every helper.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
