import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({
  orgId: z.uuid(),
  /** Optional rename at install time; the template's own name is the default. */
  name: z.string().trim().min(2).max(120).optional(),
});

/**
 * POST /api/templates/:versionId/install
 *
 * Installs a COPY (PRD.md section 3). install_template() creates the agent, its
 * draft and the installation record in one transaction, and re-checks that the
 * version is published and its template public — the function is SECURITY
 * DEFINER, so the SELECT policy that normally hides unreleased templates does
 * not apply to it.
 *
 * Guarded by `agent.create`, not a permission of its own: installing produces
 * an agent, so anyone who may create one may install one, and a separate
 * permission would be a second place to forget.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/templates/[versionId]/install">,
) {
  const { versionId } = await context.params;
  if (!z.uuid().safeParse(versionId).success) {
    return problem("VALIDATION_FAILED", "מזהה תבנית לא תקין.");
  }

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

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("install_template", {
    p_org_id: guard.context.orgId,
    p_template_version_id: versionId,
    p_name: parsed.data.name ?? null,
  });

  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }

  return okJson({ agentId: data as string });
}
