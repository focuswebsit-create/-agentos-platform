import { z } from "zod";
import { guardAdminApi } from "@/modules/platform-admin/api-guard";
import { adminPublishVersion } from "@/modules/platform-admin/templates";
import { okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({
  /**
   * The agent configuration, as an object. Validated against
   * AgentConfigSchema inside adminPublishVersion() rather than here: that is
   * the function deciding what every tenant can install, and the check belongs
   * where the decision is made.
   */
  definition: z.record(z.string(), z.unknown()),
  requiredTools: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
});

/** POST /api/admin/templates/:id/versions — add a version and publish it. */
export async function POST(
  request: Request,
  context: RouteContext<"/api/admin/templates/[id]/versions">,
) {
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

  const result = await adminPublishVersion(guard.admin, {
    templateId: id,
    definition: parsed.data.definition,
    requiredTools: parsed.data.requiredTools,
  });

  if (!result.ok) {
    const message =
      result.code === "DEFINITION_INVALID"
        ? "הגדרת התבנית אינה תקינה. נדרשים role, instructions, provider, model, maxSteps ו-maxSpendUsdMicros."
        : result.code === "TEMPLATE_NOT_FOUND"
          ? "התבנית לא נמצאה."
          : result.code === "ACTIVATION_FAILED"
            ? "הגרסה נוצרה אך לא הוגדרה כפעילה. נסו לחזור אליה ידנית."
            : "פרסום הגרסה נכשל.";
    return problem("VALIDATION_FAILED", message, guard.requestId);
  }

  return okJson({ id: result.id });
}
