import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.auth.forgot.title };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1.5 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t.auth.forgot.title}</h1>
        <p className="text-sm text-muted-foreground">{t.auth.forgot.subtitle}</p>
      </header>
      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-7">
        <ForgotPasswordForm t={t} />
      </div>
    </div>
  );
}
