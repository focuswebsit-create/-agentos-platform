import { Logo } from "@/components/shared/logo";
import { interpolate, type Dictionary } from "@/i18n";

export function SiteFooter({ t, year }: { t: Dictionary; year: number }) {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <Logo label={t.common.brand} />
          <p className="max-w-sm text-sm text-muted-foreground">{t.footer.tagline}</p>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{t.footer.status}</p>
          <p>{t.footer.legalSoon}</p>
          <p className="pt-2 text-xs">
            <span className="font-latin">{interpolate(t.footer.rights, { year })}</span>
            {" · "}
            {t.common.language.current}
            {" · "}
            <span lang="en" dir="ltr">
              {t.common.language.englishSoon}
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}
