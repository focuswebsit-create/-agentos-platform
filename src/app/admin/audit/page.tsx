import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireAdminOrNotFound } from "@/modules/platform-admin/guard";
import { adminAuditLog } from "@/modules/platform-admin/data";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.admin.sections.audit.title };

/**
 * The audit log.
 *
 * Reading it is itself an audited action, so this page appears in its own
 * output on the next load. That is the point rather than a quirk: a log an
 * administrator can read without leaving a trace is a log that protects the
 * administrator rather than the customer.
 *
 * `metadata_redacted` is not displayed and not even selected. It is bounded by
 * a CHECK constraint in 0001, but that constraint is a promise about what
 * callers wrote; not reading the column is the version of the promise that a
 * future careless caller cannot break.
 */
export default async function AdminAuditPage() {
  const admin = await requireAdminOrNotFound();
  const s = t.admin.sections.audit;
  const rows = await adminAuditLog(admin);

  return (
    <div className="space-y-6">
      <PageHeader title={s.title} subtitle={s.subtitle} />

      {rows.length === 0 ? (
        <p className="rounded-2xl border bg-card px-5 py-8 text-sm text-muted-foreground shadow-sm">
          {t.admin.emptyTitle}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                {[s.columns.when, s.columns.actor, s.columns.action, s.columns.entity].map(
                  (label) => (
                    <th key={label} scope="col" className="px-4 py-3 text-start font-medium">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td dir="ltr" className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                    {row.createdAt.slice(0, 19).replace("T", " ")}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={row.actorType === "platform_admin" ? "admin" : "outline"}>
                      {s.actorTypes[row.actorType as keyof typeof s.actorTypes] ?? row.actorType}
                    </Badge>
                  </td>
                  <td dir="ltr" className="px-4 py-3 font-mono text-xs">
                    {row.action}
                  </td>
                  <td dir="ltr" className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {row.entityType}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{s.selfNote}</p>
    </div>
  );
}
