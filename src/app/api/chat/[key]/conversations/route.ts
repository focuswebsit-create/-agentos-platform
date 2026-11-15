import { openConversation } from "@/modules/runtime/chat";
import { chatError, clientIp, KEY_PATTERN, sameOriginOrNone } from "../../_shared";

/** POST /api/chat/:key/conversations — start a conversation; returns a visitor token once. */
export async function POST(
  request: Request,
  context: RouteContext<"/api/chat/[key]/conversations">,
) {
  const { key } = await context.params;
  if (!KEY_PATTERN.test(key)) return chatError("WIDGET_NOT_AVAILABLE");
  if (!sameOriginOrNone(request)) return new Response(null, { status: 403 });

  const result = await openConversation(key, clientIp(request));
  if (!result.ok) return chatError(result.error);
  return Response.json({ token: result.token }, { headers: { "cache-control": "no-store" } });
}
