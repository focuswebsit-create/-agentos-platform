import "server-only";
import type { createServiceRoleClient } from "@/modules/service-role/client";
import { searchQueryFrom, type RetrievedChunk } from "@/modules/knowledge/text";

/**
 * Retrieval for a run, on the execution plane.
 *
 * Runs with the service role, so tenancy is enforced HERE, explicitly: every
 * query is filtered to the run's organisation, and the knowledge-base ids come
 * from the agent's pinned configuration. A configuration naming another
 * organisation's knowledge base retrieves nothing - the org filter excludes it
 * before the id filter is even considered.
 *
 * Best effort by design. If 0022 is not installed, or the search fails, the
 * run proceeds without knowledge and the trace records that, rather than the
 * run failing over a missing reference.
 */

const MAX_CHUNKS = 6;

type Db = ReturnType<typeof createServiceRoleClient>;

export type Retrieval = {
  chunks: RetrievedChunk[];
  status: "ok" | "none_configured" | "unavailable";
};

export async function retrieveKnowledge(
  db: Db,
  orgId: string,
  knowledgeBaseIds: readonly string[],
  question: string,
): Promise<Retrieval> {
  if (knowledgeBaseIds.length === 0) return { chunks: [], status: "none_configured" };
  const query = searchQueryFrom(question);
  if (!query) return { chunks: [], status: "ok" };

  try {
    const { data, error } = await db
      .from("knowledge_chunks")
      .select("content, document_id")
      .eq("org_id", orgId)
      .in("knowledge_base_id", [...knowledgeBaseIds])
      .textSearch("tsv", query, { config: "simple", type: "websearch" })
      .limit(MAX_CHUNKS);
    if (error) return { chunks: [], status: "unavailable" };

    const rows = (data ?? []) as Array<{ content: string; document_id: string }>;
    if (rows.length === 0) return { chunks: [], status: "ok" };

    const ids = [...new Set(rows.map((r) => r.document_id))];
    const { data: docs } = await db
      .from("knowledge_documents")
      .select("id, title")
      .eq("org_id", orgId)
      .in("id", ids);
    const titles = new Map(
      ((docs ?? []) as Array<{ id: string; title: string }>).map((d) => [d.id, d.title]),
    );

    return {
      chunks: rows.map((r) => ({
        title: titles.get(r.document_id) ?? "document",
        content: r.content,
      })),
      status: "ok",
    };
  } catch {
    return { chunks: [], status: "unavailable" };
  }
}
