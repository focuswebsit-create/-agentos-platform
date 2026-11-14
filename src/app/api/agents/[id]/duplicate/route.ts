import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { getAgent } from "@/modules/agents/data";
import { writeDraft } from "@/modules/agents/drafts";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({ orgId: z.uuid() });

/**
 * POST /api/agents/:id/duplicate — a new agent whose draft is a copy of this
 * one's current draft.
 *
 * The copy is a draft, never published: it is a starting point, and a new
 * agent going live without anyone pressing publish would be a surprise. It is
 * created in the caller's organisation only; the source is read under RLS, so
 * an agent in another organisation cannot be copied (it is simply not found).
 *
 * Two statements, not one transaction: create_agent, then the draft write. If
 * the second fails the user is left with an empty copy and a clear error -
 * recoverable, visible, and costing nothing.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/agents/[id]/duplicate">,
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
    action: "agent.create",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const source = await getAgent(guard.context.orgId, id);
  if (!source) return problem("ORG_ACCESS_DENIED", "הסוכן לשכפול לא נמצא.", guard.requestId);

  const supabase = await createSupabaseServerClient();
  const name = `עותק של ${source.name}`.slice(0, 120);
  const { data: newId, error } = await supabase.rpc("create_agent", {
    p_org_id: guard.context.orgId,
    p_name: name,
    p_description: source.description,
  });
  if (error || typeof newId !== "string") {
    const mapped = mapDatabaseError(error ?? undefined);
    return problem(mapped.code, mapped.message, guard.requestId);
  }

  const written = await writeDraft(supabase, guard.context.orgId, newId, source.draftConfig);
  if (!written.ok) {
    return problem(
      "VALIDATION_FAILED",
      "הסוכן החדש נוצר, אך העתקת ההגדרות נכשלה. פתחו אותו והגדירו ידנית.",
      guard.requestId,
    );
  }
  return okJson({ id: newId });
}
