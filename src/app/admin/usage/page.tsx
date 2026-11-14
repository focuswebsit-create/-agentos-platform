import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requireAdminOrNotFound } from "@/modules/platform-admin/guard";
import { adminUsageBreakdown } from "@/modules/platform-admin/data";
import { RATE_CARD_VERSION } from "@/modules/agent-engine/rate-card";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.admin.sections.usage.title };

/**
 * Spend by organisation, provider and model, for the current period.
 *
 * This is cost, not margin. `SUPER_ADMIN.md` defines gross margin as collected
 * revenue minus direct variable costs, and there is no collected revenue until
 * P5 — so there is no margin to show, and showing cost under a heading that
 * implied margin would be the kind of number that gets quoted in a board deck.
 *
 * Every figure here is priced by the rate card unless the provider reported a
 * cost itself. The card's version is stated on the page, because a number
 * whose basis is invisible is a number nobody can check.
 */
export default async function AdminUsagePage() {
  const admin = await requireAdminOrNotFound();
  const s = t.admin.sections.usage;
  const rows = await adminUsageBreakdown(admin);
  const total = rows.reduce((sum, r) => sum + r.costUsdMicros, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={s.title} subtitle={s.subtitle} />

      {rows.length === 0 ? (
        <p className="rounded-2xl border bg-card px-5 py-8 text-sm text-muted-foreground shadow-sm">
          {t.admin.emptyTitle}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  {[
                    s.columns.org,
                    s.columns.provider,
                    s.columns.model,
                    s.columns.calls,
                    s.columns.cost,
                  ].map((label) => (
                    <th key={label} scope="col" className="px-4 py-3 text-start font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={`${row.orgId}-${row.provider}-${row.model}`}>
                    <td className="px-4 py-3 font-medium">{row.orgName}</td>
                    <td dir="ltr" className="px-4 py-3 font-mono text-xs">
                      {row.provider}
                    </td>
                    <td dir="ltr" className="px-4 py-3 font-mono text-xs">
                      {row.model}
                    </td>
                    <td dir="ltr" className="px-4 py-3 font-mono">
                      {row.calls}
                    </td>
                    <td dir="ltr" className="px-4 py-3 font-mono">
                      ${(row.costUsdMicros / 1_000_000).toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t">
                <tr>
                  <td colSpan={4} className="px-4 py-3 font-medium">
                    {s.total}
                  </td>
                  <td dir="ltr" className="px-4 py-3 font-mono font-medium">
                    ${(total / 1_000_000).toFixed(4)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            {s.basisNote.replace("{version}", RATE_CARD_VERSION)}
          </p>
        </>
      )}
    </div>
  );
}
