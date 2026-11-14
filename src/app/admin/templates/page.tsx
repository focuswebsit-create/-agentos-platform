import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateManager } from "@/components/admin-shell/template-manager";
import { requireAdminOrNotFound } from "@/modules/platform-admin/guard";
import { adminListTemplates } from "@/modules/platform-admin/templates";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.admin.sections.templates.title };

/**
 * The only path to a production catalog.
 *
 * `supabase/seed/dev_templates.sql` fills a development database and is
 * deliberately outside `migrations/`, so a real deployment starts with nothing
 * to install. This screen is how that changes — and it is the reason the
 * catalog being empty in production was an acceptable default rather than a
 * dead end.
 */
export default async function AdminTemplatesPage() {
  const admin = await requireAdminOrNotFound();
  const s = t.admin.sections.templates;
  const templates = await adminListTemplates(admin);

  return (
    <div className="space-y-6">
      <PageHeader title={s.title} subtitle={s.subtitle} />
      <TemplateManager t={t} templates={templates} />
    </div>
  );
}
