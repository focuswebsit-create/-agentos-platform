import type { Metadata } from "next";
import Link from "next/link";
import { MailCheckIcon } from "lucide-react";
import { ResendVerification } from "@/components/auth/resend-verification";
import { Button } from "@/components/ui/button";
import { EmailSchema } from "@/modules/contracts";
import { getDictionary, interpolate } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.auth.verifyEmail.title };

/**
 * Reads searchParams, so it is resolved per request rather than prerendered.
 */
export const instant = false;

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const raw = (await searchParams).email;
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  // The address is echoed back into the page, so it is validated rather than
  // trusted: an unvalidated query parameter rendered as text is how content
  // injection starts.
  const parsed = candidate ? EmailSchema.safeParse(candidate) : null;
  const email = parsed?.success ? parsed.data : null;

  return (
    <div className="space-y-6">
      <header className="space-y-3 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MailCheckIcon className="size-6" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{t.auth.verifyEmail.title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {email ? interpolate(t.auth.verifyEmail.body, { email }) : t.auth.verifyEmail.bodyNoEmail}
        </p>
      </header>

      <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
        <ResendVerification t={t} email={email} />
        <p className="text-center text-xs text-muted-foreground">{t.auth.verifyEmail.checkSpam}</p>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/sign-in">{t.auth.verifyEmail.backToSignIn}</Link>
        </Button>
      </div>
    </div>
  );
}
