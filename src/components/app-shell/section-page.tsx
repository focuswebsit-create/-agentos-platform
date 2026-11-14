import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getDictionary, interpolate } from "@/i18n";
import { getNavItem, type AppSectionKey } from "./nav-config";

/** Secondary links some empty states offer (internal routes only). */
const SECTION_LINKS: Partial<Record<AppSectionKey, string>> = {
  billing: "/pricing",
};

/** Generic truthful empty-state screen for a customer workspace section. */
export function SectionPage({ section }: { section: AppSectionKey }) {
  const t = getDictionary();
  const copy = t.app.sections[section];
  const item = getNavItem(section);
  const href = SECTION_LINKS[section];
  const cta = "cta" in copy ? copy.cta : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      <EmptyState
        icon={item.icon}
        title={copy.emptyTitle}
        body={copy.emptyBody}
        phaseLabel={
          item.phase ? interpolate(t.common.comingInPhase, { phase: item.phase }) : undefined
        }
        action={
          href && cta ? (
            <Button asChild variant="outline">
              <Link href={href}>{cta}</Link>
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
