import type { Metadata } from "next";
import { AdminSectionPage } from "@/components/admin-shell/admin-section-page";
import { getDictionary } from "@/i18n";

export const metadata: Metadata = { title: getDictionary().admin.sections.alerts.title };

export default function AdminAlertsPage() {
  return <AdminSectionPage section="alerts" />;
}
