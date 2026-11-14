import "server-only";
import { createServiceRoleClient } from "@/modules/service-role/client";
import { AgentConfigSchema } from "@/modules/contracts";
import { auditOrRefuse, type PlatformAdmin } from "./guard";

/**
 * Publishing the global template catalog.
 *
 * `SUPER_ADMIN.md`: "global read-only template revisions, staged publishing and
 * rollback; never silently override customers' pinned versions."
 *
 * The last clause is already structural rather than a rule to remember:
 * installing a template copies it (`install_template()` in 0012), so an
 * organisation's agent has no link back to the template version it came from
 * and nothing here can reach it. Retiring, republishing and rolling back all
 * leave existing installations untouched, and the RLS suite tests that.
 *
 * Every function below writes an audit record before it returns, through
 * `auditOrRefuse`: these are the writes that change what every tenant is
 * offered, so an unlogged one is the least acceptable kind.
 */

export type AdminTemplateVersion = {
  id: string;
  version: number;
  publishedAt: string | null;
  isActive: boolean;
};

export type AdminTemplate = {
  id: string;
  slug: string;
  category: string;
  name: string;
  description: string;
  visibility: "draft" | "public" | "retired";
  activeVersionId: string | null;
  versions: AdminTemplateVersion[];
};

type TemplateRow = {
  id: string;
  slug: string;
  category: string;
  name: string;
  description: string;
  visibility: "draft" | "public" | "retired";
  active_version_id: string | null;
};

/** The whole catalog, every visibility. Customers see only `public`. */
export async function adminListTemplates(admin: PlatformAdmin): Promise<AdminTemplate[]> {
  const db = createServiceRoleClient();

  const { data, error } = await db
    .from("global_templates")
    .select("id, slug, category, name, description, visibility, active_version_id")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error || !data) return [];
  const templates = data as TemplateRow[];

  const { data: versionData } = await db
    .from("global_template_versions")
    .select("id, template_id, version, published_at")
    .order("version", { ascending: false, nullsFirst: true });

  const byTemplate = new Map<string, AdminTemplateVersion[]>();
  for (const v of (versionData ?? []) as Array<{
    id: string;
    template_id: string;
    version: number | null;
    published_at: string | null;
  }>) {
    const list = byTemplate.get(v.template_id) ?? [];
    list.push({
      id: v.id,
      version: v.version ?? 0,
      publishedAt: v.published_at,
      isActive: false,
    });
    byTemplate.set(v.template_id, list);
  }

  await auditOrRefuse({
    actorUserId: admin.userId,
    action: "admin.templates.list",
    entityType: "global_template",
    metadata: { returned: templates.length },
  });

  return templates.map((t) => ({
    id: t.id,
    slug: t.slug,
    category: t.category,
    name: t.name,
    description: t.description,
    visibility: t.visibility,
    activeVersionId: t.active_version_id,
    versions: (byTemplate.get(t.id) ?? []).map((v) => ({
      ...v,
      isActive: v.id === t.active_version_id,
    })),
  }));
}

export type CatalogResult = { ok: true; id: string } | { ok: false; code: string };

/**
 * A new template, created `draft` and invisible to every customer.
 *
 * Staged publishing means a template exists before anyone can install it. The
 * default is not a convenience — a template that went live the moment it was
 * created would make every typo a release.
 */
export async function adminCreateTemplate(
  admin: PlatformAdmin,
  input: { slug: string; category: string; name: string; description: string },
): Promise<CatalogResult> {
  const db = createServiceRoleClient();

  const { data, error } = await db
    .from("global_templates")
    .insert({
      slug: input.slug.toLowerCase().trim(),
      category: input.category.trim(),
      name: input.name.trim(),
      description: input.description.trim(),
      visibility: "draft",
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, code: error?.code === "23505" ? "SLUG_TAKEN" : "WRITE_FAILED" };
  }
  const id = (data as { id: string }).id;

  await auditOrRefuse({
    actorUserId: admin.userId,
    action: "admin.template.created",
    entityType: "global_template",
    entityId: id,
    metadata: { slug: input.slug },
  });

  return { ok: true, id };
}

/**
 * Add a version and publish it, then point the template at it.
 *
 * Published immediately because an unpublished global version has no reader:
 * the SELECT policy in 0011 hides it, `install_template()` refuses it, and
 * there is no preview surface. A version nobody can see is not a stage, it is
 * a dead row.
 *
 * The definition is validated against `AgentConfigSchema` here rather than in
 * the route, because this is the function that decides what every tenant can
 * install. `name` is injected so the schema is satisfied and then dropped from
 * what is stored — `install_template()` strips it anyway, and keeping a stale
 * copy would resurface it after a rename.
 */
