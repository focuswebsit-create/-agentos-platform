import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.auth.reset.title };

export default function ResetPasswordPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1.5 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t.auth.reset.title}</h1>
        <p className="text-sm text-muted-foreground">{t.auth.reset.subtitle}</p>
      </header>
      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-7">
        <ResetPasswordForm t={t} />
      </div>
    </div>
  );
}
