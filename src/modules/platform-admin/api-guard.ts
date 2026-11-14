import "server-only";
import type { NextResponse } from "next/server";
import { CSRF_COOKIE, CSRF_HEADER } from "@/modules/tenancy/cookie";
import { verifyCsrf } from "@/modules/tenancy/csrf";
import { newRequestId, problem } from "@/modules/api/respond";
import { requirePlatformAdmin, type PlatformAdmin } from "./guard";

/**
 * The guard for `/api/admin/*`.
 *
 * Separate from `guardApi()`, and not a variant of it, because the two answer
 * different questions. `guardApi` resolves an organisation and a role within
 * it; a platform administrator has neither, and bending the customer guard to
 * accept "no organisation" would weaken the check every customer route depends
 * on.
 *
 * Shared with it: the CSRF treatment. An administrator's browser is as
 * forgeable as anyone else's, and a cross-site POST that published a template
 * to every tenant is a worse outcome than the customer-side equivalent.
 *
 * Every failure answers **404**, exactly as the `/admin` pages do. A 401 or 403
 * from an API route would confirm the surface exists to someone who cannot
 * reach the pages, which is the one thing the 404 convention is there to
 * prevent.
 */

export type AdminGuardOk = { ok: true; admin: PlatformAdmin; requestId: string };
export type AdminApiGuardResult = AdminGuardOk | { ok: false; response: NextResponse | Response };

function selfOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the request's own origin
    }
  }
  return new URL(request.url).origin;
}

const NOT_FOUND = () => new Response(null, { status: 404 });

export async function guardAdminApi(request: Request): Promise<AdminApiGuardResult> {
  const requestId = newRequestId();

  const guard = await requirePlatformAdmin();
  if (!guard.ok) return { ok: false, response: NOT_FOUND() };

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieToken = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE}=`))
    ?.slice(CSRF_COOKIE.length + 1);

  const csrf = verifyCsrf({
    method: request.method,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    selfOrigin: selfOrigin(request),
    cookieToken: cookieToken ? decodeURIComponent(cookieToken) : undefined,
    headerToken: request.headers.get(CSRF_HEADER),
  });

  if (!csrf.ok) {
    // A real administrator who hits this gets an actionable error; the 404
    // above has already turned away everyone who is not one, so there is
    // nothing left to conceal here.
    return {
      ok: false,
      response: problem(
        "CSRF_INVALID",
        "הבקשה נדחתה מטעמי אבטחה. רעננו את הדף ונסו שוב.",
        requestId,
      ),
    };
  }

  return { ok: true, admin: guard.admin, requestId };
}
