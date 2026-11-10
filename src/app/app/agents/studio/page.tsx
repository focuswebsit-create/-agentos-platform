import type { Metadata } from "next";
import { AgentStudioPreview, type StudioCopy } from "@/components/studio/agent-studio-preview";
import { DemoBadge } from "@/components/shared/demo-badge";
import { Notice } from "@/components/shared/notice";
import { PageHeader } from "@/components/shared/page-header";
import { getDictionary } from "@/i18n";

const t = getDictionary();

export const metadata: Metadata = { title: t.studio.title };

export default function AgentStudioPage() {
  const copy: StudioCopy = {
    ...t.studio,
    preview: t.common.preview,
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title={t.studio.title}
        subtitle={t.studio.subtitle}
        actions={<DemoBadge label={t.common.preview} />}
      />
      <Notice variant="info">{t.studio.banner}</Notice>
      <AgentStudioPreview copy={copy} />
    </div>
  );
}
