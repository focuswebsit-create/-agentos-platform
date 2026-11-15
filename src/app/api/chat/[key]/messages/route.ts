import { z } from "zod";
import {
  listMessages,
  MAX_VISITOR_MESSAGE_CHARS,
  postVisitorMessage,
} from "@/modules/runtime/chat";
import { chatError, KEY_PATTERN, sameOriginOrNone } from "../../_shared";

/** The agent's answer is produced inside this request. */
export const maxDuration = 300;

const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/);
const BodySchema = z.object({ content: z.string().trim().min(1).max(MAX_VISITOR_MESSAGE_CHARS) });

/** The visitor token travels in a header, never in the URL, so it stays out of access logs. */
function token(request: Request): string | null {
  const t = request.headers.get("x-visitor-token");
  return t && TokenSchema.safeParse(t).success ? t : null;
}

export async function GET(request: Request, context: RouteContext<"/api/chat/[key]/messages">) {
  const { key } = await context.params;
  const t = token(request);
  if (!KEY_PATTERN.test(key) || !t) return chatError("CONVERSATION_NOT_FOUND");
  if (!sameOriginOrNone(request)) return new Response(null, { status: 403 });

  const result = await listMessages(key, t);
  if (!result.ok) return chatError(result.error);
  return Response.json(
    { status: result.status, messages: result.messages },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request, context: RouteContext<"/api/chat/[key]/messages">) {
  const { key } = await context.params;
  const t = token(request);
  if (!KEY_PATTERN.test(key) || !t) return chatError("CONVERSATION_NOT_FOUND");
  if (!sameOriginOrNone(request)) return new Response(null, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "INVALID" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "INVALID" }, { status: 400 });

  const result = await postVisitorMessage(key, t, parsed.data.content);
  if (!result.ok) return chatError(result.error);
  return Response.json(
    { reply: result.reply, handoff: result.handoff },
    { headers: { "cache-control": "no-store" } },
  );
}
