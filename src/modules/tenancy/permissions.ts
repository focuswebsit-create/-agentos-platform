/**
 * The organisation permission matrix.
 *
 * This mirrors the RLS policies in supabase/migrations/0003_rls_policies.sql.
 * The DATABASE is authoritative: these functions exist so the server can refuse
 * early with a clear error, not so the database can be trusted less. Both
 * layers are required (DATA_MODEL.md: "RLS AND backend tenant membership
 * checks"), and tests/db/rls-suite.mjs proves the database half independently.
 *
 * If you change a rule here, change the matching policy too, or the two layers
 * will disagree and the database will silently win.
 */

export const ORG_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_ACTIONS = [
  "org.read",
  "org.update",
  "org.suspend",
  "member.list",
  "member.invite",
  "member.changeRole",
  "member.remove",
  "ownership.transfer",
  "invitation.list",
  "invitation.revoke",
  "audit.read",
  "billing.manage",

  // P2. Mirrors supabase/migrations/0007_agents_rls.sql.
  "agent.read",
  "agent.create",
  "agent.update",
  "agent.publish",
  "agent.archive",

  // P3.
  "run.read",
  "run.start",
  "run.cancel",
  "usage.read",
] as const;
export type OrgAction = (typeof ORG_ACTIONS)[number];

const MATRIX: Readonly<Record<OrgAction, readonly OrgRole[]>> = {
  "org.read": ["owner", "admin", "member", "viewer"],
  "org.update": ["owner", "admin"],
  "org.suspend": ["owner"],
  "member.list": ["owner", "admin", "member", "viewer"],
  "member.invite": ["owner", "admin"],
  "member.changeRole": ["owner", "admin"],
  "member.remove": ["owner", "admin"],
  "ownership.transfer": ["owner"],
  // Invitations carry the email addresses of people who have not joined, so
  // ordinary members and viewers never see them.
  "invitation.list": ["owner", "admin"],
  "invitation.revoke": ["owner", "admin"],
  "audit.read": ["owner", "admin"],
  "billing.manage": ["owner"],

  // Agent Studio is the working surface of the product, so `member` can build
  // and ship. Archiving withdraws something other people depend on, so it stays
  // with owner and admin. ADR-0008 has the reasoning; 0007 has the policies
  // that actually enforce it.
  "agent.read": ["owner", "admin", "member", "viewer"],
  "agent.create": ["owner", "admin", "member"],
  "agent.update": ["owner", "admin", "member"],
  "agent.publish": ["owner", "admin", "member"],
  "agent.archive": ["owner", "admin"],

  // Anyone may watch what the workspace is doing; that is the whole of a
  // viewer's job. Starting a run spends money, so a viewer may not.
  "run.read": ["owner", "admin", "member", "viewer"],
  "run.start": ["owner", "admin", "member"],
  "run.cancel": ["owner", "admin", "member"],
  // Per-call spend and monthly totals, matching 0014's policies and P1's rule
  // that viewers and members do not see billing.
  "usage.read": ["owner", "admin"],
};

export function can(role: OrgRole, action: OrgAction): boolean {
  return MATRIX[action].includes(role);
}

/**
 * Roles an actor may hand out, in an invitation or a role change.
 *
 * Only an owner may create another admin. Nobody may grant `owner`: ownership
 * moves through transfer_ownership(), one transaction, never by invitation.
 * Without this, "admin invites an admin" would be a back door around the rule
 * that only an owner appoints admins.
 */
export function assignableRoles(actor: OrgRole): readonly OrgRole[] {
  switch (actor) {
    case "owner":
      return ["admin", "member", "viewer"];
    case "admin":
      return ["member", "viewer"];
    default:
      return [];
  }
}

export function canAssignRole(actor: OrgRole, target: OrgRole): boolean {
  return assignableRoles(actor).includes(target);
}

export type MemberActionCheck = {
  actorRole: OrgRole;
  actorUserId: string;
  targetRole: OrgRole;
  targetUserId: string;
  /** The role the target would end up with; omit for removal. */
  nextRole?: OrgRole;
};

/**
 * Whether an actor may change or remove a particular membership.
 *
 * Three escalation vectors are closed here, matching the USING / WITH CHECK
 * halves of the memberships policies:
 *
 *   1. Nobody edits their own membership. An admin who could would simply
 *      promote themselves to owner.
 *   2. An admin cannot touch an owner's row, in either direction.
 *   3. An admin cannot produce an admin or an owner, so they cannot mint a peer
 *      or a superior.
 */
export function canManageMember(check: MemberActionCheck): boolean {
  const { actorRole, actorUserId, targetRole, targetUserId, nextRole } = check;

  if (actorUserId === targetUserId) return false;
  if (!can(actorRole, "member.changeRole")) return false;

  if (actorRole === "admin") {
    if (targetRole === "owner" || targetRole === "admin") return false;
    if (nextRole && !canAssignRole("admin", nextRole)) return false;
  }

  if (actorRole === "owner" && nextRole === "owner") {
    // Promoting a second owner outside transfer_ownership() would leave the
    // organisation with two owners and no audit record of the handover.
    return false;
  }

  return true;
}
