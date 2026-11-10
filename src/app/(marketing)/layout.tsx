import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { getDictionary } from "@/i18n";

/** Build-time year keeps the marketing shell fully static. */
const BUILD_YEAR = new Date().getFullYear();

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  const t = getDictionary();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader t={t} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter t={t} year={BUILD_YEAR} />
    </div>
  );
}
