import { authenticate } from "./access";
import { deleteRole, listRoles, putRole, stats } from "./admin";
import { HttpError, fail, json, type Env } from "./http";
import { atLeast, grantOf, touchLastSeen } from "./roles";
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
    const { role, canPush } = await grantOf(env.DB, email);
    // The one place lastSeenAt is stamped. This endpoint is called once, on
    // boot; the 60s poll hits /pull and never lands here, which is what keeps
    // this at one write per session. Keep it that way.
    await touchLastSeen(env.DB, email);
    // `canPush` travels so the client can stop pushing and say so, rather than
    // batting every sweep against a 403 it could have predicted. It is a hint,
    // not the enforcement — that is on /api/sync/push below.
    return json({ email, role, canPush });
  }

  if (path === "/api/sync/pull" && method === "GET") {
    const { email } = await authenticate(request, env, env.ACCESS_AUD_SYNC);
    const { role } = await grantOf(env.DB, email);
    // Pulling is deliberately NOT gated on canPush. A local-only account is one
    // that does not publish, not one that is cut off: it still wants everyone
    // else's rows, and withholding them would make the flag a demotion.
    //
    // The check stays, raised from 'read' to 'write'. Access is the read gate
    // and the client has a gate screen, but neither is server-side
    // authorization: a blocked account must get 403 from every endpoint.
    if (!atLeast(role, "write")) {
      throw new HttpError(403, "forbidden", "Akun ini belum diberi akses.");
    }
    return handlePull(env.DB, url);
  }

  if (path === "/api/sync/push" && method === "POST") {
    const { email } = await authenticate(request, env, env.ACCESS_AUD_SYNC);
    // Read live, on this request. A role carried over from an earlier call —
    // or from token-issue time — would let a demoted account keep writing until
    // its session expired.
    const { role, canPush } = await grantOf(env.DB, email);
    if (!atLeast(role, "write")) {
      // Not "hanya bisa membaca" any more: there is no read-only role left, so
      // the only way to fail this check is to be absent from the roles table.
      throw new HttpError(403, "forbidden", "Akun ini belum diberi akses.");
    }
    // This is what makes "local-only" a fact rather than a client convention.
    // The client already refuses to get here, so in practice only a tab that
    // has been open since before the flag was set — or a hand-made request —
    // ever sees this, and both are exactly what the check is for.
    if (!canPush) {
      throw new HttpError(
        403,
        "local_only",
        "Akun ini disetel menyimpan di perangkat sendiri saja, jadi perubahannya tidak dikirim ke cloud.",
      );
    }
    return handlePush(env.DB, await readJson(request), email);
  }

  // ---------- /api/admin ----------

  // The way back in after the owner-only session lapses, and the only one there
  // is. Two Access applications guard this hostname (see wrangler.jsonc): the
  // broad one over everything, the owner-only one over /api/admin/*. They hold
  // separate sessions, so the admin session can expire while the hostname one
  // is still good — and when it does, reloading the page cannot fix it. A
  // reload is a navigation to /, which the hostname application waves through
  // without ever asking the admin one for anything.
  //
  // Nothing under /api/admin/* is otherwise reached by navigation, only by
  // fetch, and those now stop at the redirect instead of following it
  // (AdminPage.tsx) — correct for a fetch, but it means no request the app
  // makes can ever re-authenticate it.
  //
  // So: a path under the guarded prefix that exists to be navigated to. Access
  // intercepts the navigation, runs the login, sends the browser back here, and
  // this hands it on to the page it came from. The redirect target is a fixed
  // in-app route, never anything read off the request.
  if (path === "/api/admin/login" && method === "GET") {
    // Access has already vetted this or the request would not have arrived.
    // Verifying anyway keeps the rule that every /api/admin/* handler checks:
    // if the application is ever misconfigured off this path, this should fail
    // closed and say so, not quietly bounce an unauthenticated browser into the
    // admin page.
    await authenticate(request, env, env.ACCESS_AUD_ADMIN);
    return Response.redirect(new URL("/#/admin", url).toString(), 302);
  }

  if (path === "/api/admin/me" && method === "GET") {
    const { email } = await authenticate(request, env, env.ACCESS_AUD_ADMIN);
    const { role } = await grantOf(env.DB, email);
    return json({ email, role });
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
  // Administering is a role question only. A local-only admin still manages
  // roles — the flag governs their invoice data, not their authority.
  const { role } = await grantOf(env.DB, identity.email);
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
