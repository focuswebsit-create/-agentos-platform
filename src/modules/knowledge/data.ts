import "server-only";
import { createSupabaseServerClient } from "@/modules/supabase/server";

/** Reads for the knowledge screens, as the signed-in user under RLS. */

export type KnowledgeDocument = {
  id: string;
  title: string;
  chunkCount: number;
  byteSize: number;
  createdAt: string;
};
export type KnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  documents: KnowledgeDocument[];
};

export type KnowledgeList =
  { ok: true; bases: KnowledgeBase[] } | { ok: false; reason: "not_provisioned" | "error" };

const MISSING = ["PGRST205", "42P01"];

export async function listKnowledgeBases(orgId: string): Promise<KnowledgeList> {
  const supabase = await createSupabaseServerClient();
  const { data: bases, error } = await supabase
    .from("knowledge_bases")
    .select("id, name, description")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) {
    return {
      ok: false,
      reason: MISSING.includes(String(error.code)) ? "not_provisioned" : "error",
    };
  }

  const { data: docs } = await supabase
    .from("knowledge_documents")
    .select("id, knowledge_base_id, title, chunk_count, byte_size, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  const byBase = new Map<string, KnowledgeDocument[]>();
  for (const d of (docs ?? []) as Array<Record<string, unknown>>) {
    const list = byBase.get(String(d.knowledge_base_id)) ?? [];
    list.push({
      id: String(d.id),
      title: String(d.title),
      chunkCount: Number(d.chunk_count),
      byteSize: Number(d.byte_size),
      createdAt: String(d.created_at),
    });
    byBase.set(String(d.knowledge_base_id), list);
  }

  return {
    ok: true,
    bases: ((bases ?? []) as Array<{ id: string; name: string; description: string | null }>).map(
      (b) => ({ ...b, documents: byBase.get(b.id) ?? [] }),
    ),
  };
}

/** Id and name only - for the agent editor's knowledge selector. */
export async function listKnowledgeBaseOptions(
  orgId: string,
): Promise<Array<{ id: string; name: string }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("knowledge_bases")
    .select("id, name")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  return error ? [] : ((data ?? []) as Array<{ id: string; name: string }>);
}
