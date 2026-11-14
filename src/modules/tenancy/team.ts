import "server-only";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import type { OrgRole } from "./permissions";

/**
 * Reads for the team screen.
 *
 * Every query carries an explicit org filter even though RLS already scopes
 * it. That redundancy is the point: DATA_MODEL.md requires both an API-level
 * tenant check and RLS, so a policy regression alone cannot leak another
 * tenant's rows.
 *
 * Email addresses are NOT selected for the member list. auth.users is
 * unreadable by clients, and profiles deliberately holds only a display name,
 * so a `viewer` can see who is on the team without being handed personal data.
 */

export type TeamMember = {
  userId: string;
  role: OrgRole;
  displayName: string;
  joinedAt: string;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
};

export type SeatUsage = { seatsTaken: number; seatLimit: number };

export async function listTeamMembers(orgId: string): Promise<TeamMember[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, created_at, profiles!inner(display_name)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return (
    data as unknown as Array<{
      user_id: string;
      role: OrgRole;
      created_at: string;
      profiles: { display_name: string } | null;
    }>
  ).map((row) => ({
    userId: row.user_id,
    role: row.role,
    displayName: row.profiles?.display_name ?? "—",
    joinedAt: row.created_at,
  }));
}

/** Owner/admin only — RLS returns nothing for other roles, which is the intent. */
export async function listPendingInvitations(orgId: string): Promise<PendingInvitation[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, role, expires_at")
    .eq("org_id", orgId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as Array<{ id: string; email: string; role: OrgRole; expires_at: string }>).map(
    (row) => ({ id: row.id, email: row.email, role: row.role, expiresAt: row.expires_at }),
  );
}

/**
 * Seat usage, through the membership-checked wrapper.
 *
 * org_seats_taken() itself is internal: it takes any org id and would be an
 * existence-and-size oracle for other tenants if clients could call it.
 */
export async function getSeatUsage(orgId: string): Promise<SeatUsage | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("org_seat_usage", { p_org_id: orgId });
  if (error || !data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    seatsTaken: Number((row as { seats_taken: number }).seats_taken ?? 0),
    seatLimit: Number((row as { seat_limit: number }).seat_limit ?? 0),
  };
}
