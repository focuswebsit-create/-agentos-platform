import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { guardApi } from "@/modules/api/guard";
import { mapDatabaseError, okJson, problem } from "@/modules/api/respond";
import {
  ALLOWED_MIME_TYPES,
  MAX_CHUNKS,
  MAX_DOCUMENT_BYTES,
  chunkText,
  sanitizeText,
} from "@/modules/knowledge/text";

const BodySchema = z.object({
  orgId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  sourceType: z.enum(["upload", "paste"]),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  // Characters, a first bound before the byte check below.
  content: z.string().min(1).max(MAX_DOCUMENT_BYTES),
});

/**
 * POST /api/knowledge/:id/documents — add a text or markdown document.
 *
 * Upload safety, in order: an allow-list of two text MIME types; the content
 * arrives as a JSON string (never a stored file, never executed or rendered as
 * HTML); control characters are stripped; the UTF-8 size is bounded at 512 KB;
 * chunking happens here, and the document and its chunks are written by one
 * function in one transaction, which re-checks the caller's role.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/knowledge/[id]/documents">,
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problem("VALIDATION_FAILED", "מזהה מאגר לא תקין.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem("VALIDATION_FAILED", "בקשה לא תקינה.");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return problem(
      "VALIDATION_FAILED",
      "המסמך חייב להיות טקסט או Markdown, עם כותרת, ובגודל של עד 512KB.",
    );
  }

  const guard = await guardApi(request, {
    action: "knowledge.write",
    mutation: true,
    submittedOrgId: parsed.data.orgId,
  });
  if (!guard.ok) return guard.response;

  const text = sanitizeText(parsed.data.content);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes === 0 || bytes > MAX_DOCUMENT_BYTES) {
    return problem("VALIDATION_FAILED", "המסמך ריק או גדול מ-512KB.", guard.requestId);
  }
  const chunks = chunkText(text);
  if (chunks.length === 0 || chunks.length > MAX_CHUNKS) {
    return problem("VALIDATION_FAILED", "לא ניתן לפצל את המסמך לקטעים.", guard.requestId);
  }

  const supabase = await createSupabaseServerClient();
  const sha = createHash("sha256").update(text).digest("hex");
  const { data, error } = await supabase.rpc("add_knowledge_document", {
    p_knowledge_base_id: id,
    p_title: parsed.data.title,
    p_source_type: parsed.data.sourceType,
    p_mime_type: parsed.data.mimeType,
    p_byte_size: bytes,
    // PostgREST takes bytea as hex with the \x prefix.
    p_content_sha256: `\\x${sha}`,
    p_chunks: chunks,
  });
  if (error) {
    const mapped = mapDatabaseError(error);
    return problem(mapped.code, mapped.message, guard.requestId);
  }
  return okJson({ id: data as string, chunks: chunks.length });
}
