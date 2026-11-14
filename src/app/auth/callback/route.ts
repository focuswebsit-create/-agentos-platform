import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { safeNext } from "@/components/auth/safe-next";

/**
 * Landing point for every emailed auth link: confirmation, password recovery
 * and invitations.
 *
 * Supabase sends either a PKCE `code` or a `token_hash` + `type` pair
 * depending on the project's email template, so both are handled. Exchanging
 * them has to happen in a Route Handler because it writes session cookies.
 *
 * On failure the user is sent to sign-in with a generic marker. The specific
 * reason is deliberately not disclosed: "expired" versus "already used"
 * versus "unknown" tells an attacker which links are worth replaying.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "signup" | "recovery" | "invite" | "email_change" | "magiclink",
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  return NextResponse.redirect(new URL("/sign-in?error=link", origin));
}
