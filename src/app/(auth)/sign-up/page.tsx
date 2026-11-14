import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { getVerifiedUserId } from "@/modules/supabase/server";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.auth.signUp.title };

/**
 * Never prerendered, never cached.
 *
 * Every screen under here is resolved against the signed-in user and their
 * active organisation, so a shared prerendered copy would be one tenant's data
 * served to another. `cacheComponents` is on for the marketing site, which
 * benefits from it; authenticated routes opt out explicitly.
 */
export const instant = false;

export default async function SignUpPage() {
  if (await getVerifiedUserId()) redirect("/app");

  return (
    <div className="space-y-6">
      <header className="space-y-1.5 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t.auth.signUp.title}</h1>
        <p className="text-sm text-muted-foreground">{t.auth.signUp.subtitle}</p>
      </header>
      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-7">
        <SignUpForm t={t} />
      </div>
    </div>
  );
}
