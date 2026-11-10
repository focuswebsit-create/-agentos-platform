import { LockIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDictionary } from "@/i18n";
import { getAdminNavItem, type AdminSectionKey } from "./admin-nav-config";

/** Admin section: "No data" + list of future actions, every one locked. */
export function AdminSectionPage({ section }: { section: AdminSectionKey }) {
  const t = getDictionary();
  const copy = t.admin.sections[section];
  const item = getAdminNavItem(section);
  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      <EmptyState icon={item.icon} title={t.admin.emptyTitle} body={t.admin.emptyBody} />
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="text-sm">{t.admin.actionsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {copy.actions.map((action) => (
            <Button
              key={action}
              type="button"
              variant="outline"
              size="sm"
              disabled
              title={t.admin.actionLocked}
              data-testid="admin-locked-action"
            >
              <LockIcon aria-hidden />
              {action}
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
