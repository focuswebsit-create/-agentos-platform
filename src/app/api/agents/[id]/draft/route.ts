import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { AgentDraftConfigSchema } from "@/modules/contracts";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const SaveDraftSchema = z.object({
  orgId: z.uuid(),
  config: AgentDraftConfigSchema,
});

/**
 * PUT /api/agents/:id/draft — save the working configuration.
 *
 * Writes config_json on the agent's one unpublished version. It cannot touch a
 * published one: the policy in 0007 restricts UPDATE to rows with published_at
 * null, and the trigger in 0008 repeats that for connections RLS does not bind.
 * The `published_at is null` filter below is a third statement of the same rule,
 * so the row this route means to write is the row it writes.
 *
 * The draft schema is lenient on purpose — half-written instructions must be
 * saveable. The strict schema is applied at publish, in one place.
 */
export async function PUT(request: NextRequest, context: RouteContext<"/api/agents/[id]/draft">) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problem("VALIDATION_FAILED", "מזהה סוכן לא תקין.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = SaveDraftSchema.safeParse(body);
  if (!parsed.success) return problem("VALIDATION_FAILED", "הגדרות הסוכן אינן תקינות.");

  const guard = await guardApi(request, {
    action: "agent.update",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("agent_versions")
    .update({ config_json: parsed.data.config })
    .eq("agent_id", id)
    .eq("org_id", guard.context.orgId)
    .is("published_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }
  if (!data) {
    return problem("ORG_ACCESS_DENIED", "לא נמצאה טיוטה שניתן לשמור.", guard.requestId);
  }

  return okJson({ versionId: (data as { id: string }).id });
}
