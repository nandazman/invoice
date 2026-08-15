import { authenticate } from "./access";
import { deleteRole, listRoles, putRole, stats } from "./admin";
import { HttpError, fail, json, type Env } from "./http";
import { atLeast, roleOf } from "./roles";
import { handlePull, handlePush } from "./sync";

// The sync API.
//
// This Worker exists only for /api/*. Everything else is forwarded to the
// static assets binding untouched — see wrangler.jsonc for why that forwarding
// has to be explicit and why `run_worker_first` is load-bearing.
//
// Two Access applications guard this hostname by path, and each endpoint below
// verifies against the AUD of the one that is supposed to be in front of it.
// The roles table is the second layer, not the first.

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.code, err.message);
      console.error("[worker] unhandled", err);
      return fail(500, "internal", "Terjadi kesalahan di server.");
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  // ---------- /api/sync ----------

  if (path === "/api/sync/me" && method === "GET") {
    const { email } = await authenticate(request, env, env.ACCESS_AUD_SYNC);
    return json({ email, role: await roleOf(env.DB, email) });
  }

  if (path === "/api/sync/pull" && method === "GET") {
    const { email } = await authenticate(request, env, env.ACCESS_AUD_SYNC);
    const role = await roleOf(env.DB, email);
    if (!atLeast(role, "read")) {
      throw new HttpError(403, "forbidden", "Akun ini belum diberi akses.");
    }
    return handlePull(env.DB, url);
  }

  if (path === "/api/sync/push" && method === "POST") {
    const { email } = await authenticate(request, env, env.ACCESS_AUD_SYNC);
    // Read live, on this request. A role carried over from an earlier call —
    // or from token-issue time — would let a demoted account keep writing until
    // its session expired.
    const role = await roleOf(env.DB, email);
    if (!atLeast(role, "write")) {
      throw new HttpError(403, "forbidden", "Akun ini hanya bisa membaca.");
    }
    return handlePush(env.DB, await readJson(request), email);
  }

  // ---------- /api/admin ----------

  if (path === "/api/admin/me" && method === "GET") {
    const { email } = await authenticate(request, env, env.ACCESS_AUD_ADMIN);
    return json({ email, role: await roleOf(env.DB, email) });
  }

  if (path === "/api/admin/stats" && method === "GET") {
    await requireAdmin(request, env);
    return stats(env.DB);
  }

  if (path === "/api/admin/roles") {
    const { email } = await requireAdmin(request, env);
    if (method === "GET") return listRoles(env.DB);
    if (method === "PUT") return putRole(env.DB, await readJson(request), email);
    if (method === "DELETE") return deleteRole(env.DB, url.searchParams.get("email"));
  }

  return fail(404, "not_found", "Endpoint tidak ditemukan.");
}

// Defence in depth: Access already restricted /api/admin/* to the owner, but a
// misconfigured policy should downgrade to "nobody can administer", not to
// "anyone who gets through can".
async function requireAdmin(request: Request, env: Env): Promise<{ email: string }> {
  const identity = await authenticate(request, env, env.ACCESS_AUD_ADMIN);
  const role = await roleOf(env.DB, identity.email);
  if (!atLeast(role, "admin")) {
    throw new HttpError(403, "forbidden", "Tidak berwenang.");
  }
  return identity;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "bad_json", "Body bukan JSON yang valid.");
  }
}
