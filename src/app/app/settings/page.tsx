import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { OrgSettingsForm } from "@/components/settings/org-settings-form";
import { Badge } from "@/components/ui/badge";
import { can } from "@/modules/tenancy";
import { resolveOrgContext } from "@/modules/tenancy/context";
import { getSeatUsage } from "@/modules/tenancy/team";
import { getDictionary } from "@/i18n";

const t = getDictionary();
export const metadata: Metadata = { title: t.orgSettings.title };

/**
 * Organisation settings.
 *
 * Editable: name, locale, timezone — exactly the three columns migration 0003
 * grants UPDATE on. seat_limit and status are shown read-only because the
 * database refuses to let a customer change them, and a form field that
 * silently fails would be worse than no field.
 */
export default async function SettingsPage() {
  const resolution = await resolveOrgContext();
  if (resolution.status === "unauthenticated") redirect("/sign-in?next=/app/settings");
  if (resolution.status === "no_organization") redirect("/onboarding");

  const { context } = resolution;
  const canEdit = can(context.role, "org.update");
  const seats = can(context.role, "member.invite") ? await getSeatUsage(context.orgId) : null;

  const readOnly = [
    { label: t.orgSettings.slugLabel, value: context.orgSlug, note: t.orgSettings.slugNote },
    ...(seats
      ? [
          {
            label: t.orgSettings.seatsLabel,
            value: `${seats.seatsTaken}/${seats.seatLimit}`,
            note: t.orgSettings.seatsNote,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t.orgSettings.title} subtitle={t.orgSettings.subtitle} />

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <OrgSettingsForm
          t={t}
          orgId={context.orgId}
          initial={{
            name: context.orgName,
            locale: context.orgLocale,
            timezone: context.orgTimezone,
          }}
          canEdit={canEdit}
        />
      </section>

      <section className="rounded-2xl border bg-card shadow-sm">
        <h2 className="border-b px-5 py-4 text-base font-semibold">
          {t.orgSettings.readOnlyHeading}
        </h2>
        <dl className="divide-y">
          {readOnly.map((row) => (
            <div
              key={row.label}
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-4"
            >
              <div>
                <dt className="text-sm font-medium">{row.label}</dt>
                <dd className="text-xs text-muted-foreground">{row.note}</dd>
              </div>
              <span dir="ltr" className="font-mono text-sm">
                {row.value}
              </span>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
            <dt className="text-sm font-medium">{t.orgSettings.statusLabel}</dt>
            <Badge variant={context.orgStatus === "active" ? "secondary" : "muted"}>
              {t.orgSettings.statuses[context.orgStatus]}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
            <dt className="text-sm font-medium">{t.orgSettings.yourRoleLabel}</dt>
            <Badge variant="outline">{t.team.roles[context.role]}</Badge>
          </div>
        </dl>
      </section>
    </div>
  );
}
