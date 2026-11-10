import type { Metadata } from "next";
import { SectionPage } from "@/components/app-shell/section-page";
import { getDictionary } from "@/i18n";

export const metadata: Metadata = { title: getDictionary().app.sections.templates.title };

export default function TemplatesPage() {
  return <SectionPage section="templates" />;
}
