import type { Metadata } from "next";
import { SectionPage } from "@/components/app-shell/section-page";
import { getDictionary } from "@/i18n";

export const metadata: Metadata = { title: getDictionary().app.sections.workflows.title };

export default function WorkflowsPage() {
  return <SectionPage section="workflows" />;
}
