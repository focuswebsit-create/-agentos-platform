import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { SuspendOrgControl } from "@/components/admin-shell/suspend-org-control";
import { requireAdminOrNotFound } from "@/modules/platform-admin/guard";
import { adminListOrganizations } from "@/modules/platform-admin/data";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.admin.sections.organizations.title };

/**
 * The customer list.
 *
 * Deliberately not here, and not merely hidden: email addresses, agent
 * configurations, run inputs or outputs, invitation tokens. `SUPER_ADMIN.md`
 * limits support to "non-sensitive account metadata" and denies prompt access
 * "unless break-glass with customer permission". Break-glass is not
 * implemented, so there is no code path to misuse.
 *
 * Plan and subscription state are absent because subscriptions are P5.
 */
export default async function AdminOrganizationsPage() {
  const admin = await requireAdminOrNotFound();
  const s = t.admin.sections.organizations;
  const orgs = await adminListOrganizations(admin);

  return (
    <div className="space-y-6">
      <PageHeader title={s.title} subtitle={s.subtitle} />

      {orgs.length === 0 ? (
        <p className="rounded-2xl border bg-card px-5 py-8 text-sm text-muted-foreground shadow-sm">
          {t.admin.emptyTitle}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b text-start text-xs text-muted-foreground">
              <tr>
                {[
                  s.columns.name,
                  s.columns.status,
                  s.columns.members,
                  s.columns.agents,
                  s.columns.runs,
                  s.columns.lastRun,
                  s.columns.spend,
                  s.columns.action,
                ].map((label) => (
                  <th key={label} scope="col" className="px-4 py-3 text-start font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {orgs.map((org) => (
                <tr key={org.id}>
                  <td className="px-4 py-3">
                    <span className="block font-medium">{org.name}</span>
                    <span dir="ltr" className="block font-mono text-xs text-muted-foreground">
                      {org.slug}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={org.status === "active" ? "secondary" : "muted"}>
                      {t.orgSettings.statuses[org.status]}
                    </Badge>
                  </td>
                  <td dir="ltr" className="px-4 py-3 font-mono">
                    {org.memberCount}/{org.seatLimit}
                  </td>
                  <td dir="ltr" className="px-4 py-3 font-mono">
                    {org.agentCount}
                  </td>
                  <td dir="ltr" className="px-4 py-3 font-mono">
                    {org.runCount}
                  </td>
                  <td dir="ltr" className="px-4 py-3 text-xs text-muted-foreground">
                    {org.lastRunAt ? org.lastRunAt.slice(0, 16).replace("T", " ") : "—"}
                  </td>
                  <td dir="ltr" className="px-4 py-3 font-mono">
                    ${(org.spentThisPeriodUsdMicros / 1_000_000).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <SuspendOrgControl
                      t={t}
                      orgId={org.id}
                      suspended={org.status === "suspended"}
                    />
                    {org.suspensionReason ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {s.suspendedReason}: {org.suspensionReason}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{s.privacyNote}</p>
    </div>
  );
}
