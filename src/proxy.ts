import { NextResponse, type NextRequest } from "next/server";
import { isAdminShellPreviewEnabled } from "@/config/env";

/**
 * P0 boundary for the Super Admin shell.
 * There is no authentication until P1, so /admin/* is hidden (404) unless a developer
 * explicitly opts in locally with ADMIN_SHELL_PREVIEW=true. This is NOT authorization —
 * real platform-admin auth + MFA arrives in P1/P6. The shell itself has no data or actions.
 */
export function proxy(request: NextRequest) {
  if (!isAdminShellPreviewEnabled()) {
    return NextResponse.rewrite(new URL("/_admin-disabled", request.url), { status: 404 });
  }
  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