export async function adminPublishVersion(
  admin: PlatformAdmin,
  input: { templateId: string; definition: unknown; requiredTools: string[] },
): Promise<CatalogResult> {
  const db = createServiceRoleClient();

  const { data: templateData } = await db
    .from("global_templates")
    .select("id, name")
    .eq("id", input.templateId)
    .maybeSingle();

  if (!templateData) return { ok: false, code: "TEMPLATE_NOT_FOUND" };
  const template = templateData as { id: string; name: string };

  const parsed = AgentConfigSchema.safeParse({
    ...(typeof input.definition === "object" && input.definition !== null ? input.definition : {}),
    name: template.name,
  });
  if (!parsed.success) return { ok: false, code: "DEFINITION_INVALID" };

  // The name is injected above only to satisfy the schema, then dropped:
  // install_template() strips it from the copy anyway, and a stale copy inside
  // the definition would resurface after the template is renamed.
  const definition = { ...parsed.data, name: undefined };
  delete (definition as { name?: unknown }).name;

  const { data: existing } = await db
    .from("global_template_versions")
    .select("version")
    .eq("template_id", input.templateId)
    .not("version", "is", null)
    .order("version", { ascending: false })
    .limit(1);

  const next =
    ((existing ?? []) as Array<{ version: number }>).reduce(
      (max, r) => Math.max(max, r.version),
      0,
    ) + 1;

  const { data: versionData, error } = await db
    .from("global_template_versions")
    .insert({
      template_id: input.templateId,
      version: next,
      definition_json: definition,
      required_tools: input.requiredTools,
      published_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error || !versionData) return { ok: false, code: "WRITE_FAILED" };
  const versionId = (versionData as { id: string }).id;

  const { error: pointError } = await db
    .from("global_templates")
    .update({ active_version_id: versionId })
    .eq("id", input.templateId);

  // The version exists either way; only the pointer failed. Saying so beats a
  // generic failure that leaves an administrator unsure whether to retry and
  // create a duplicate version.
  if (pointError) return { ok: false, code: "ACTIVATION_FAILED" };

  await auditOrRefuse({
    actorUserId: admin.userId,
    action: "admin.template.version_published",
    entityType: "global_template_version",
    entityId: versionId,
    metadata: { template_id: input.templateId, version: next },
  });

  return { ok: true, id: versionId };
}

/**
 * Change what customers can see.
 *
 * `retired` removes a template from the catalog without touching anything an
 * organisation already installed — those are copies. Going back to `public`
 * requires an active version, because a public template with nothing to
 * install is a catalog entry whose only behaviour is to fail.
 */
export async function adminSetVisibility(
  admin: PlatformAdmin,
  input: { templateId: string; visibility: "draft" | "public" | "retired" },
): Promise<CatalogResult> {
  const db = createServiceRoleClient();

  const { data: templateData } = await db
    .from("global_templates")
    .select("id, active_version_id")
    .eq("id", input.templateId)
    .maybeSingle();

  if (!templateData) return { ok: false, code: "TEMPLATE_NOT_FOUND" };
  const template = templateData as { id: string; active_version_id: string | null };

  if (input.visibility === "public" && template.active_version_id === null) {
    return { ok: false, code: "NO_ACTIVE_VERSION" };
  }

  const { error } = await db
    .from("global_templates")
    .update({ visibility: input.visibility })
    .eq("id", input.templateId);

  if (error) return { ok: false, code: "WRITE_FAILED" };

  await auditOrRefuse({
    actorUserId: admin.userId,
    action: "admin.template.visibility_changed",
    entityType: "global_template",
    entityId: input.templateId,
    metadata: { visibility: input.visibility },
  });

  return { ok: true, id: input.templateId };
}

/**
 * Roll back to an earlier published version.
 *
 * Moves the pointer; it does not delete or rewrite the newer version, which
 * `global_template_versions_guard` would refuse anyway. The newer one stays in
 * the history, which is what makes a rollback reversible.
 */
export async function adminRollback(
  admin: PlatformAdmin,
  input: { templateId: string; versionId: string },
): Promise<CatalogResult> {
  const db = createServiceRoleClient();

  const { data } = await db
    .from("global_template_versions")
    .select("id, version, published_at")
    .eq("id", input.versionId)
    .eq("template_id", input.templateId)
    .maybeSingle();

  const version = data as {
    id: string;
    version: number | null;
    published_at: string | null;
  } | null;
  // Both conditions matter: a version of another template would be refused by
  // the composite key anyway, and an unpublished one is not installable, so
  // pointing at it would make the template publicly broken.
  if (!version || version.published_at === null) return { ok: false, code: "VERSION_NOT_ELIGIBLE" };

  const { error } = await db
    .from("global_templates")
    .update({ active_version_id: input.versionId })
    .eq("id", input.templateId);

  if (error) return { ok: false, code: "WRITE_FAILED" };

  await auditOrRefuse({
    actorUserId: admin.userId,
    action: "admin.template.rolled_back",
    entityType: "global_template",
    entityId: input.templateId,
    metadata: { version_id: input.versionId, version: version.version },
  });

  return { ok: true, id: input.templateId };
}
