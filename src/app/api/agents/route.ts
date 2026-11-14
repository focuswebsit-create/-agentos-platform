import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const CreateAgentSchema = z.object({
  orgId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
});

/**
 * POST /api/agents — create an agent and its first draft.
 *
 * Delegates to create_agent(), which does both inserts in one transaction.
 * 0007 grants no INSERT on either table, so this is the only path: an agent
 * with no draft cannot be edited and no client can open one.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = CreateAgentSchema.safeParse(body);
  if (!parsed.success)
    return problem("VALIDATION_FAILED", "שם הסוכן חייב להכיל בין 2 ל-120 תווים.");

  const guard = await guardApi(request, {
    action: "agent.create",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_agent", {
    p_org_id: guard.context.orgId,
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
  });

  if (error) {
    const mapped = mapDatabaseError(error.message);
    return problem(mapped.code, mapped.message, guard.requestId);
  }

  return okJson({ id: data as string });
}
