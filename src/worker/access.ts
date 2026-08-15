import { HttpError, type Env } from "./http";

// Cloudflare Access identity.
//
// Access puts TWO things on a request it has let through: the header
// `Cf-Access-Authenticated-User-Email`, and the signed JWT
// `Cf-Access-Jwt-Assertion`. Only the second one is evidence. The first is a
// plain header — anything that can reach the Worker without traversing Access
// (a stray route, a future Worker-to-Worker call, a misconfigured hostname) can
// set it to any address it likes. So this module never reads it.
//
// The JWT is RS256, signed by the team's rotating keypair. We verify the
// signature, then that the token was issued for THIS application (aud) by THIS
// team (iss), and that it has not expired.

export interface Identity {
  email: string;
}

interface JwtHeader {
  alg: string;
  kid: string;
}

interface JwtPayload {
  aud?: string | string[];
  email?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
}

// Keys rotate, so caching them forever would eventually reject every valid
// token — and re-fetching per request would add a round trip to the origin of
// truth on every sync. An hour splits the difference: well inside the rotation
// window, and one fetch per isolate per hour.
const KEY_TTL_MS = 60 * 60 * 1000;

interface KeyCache {
  keys: Map<string, CryptoKey>;
  expiresAt: number;
}

// Module scope, so it lives as long as the isolate. Keyed by team domain
// because the cache outlives any single request but the config is per-Env.
const keyCache = new Map<string, KeyCache>();

async function getKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  const cached = keyCache.get(teamDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const res = await fetch(url);
  if (!res.ok) {
    // Serving a stale key beats failing every sync while the certs endpoint is
    // having a bad minute — the keys are still genuine, just past our TTL.
    if (cached) return cached.keys;
    throw new HttpError(503, "access_certs_unavailable", "Tidak bisa mengambil kunci Access.");
  }

  const body = (await res.json()) as { keys?: JsonWebKey[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    const kid = (jwk as { kid?: string }).kid;
    if (!kid) continue;
    keys.set(
      kid,
      await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    );
  }
  if (keys.size === 0) {
    throw new HttpError(503, "access_certs_empty", "Kunci Access kosong.");
  }

  keyCache.set(teamDomain, { keys, expiresAt: Date.now() + KEY_TTL_MS });
  return keys;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;
}

const unauthenticated = (message: string) =>
  new HttpError(401, "unauthenticated", message);

// Verify the assertion on `request` against `aud`, and return the identity.
// `aud` is the caller's choice of Access application: the sync AUD for
// /api/sync/*, the admin AUD for /api/admin/*. A token minted for one is not
// accepted by the other, which is what makes the Access policy — not our roles
// table — the primary gate on the admin API.
export async function authenticate(
  request: Request,
  env: Env,
  aud: string,
): Promise<Identity> {
  // LOCAL DEVELOPMENT BYPASS.
  //
  // `wrangler dev` sits in front of no Access application, so no request it
  // receives can carry an assertion and every /api/* call would 401. Without
  // this, the only place any of this could be exercised is production.
  //
  // The safety is in the delivery mechanism, not in a flag we check: this comes
  // from `.dev.vars`, which is gitignored and which `wrangler deploy` does not
  // upload. There is deliberately no "am I in dev?" test — such a check is
  // exactly what gets fooled. If this value is ever present in a deployed
  // Worker, authentication is off, so it must never be added to `vars` in
  // wrangler.jsonc or set with `wrangler secret put`.
  if (env.DEV_IDENTITY) {
    console.warn(
      `[access] DEV_IDENTITY is set — authentication bypassed as "${env.DEV_IDENTITY}". ` +
        `This must never appear in a deployed Worker.`,
    );
    return { email: env.DEV_IDENTITY.trim().toLowerCase() };
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw unauthenticated("Tidak ada sesi Cloudflare Access.");

  const parts = token.split(".");
  if (parts.length !== 3) throw unauthenticated("Token Access tidak valid.");
  const [rawHeader, rawPayload, rawSignature] = parts;

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = b64urlToJson<JwtHeader>(rawHeader);
    payload = b64urlToJson<JwtPayload>(rawPayload);
  } catch {
    throw unauthenticated("Token Access tidak bisa dibaca.");
  }

  // Pinning the algorithm is not a formality: accepting whatever `alg` the
  // token names is how "alg: none" and HS256-signed-with-the-public-key forgeries
  // get in.
  if (header.alg !== "RS256") throw unauthenticated("Algoritma token tidak didukung.");

  const keys = await getKeys(env.ACCESS_TEAM_DOMAIN);
  const key = header.kid ? keys.get(header.kid) : undefined;
  if (!key) throw unauthenticated("Kunci penandatangan tidak dikenal.");

  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(rawSignature),
    new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
  );
  if (!ok) throw unauthenticated("Tanda tangan token tidak cocok.");

  const audience = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audience.includes(aud)) throw unauthenticated("Token bukan untuk aplikasi ini.");

  const expectedIss = `https://${env.ACCESS_TEAM_DOMAIN}.cloudflareaccess.com`;
  if (payload.iss !== expectedIss) throw unauthenticated("Penerbit token tidak cocok.");

  // Seconds, per JWT. No clock skew allowance: both clocks are Cloudflare's.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw unauthenticated("Sesi Access kedaluwarsa.");
  }
  if (typeof payload.nbf === "number" && payload.nbf > now) {
    throw unauthenticated("Token belum berlaku.");
  }

  if (!payload.email) throw unauthenticated("Token tidak memuat email.");
  // Addresses are compared against the roles table, which is populated by hand;
  // normalising case here means an admin typing "Owner@" cannot lock themselves
  // out against a token that says "owner@".
  return { email: payload.email.toLowerCase() };
}
