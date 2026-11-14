import type { Metadata } from "next";
import Link from "next/link";
import { MailOpenIcon } from "lucide-react";
import { AcceptInvitation } from "@/components/invite/accept-invitation";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { getVerifiedUserId } from "@/modules/supabase/server";
import { getDictionary } from "@/i18n";

const t = getDictionary();

export const metadata: Metadata = {
  title: t.invite.title,
  robots: { index: false, follow: false },
};

/**
 * Never prerendered, never cached.
 *
 * Every screen under here is resolved against the signed-in user and their
 * active organisation, so a shared prerendered copy would be one tenant's data
 * served to another. `cacheComponents` is on for the marketing site, which
 * benefits from it; authenticated routes opt out explicitly.
 */
export const instant = false;

/**
 * Accepting an invitation.
 *
 * The page NEVER looks the token up. It only decides whether to show a sign-in
 * prompt or an accept button; validity is established by accept_invitation()
 * inside one transaction. Checking here would both duplicate the rule and
 * turn page rendering into an oracle for whether a token exists.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const userId = await getVerifiedUserId();
  const next = `/invite/${encodeURIComponent(token)}`;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-[0.4]" aria-hidden />

      <header className="relative z-10 mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Logo label={t.common.brand} />
        <ThemeToggle label={t.common.theme.toggle} />
      </header>

      <main
        id="main"
        className="relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col justify-center px-4 pb-16 sm:px-6"
      >
        <div className="space-y-6">
          <header className="space-y-3 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MailOpenIcon className="size-6" aria-hidden />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{t.invite.title}</h1>
          </header>

          <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
            {userId ? (
              <AcceptInvitation t={t} token={token} />
            ) : (
              <>
                <p className="text-center text-sm leading-relaxed text-muted-foreground">
                  {t.invite.signInFirst}
                </p>
                <Button asChild variant="brand" size="lg" className="w-full">
                  <Link href={`/sign-in?next=${encodeURIComponent(next)}`}>
                    {t.auth.signIn.submit}
                  </Link>
                </Button>
                <p className="text-center text-xs leading-relaxed text-muted-foreground">
                  {t.invite.signUpFirst}
                </p>
                <Button asChild variant="outline" className="w-full">
                  <Link href={`/sign-up?next=${encodeURIComponent(next)}`}>
                    {t.auth.signUp.submit}
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
