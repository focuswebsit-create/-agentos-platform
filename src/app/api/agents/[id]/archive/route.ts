import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({ orgId: z.uuid(), archived: z.boolean() });

/**
 * POST /api/agents/:id/archive — withdraw an agent from use, or restore it.
 *
 * Owner and admin only. There is no delete anywhere in this surface: runs,
 * usage events and invoices in later phases refer back to the agent that
 * produced them, and SECURITY.md 4 forbids silent deletion of such records.
 *
 * set_agent_archived() decides the restored status itself — 'published' only if
 * an active version exists, otherwise 'draft' — so restoring cannot leave the
 * agent claiming a state the data does not support.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/agents/[id]/archive">,
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problem("VALIDATION_FAILED", "מזהה סוכן לא תקין.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return problem("VALIDATION_FAILED", "בקשה לא תקינה.");

  const guard = await guardApi(request, {
    action: "agent.archive",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_agent_archived", {
    p_agent_id: id,
    p_archived: parsed.data.archived,
  });

  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }

  return okJson({ status: data as string });
}
