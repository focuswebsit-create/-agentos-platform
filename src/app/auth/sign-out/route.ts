import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { ACTIVE_ORG_COOKIE } from "@/modules/tenancy";

/**
 * Signing out.
 *
 * POST only. A GET would let any page sign a user out with an <img> tag, and
 * would be followed by link prefetchers.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const response = NextResponse.redirect(new URL("/", request.nextUrl.origin), { status: 303 });
  // The workspace pointer is meaningless without a session and must not
  // survive into whoever signs in next on this browser.
  response.cookies.delete(ACTIVE_ORG_COOKIE);
  return response;
}
