import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({
  orgId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
});

/**
 * POST /api/knowledge — create a knowledge base.
 * create_knowledge_base() checks the role and the plan's knowledge-base limit
 * under the organisation lock.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success)
    return problem("VALIDATION_FAILED", "שם המאגר חייב להכיל בין 2 ל-120 תווים.");

  const guard = await guardApi(request, {
    action: "knowledge.write",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_knowledge_base", {
    p_org_id: guard.context.orgId,
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
  });
  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }
  return okJson({ id: data as string });
}
