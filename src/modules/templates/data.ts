import "server-only";
import { createSupabaseServerClient } from "@/modules/supabase/server";

/**
 * Reads for the template catalog.
 *
 * Unlike every other data module here, these queries carry no org filter —
 * templates are platform data, shared by every tenant, and there is no org_id
 * to filter on. What limits them is the policy in 0011: a customer sees a
 * published version of a public template and nothing else, so a draft the
 * platform is still writing returns no row rather than being merely unlisted.
 */

export type CatalogTemplate = {
  id: string;
  slug: string;
  category: string;
  name: string;
  description: string;
  activeVersionId: string;
  requiredTools: string[];
};

type TemplateRow = {
  id: string;
  slug: string;
  category: string;
  name: string;
  description: string;
  active_version_id: string | null;
};

export async function listTemplates(): Promise<CatalogTemplate[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("global_templates")
    .select("id, slug, category, name, description, active_version_id")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error || !data) return [];
  const rows = data as unknown as TemplateRow[];

  // A public template whose active version is not set is not installable, and
  // offering it would produce a button that always fails.
  const withVersion = rows.filter(
    (r): r is TemplateRow & { active_version_id: string } => r.active_version_id !== null,
  );
  if (withVersion.length === 0) return [];

  const { data: versions } = await supabase
    .from("global_template_versions")
    .select("id, required_tools")
    .in(
      "id",
      withVersion.map((r) => r.active_version_id),
    );

  const tools = new Map<string, string[]>();
  for (const v of (versions ?? []) as unknown as Array<{ id: string; required_tools: unknown }>) {
    tools.set(v.id, Array.isArray(v.required_tools) ? v.required_tools.map(String) : []);
  }

  // The version must be readable too. If the policy hid it — a template marked
  // public whose active version was never published — the row is dropped rather
  // than shown with an install button that cannot work.
  return withVersion
    .filter((r) => tools.has(r.active_version_id))
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      category: r.category,
      name: r.name,
      description: r.description,
      activeVersionId: r.active_version_id,
      requiredTools: tools.get(r.active_version_id) ?? [],
    }));
}
