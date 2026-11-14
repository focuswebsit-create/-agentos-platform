import type { NextRequest } from "next/server";
import { hasCronSecret, matchesCronSecret } from "@/config/cron.server";
import { sweepExpiredReservations } from "@/modules/runtime/sweeper";

/**
 * /api/internal/sweep-reservations — the scheduled reservation sweeper.
 *
 * Without something calling this, every crashed worker permanently shrinks that
 * tenant's monthly spend cap. This endpoint is what makes inline execution
 * survivable rather than merely survivable-in-theory.
 *
 * Not reachable by a customer, and not discoverable either:
 *
 *   - Every rejection is a bare 404. A 401 would confirm the endpoint exists
 *     and that someone is knocking on the right door.
 *   - The secret is compared in constant time, and an absent or too-short
 *     secret disables the route rather than leaving it open.
 *   - No session, no organisation, no user. `/api/internal` is deliberately
 *     absent from the proxy matcher, so no session refresh runs for it.
 *
 * GET and POST both work, and the secret is what protects it rather than the
 * method. Vercel Cron issues GET; a generic scheduler or a manual curl may send
 * either. A GET that changes state is normally wrong, but the alternative here
 * is worse: a POST-only endpoint that the configured scheduler cannot call is
 * an endpoint that never runs. The operation only expires reservations whose
 * deadline has already passed, so repeating it is harmless and a prefetch
 * cannot reach it without the header.
 */

function notFound() {
  return new Response(null, { status: 404 });
}

async function handle(request: NextRequest): Promise<Response> {
  if (!hasCronSecret()) return notFound();

  // Vercel Cron sends `Authorization: Bearer <secret>`; the explicit header is
  // for everything else.
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  const presented = request.headers.get("x-agentos-cron-secret") ?? bearer;

  if (!matchesCronSecret(presented)) return notFound();

  const result = await sweepExpiredReservations();

  // Checked after the secret on purpose: a misconfigured deployment must not
  // answer an unauthenticated caller differently from a working one.
  if (!result.ok) {
    return Response.json(
      { ok: false, reason: result.reason },
      { status: result.reason === "not_configured" ? 503 : 500 },
    );
  }

  return Response.json({ ok: true, swept: result.swept });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
