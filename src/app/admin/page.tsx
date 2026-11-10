import { AlertTriangleIcon, Building2Icon, CircleDollarSignIcon, CpuIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { getDictionary } from "@/i18n";

export default function AdminOverviewPage() {
  const t = getDictionary();
  const o = t.admin.overview;
  const cards = [
    { key: "mrr", icon: CircleDollarSignIcon, label: o.cards.mrr },
    { key: "paidOrgs", icon: Building2Icon, label: o.cards.paidOrgs },
    { key: "apiCost", icon: CpuIcon, label: o.cards.apiCost },
    { key: "incidents", icon: AlertTriangleIcon, label: o.cards.incidents },
  ] as const;
  return (
    <div className="space-y-6">
      <PageHeader title={o.title} subtitle={o.subtitle} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <StatCard
            key={c.key}
            icon={c.icon}
            label={c.label}
            value={t.common.emptyValue}
            note={t.admin.emptyTitle}
          />
        ))}
      </div>
    </div>
  );
}
