import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const OriginSchema = z
  .string()
  .trim()
  .regex(/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i, "origin");

const BodySchema = z.object({
  orgId: z.uuid(),
  enabled: z.boolean().optional(),
  allowedOrigins: z.array(OriginSchema).max(10).optional(),
  greeting: z.string().trim().max(300).nullable().optional(),
});

/**
 * PATCH /api/widgets/:id — enable/disable, embedding origins, greeting.
 * Owner/admin (0024's policy and column grant); origins must be https.
 */
export async function PATCH(request: NextRequest, context: RouteContext<"/api/widgets/[id]">) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problem("VALIDATION_FAILED", "מזהה לא תקין.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return problem("VALIDATION_FAILED", "כתובות אתר חייבות להתחיל ב-https:// (עד 10).");
  }
  const guard = await guardApi(request, {
    action: "org.update",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.allowedOrigins !== undefined)
    patch.allowed_origins = [...new Set(parsed.data.allowedOrigins.map((o) => o.toLowerCase()))];
  if (parsed.data.greeting !== undefined) patch.greeting = parsed.data.greeting || null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("chat_widgets")
    .update(patch)
    .eq("id", id)
    .eq("org_id", guard.context.orgId)
    .select("id");
  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }
  if (!Array.isArray(data) || data.length === 0) {
    return problem("ORG_ACCESS_DENIED", "הווידג'ט לא נמצא.", guard.requestId);
  }
  return okJson({ updated: true });
}
