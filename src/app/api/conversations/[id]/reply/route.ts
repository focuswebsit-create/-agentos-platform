import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({ orgId: z.uuid(), content: z.string().trim().min(1).max(4000) });

/** POST /api/conversations/:id/reply — a person answers in a conversation they took over. */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/conversations/[id]/reply">,
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problem("VALIDATION_FAILED", "מזהה לא תקין.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return problem("VALIDATION_FAILED", "יש לכתוב תשובה.");
  const guard = await guardApi(request, {
    action: "run.start",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("post_human_reply", {
    p_conversation_id: id,
    p_content: parsed.data.content,
  });
  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(
      mapped.code,
      mapped.code === "VALIDATION_FAILED" ? "יש לקחת את השיחה לפני שעונים." : mapped.message,
      guard.requestId,
    );
  }
  return okJson({ sent: true });
}
