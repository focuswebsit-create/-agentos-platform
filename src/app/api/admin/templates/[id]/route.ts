import { z } from "zod";
import { guardAdminApi } from "@/modules/platform-admin/api-guard";
import { adminRollback, adminSetVisibility } from "@/modules/platform-admin/templates";
import { okJson, problem } from "@/modules/api/respond";

/**
 * Two distinct operations rather than one free-form update, because they have
 * different preconditions. Setting `public` requires an active version;
 * rolling back requires a published version of this template. A single
 * endpoint taking a column and a value could satisfy neither.
 */
const BodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("visibility"), visibility: z.enum(["draft", "public", "retired"]) }),
  z.object({ op: z.literal("rollback"), versionId: z.uuid() }),
]);

const MESSAGES: Record<string, string> = {
  TEMPLATE_NOT_FOUND: "התבנית לא נמצאה.",
  NO_ACTIVE_VERSION: "אי אפשר לפרסם תבנית בלי גרסה פעילה.",
  VERSION_NOT_ELIGIBLE: "אפשר לחזור רק לגרסה שפורסמה של אותה תבנית.",
  WRITE_FAILED: "העדכון נכשל.",
};

export async function PATCH(request: Request, context: RouteContext<"/api/admin/templates/[id]">) {
  const guard = await guardAdminApi(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return problem("VALIDATION_FAILED", "מזהה תבנית לא תקין.", guard.requestId);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.", guard.requestId);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return problem("VALIDATION_FAILED", "בקשה לא תקינה.", guard.requestId);

  const result =
    parsed.data.op === "visibility"
      ? await adminSetVisibility(guard.admin, {
          templateId: id,
          visibility: parsed.data.visibility,
        })
      : await adminRollback(guard.admin, { templateId: id, versionId: parsed.data.versionId });

  if (!result.ok) {
    return problem("VALIDATION_FAILED", MESSAGES[result.code] ?? "העדכון נכשל.", guard.requestId);
  }

  return okJson({ id: result.id });
}
