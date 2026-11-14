import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({ orgId: z.uuid() });

/**
 * DELETE /api/knowledge/documents/:id — owner and admin only (0022's policy).
 * The chunks go with the document (cascade), so a deleted document can no
 * longer be retrieved by any run.
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext<"/api/knowledge/documents/[id]">,
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problem("VALIDATION_FAILED", "מזהה מסמך לא תקין.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return problem("VALIDATION_FAILED", "בקשה לא תקינה.");

  const guard = await guardApi(request, {
    action: "knowledge.delete",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("knowledge_documents")
    .delete()
    .eq("id", id)
    .eq("org_id", guard.context.orgId)
    .select("id");
  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }
  if (!Array.isArray(data) || data.length === 0) {
    return problem("ORG_ACCESS_DENIED", "המסמך לא נמצא.", guard.requestId);
  }
  return okJson({ deleted: true });
}
