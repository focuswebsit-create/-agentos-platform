"use client";

import * as React from "react";
import { UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FormAlert } from "@/components/auth/form-parts";
import { InviteForm } from "./invite-form";
import { MemberActions } from "./member-actions";
import { RevokeInvitation } from "./revoke-invitation";
import { assignableRoles, canManageMember, type OrgRole } from "@/modules/tenancy";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";

export type TeamScreenMember = {
  userId: string;
  role: OrgRole;
  displayName: string;
};

export type TeamScreenInvitation = {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
};

/**
 * Client wrapper so a failed action can surface an error in one place.
 *
 * Permissions are recomputed here only to decide what to SHOW. The server
 * decides what may happen; see src/modules/api/guard.ts and the RLS policies.
 */
export function TeamScreen({
  t,
  orgId,
  viewerUserId,
  viewerRole,
  members,
  invitations,
  canInvite,
  seats,
}: {
  t: Dictionary;
  orgId: string;
  viewerUserId: string;
  viewerRole: OrgRole;
  members: readonly TeamScreenMember[];
  invitations: readonly TeamScreenInvitation[];
  canInvite: boolean;
  seats: { seatsTaken: number; seatLimit: number } | null;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const assignable = assignableRoles(viewerRole);
  const seatsFull = seats ? seats.seatsTaken >= seats.seatLimit : false;

  const dateFormatter = new Intl.DateTimeFormat("he-IL", { dateStyle: "medium" });

  return (
    <div className="space-y-6">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      {seats ? (
        <p className="text-sm text-muted-foreground">
          {interpolate(t.team.seatsUsed, { used: seats.seatsTaken, limit: seats.seatLimit })}
        </p>
      ) : null}

      {canInvite ? (
        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-base font-semibold">{t.team.inviteHeading}</h2>
          <InviteForm t={t} orgId={orgId} assignable={assignable} seatsFull={seatsFull} />
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card shadow-sm">
        <h2 className="border-b px-5 py-4 text-base font-semibold">{t.team.membersHeading}</h2>
        <ul className="divide-y">
          {members.map((member) => {
            const isSelf = member.userId === viewerUserId;
            const mayManage = canManageMember({
              actorRole: viewerRole,
              actorUserId: viewerUserId,
              targetRole: member.role,
              targetUserId: member.userId,
            });
            return (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <UserIcon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {member.displayName}
                      {isSelf ? (
                        <span className="ms-2 text-xs font-normal text-muted-foreground">
                          ({t.team.you})
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{t.team.roleHints[member.role]}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{t.team.roles[member.role]}</Badge>
                  {mayManage ? (
                    <MemberActions
                      t={t}
                      orgId={orgId}
                      targetUserId={member.userId}
                      targetRole={member.role}
                      assignable={assignable}
                      canRemove
                      onError={setError}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
          {members.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              {t.team.noMembers}
            </li>
          ) : null}
        </ul>
      </section>

      {canInvite ? (
        <section className="rounded-2xl border bg-card shadow-sm">
          <h2 className="border-b px-5 py-4 text-base font-semibold">
            {t.team.invitationsHeading}
          </h2>
          <ul className="divide-y">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <p dir="ltr" className="truncate text-start text-sm font-medium">
                    {invitation.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {interpolate(t.team.expiresOn, {
                      date: dateFormatter.format(new Date(invitation.expiresAt)),
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline">{t.team.roles[invitation.role]}</Badge>
                  <RevokeInvitation t={t} orgId={orgId} invitationId={invitation.id} />
                </div>
              </li>
            ))}
            {invitations.length === 0 ? (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                {t.team.noInvitations}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
