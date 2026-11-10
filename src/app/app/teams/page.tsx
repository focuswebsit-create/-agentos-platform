import type { Metadata } from "next";
import { SectionPage } from "@/components/app-shell/section-page";
import { getDictionary } from "@/i18n";

export const metadata: Metadata = { title: getDictionary().app.sections.teams.title };

export default function TeamsPage() {
  return <SectionPage section="teams" />;
}
