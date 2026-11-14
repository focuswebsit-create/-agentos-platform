import "server-only";

/**
 * Model-provider API keys. Server-side only, one reader.
 *
 * A file of its own, for the same reason `cron.server.ts` is: the ESLint rings
 * in `eslint.config.mjs` give each secret exactly one module that may read it,
 * and a second secret added to an existing module would hand every importer of
 * the first one the second as well. Only `src/modules/agent-engine/providers/`
 * may import this file; lint fails anywhere else.
 *
 * The rules this keeps, every one of them a requirement rather than style:
 *
 *  - **Never `NEXT_PUBLIC_`.** A key under that prefix is inlined into the
 *    browser bundle at build time. A key found under such a name is refused,
 *    not used, so a mis-named variable fails closed instead of shipping.
 *  - **Never logged, never returned.** The value leaves this file only as the
 *    argument to the SDK constructor. Callers that need to know whether a key
 *    exists get a boolean.
 *  - **Never in a prompt.** Nothing here reaches the model; the provider builds
 *    the request from the agent's configuration and the user's input alone.
 */

type Source = Record<string, string | undefined>;

/** Shortest value accepted. A real Anthropic key is far longer; anything this short is a typo. */
const MIN_LENGTH = 20;

function read(source: Source): string | null {
  if (typeof window !== "undefined") return null;
  // A browser-exposed copy means the key has already leaked into a bundle.
  // Using the server copy would hide that; refusing makes it visible.
  if (source.NEXT_PUBLIC_ANTHROPIC_API_KEY) return null;
  const value = source.ANTHROPIC_API_KEY;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= MIN_LENGTH ? trimmed : null;
}

export function hasAnthropicApiKey(source: Source = process.env): boolean {
  return read(source) !== null;
}

/** For the SDK constructor only. Returns null rather than throwing when absent. */
export function getAnthropicApiKey(source: Source = process.env): string | null {
  return read(source);
}
