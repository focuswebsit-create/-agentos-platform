import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { readPublishedConfig, writeDraft } from "@/modules/agents/drafts";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({ orgId: z.uuid(), versionId: z.uuid() });

/**
 * POST /api/agents/:id/restore — copy an earlier published version into the draft.
 *
 * Rollback without rewriting history. Published versions are immutable (0008),
 * so "restore v2" means: the draft now holds v2's configuration, and publishing
 * it creates v4 with that content. Every version that ever ran stays exactly
 * as it was, and the audit trail shows the rollback as a new publish.
 *
 * Nothing goes live until the user publishes, so a restore can be inspected,
 * edited and tested first.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/agents/[id]/restore">,
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
    action: "agent.update",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const supabase = await createSupabaseServerClient();
  const config = await readPublishedConfig(
    supabase,
    guard.context.orgId,
    id,
    parsed.data.versionId,
  );
  if (!config) {
    return problem("ORG_ACCESS_DENIED", "הגרסה לשחזור לא נמצאה.", guard.requestId);
  }

  const written = await writeDraft(supabase, guard.context.orgId, id, config);
  if (!written.ok) {
    if (written.reason === "not_found") {
      return problem("ORG_ACCESS_DENIED", "לא נמצאה טיוטה שניתן לעדכן.", guard.requestId);
    }
    const mapped = mapDatabaseError(written.error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }
  return okJson({ versionId: written.versionId });
}
