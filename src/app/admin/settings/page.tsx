import type { Metadata } from "next";
import { AdminSectionPage } from "@/components/admin-shell/admin-section-page";
import { getDictionary } from "@/i18n";

export const metadata: Metadata = { title: getDictionary().admin.sections.settings.title };

export default function AdminSettingsPage() {
  return <AdminSectionPage section="settings" />;
}
