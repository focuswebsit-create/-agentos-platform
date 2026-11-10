import type { Metadata } from "next";
import { AdminSectionPage } from "@/components/admin-shell/admin-section-page";
import { getDictionary } from "@/i18n";

export const metadata: Metadata = { title: getDictionary().admin.sections.organizations.title };

export default function AdminOrganizationsPage() {
  return <AdminSectionPage section="organizations" />;
}
