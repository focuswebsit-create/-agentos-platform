import { z } from "zod";
import { guardAdminApi } from "@/modules/platform-admin/api-guard";
import { adminCreateTemplate } from "@/modules/platform-admin/templates";
import { okJson, problem } from "@/modules/api/respond";

const CreateSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9-]{1,62}$/, "slug must be a lowercase kebab-case identifier"),
  category: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(1000),
});

/**
 * POST /api/admin/templates — create a template, as a draft.
 *
 * Draft is not configurable here. Staged publishing means a template exists
 * before anyone can install it, and a create call that could go straight to
 * public would make every typo a release to every tenant.
 */
export async function POST(request: Request) {
  const guard = await guardAdminApi(request);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.", guard.requestId);
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return problem("VALIDATION_FAILED", "פרטי התבנית אינם תקינים.", guard.requestId);
  }

  const result = await adminCreateTemplate(guard.admin, parsed.data);
  if (!result.ok) {
    return problem(
      result.code === "SLUG_TAKEN" ? "ORG_SLUG_TAKEN" : "VALIDATION_FAILED",
      result.code === "SLUG_TAKEN" ? "המזהה הזה כבר תפוס." : "יצירת התבנית נכשלה.",
      guard.requestId,
    );
  }

  return okJson({ id: result.id });
}
