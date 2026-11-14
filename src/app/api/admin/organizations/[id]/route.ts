import { z } from "zod";
import { guardAdminApi } from "@/modules/platform-admin/api-guard";
import { adminSetOrgSuspended } from "@/modules/platform-admin/data";
import { okJson, problem } from "@/modules/api/respond";

const BodySchema = z.discriminatedUnion("suspended", [
  // A reason is required to suspend and meaningless to restore. Expressed in
  // the schema rather than checked afterwards, so the required case cannot be
  // reached without one.
  z.object({ suspended: z.literal(true), reason: z.string().trim().min(3).max(500) }),
  z.object({ suspended: z.literal(false) }),
]);

/** PATCH /api/admin/organizations/:id — suspend from new runs, or restore. */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/admin/organizations/[id]">,
) {
  const guard = await guardAdminApi(request);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return problem("VALIDATION_FAILED", "מזהה ארגון לא תקין.", guard.requestId);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.", guard.requestId);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return problem("VALIDATION_FAILED", "יש לציין סיבה להשעיה (3 תווים לפחות).", guard.requestId);
  }

  const result = await adminSetOrgSuspended(guard.admin, {
    orgId: id,
    suspended: parsed.data.suspended,
    ...(parsed.data.suspended ? { reason: parsed.data.reason } : {}),
  });

  if (!result.ok) {
    const message =
      result.code === "REASON_REQUIRED"
        ? "יש לציין סיבה להשעיה."
        : result.code === "ORG_NOT_FOUND"
          ? "הארגון לא נמצא."
          : "העדכון נכשל.";
    return problem("VALIDATION_FAILED", message, guard.requestId);
  }

  return okJson({ status: result.status });
}
