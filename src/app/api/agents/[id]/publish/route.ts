import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { getAgent } from "@/modules/agents/data";
import { validateForPublish } from "@/modules/contracts";
import { isCatalogModel } from "@/modules/agent-engine/model-registry";
import { resolveModelId } from "@/modules/agent-engine/rate-card";
import { isMockProviderEnabled } from "@/modules/agent-engine/registry";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";

const BodySchema = z.object({ orgId: z.uuid() });

/**
 * POST /api/agents/:id/publish — freeze the draft as a numbered version.
 *
 * Validation happens here, against the strict schema, because this is where a
 * useful error can be produced: the caller learns which fields are missing.
 * publish_agent_version() independently refuses an empty configuration — the
 * database's floor, not a substitute. QUALITY_GATES.md requires Zod at the
 * endpoint; the SQL check is what still holds if a future caller skips it.
 *
 * The RPC assigns the version number under a row lock, so two people publishing
 * at once queue rather than collide.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/agents/[id]/publish">,
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
    action: "agent.publish",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const agent = await getAgent(guard.context.orgId, id);
  if (!agent) {
    // Same answer whether the agent does not exist or belongs to someone else.
    return problem("ORG_ACCESS_DENIED", "לא נמצא סוכן לפרסום.", guard.requestId);
  }

  const validation = validateForPublish(agent.draftConfig, agent.name);
  if (!validation.ok) {
    return problem(
      "AGENT_CONFIG_INVALID",
      `לא ניתן לפרסם: חסרים או שגויים השדות ${validation.fields.join(", ")}.`,
      guard.requestId,
    );
  }

  // A version is immutable once published, so a provider/model pair nothing
  // can run must be caught here rather than discovered at the first run.
  const { provider, model } = agent.draftConfig;
  if (!isCatalogModel(provider, resolveModelId(model))) {
    return problem(
      "AGENT_CONFIG_INVALID",
      "לא ניתן לפרסם: הספק או המודל שנבחרו אינם נתמכים. בחרו ספק ומודל מהרשימה.",
      guard.requestId,
    );
  }
  // The simulation provider exists for development and tests. Publishing on it
  // where it is disabled would freeze a version that can never run.
  if (provider === "mock" && !isMockProviderEnabled()) {
    return problem(
      "AGENT_CONFIG_INVALID",
      "לא ניתן לפרסם על ספק הסימולציה: הוא אינו זמין בסביבה הזו.",
      guard.requestId,
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("publish_agent_version", { p_agent_id: id });

  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }

  return okJson(data as { version_id: string; version: number });
}
