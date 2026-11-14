import { after } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { getAgent } from "@/modules/agents/data";
import { validateForPublish } from "@/modules/contracts";
import { isCatalogModel } from "@/modules/agent-engine/model-registry";
import { resolveModelId } from "@/modules/agent-engine/rate-card";
import { isProviderConfigured } from "@/modules/agent-engine/registry";
import { executeRun } from "@/modules/runtime/executor";
import { isRuntimeConfigured } from "@/modules/runtime/readiness";
import { recoverStaleRuns } from "@/modules/runtime/recovery";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

/** after() runs inside this invocation, so it inherits this budget. */
export const maxDuration = 300;

const BodySchema = z.object({
  orgId: z.uuid(),
  prompt: z.string().trim().min(1).max(10_000),
});

/**
 * POST /api/agents/:id/test-run — run the SAVED DRAFT without publishing it.
 *
 * start_test_run() (0021) snapshots the draft at dispatch, so the run executes
 * exactly what was saved at that moment even if the draft changes afterwards.
 * Same limits and the same budget reservation as a normal run; the run is
 * marked as a test everywhere it is shown.
 *
 * Checked here first, so the caller learns what to fix before anything is
 * reserved: the draft must pass the publish schema, its provider/model must be
 * one the catalog offers, and the provider must be callable on this deployment.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/agents/[id]/test-run">,
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
  if (!parsed.success) return problem("VALIDATION_FAILED", "יש להזין קלט להרצה.");

  const guard = await guardApi(request, {
    action: "run.start",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;
  const orgId = guard.context.orgId;

  const agent = await getAgent(orgId, id);
  if (!agent) return problem("ORG_ACCESS_DENIED", "הסוכן לא נמצא.", guard.requestId);

  const validation = validateForPublish(agent.draftConfig, agent.name);
  if (!validation.ok) {
    return problem(
      "AGENT_CONFIG_INVALID",
      `לא ניתן לבדוק את הטיוטה: חסרים או שגויים השדות ${validation.fields.join(", ")}. שמרו את הטיוטה ונסו שוב.`,
      guard.requestId,
    );
  }
  const { provider, model } = agent.draftConfig;
  if (!isCatalogModel(provider, resolveModelId(model))) {
    return problem(
      "AGENT_CONFIG_INVALID",
      "הספק או המודל בטיוטה אינם נתמכים. בחרו ספק ומודל מהרשימה ושמרו.",
      guard.requestId,
    );
  }
  if (!isRuntimeConfigured()) {
    return problem(
      "RUNTIME_NOT_CONFIGURED",
      "סביבת ההרצה אינה מוגדרת בשרת, ולכן לא ניתן להריץ. לא נגבתה עלות.",
      guard.requestId,
    );
  }
  if (!isProviderConfigured(provider)) {
    return problem(
      "PROVIDER_NOT_CONFIGURED",
      "הספק שנבחר בטיוטה אינו מוגדר בסביבה הזו, ולכן לא ניתן להריץ. לא נגבתה עלות.",
      guard.requestId,
    );
  }

  await recoverStaleRuns(orgId);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("start_test_run", {
    p_agent_id: id,
    p_input: { prompt: parsed.data.prompt },
  });
  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }

  const dispatch = data as { run_id: string };
  // Best effort; the run page's /execute kick covers a cut-short after().
  after(async () => {
    await executeRun(dispatch.run_id, { expectedOrgId: orgId });
  });

  return okJson({ runId: dispatch.run_id });
}
