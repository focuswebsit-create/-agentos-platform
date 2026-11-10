import type { Metadata } from "next";
import { AdminSectionPage } from "@/components/admin-shell/admin-section-page";
import { getDictionary } from "@/i18n";

export const metadata: Metadata = { title: getDictionary().admin.sections.costs.title };

export default function AdminCostsPage() {
  return <AdminSectionPage section="costs" />;
}
