import { createHash, randomBytes } from "node:crypto";

/**
 * Invitation tokens.
 *
 * The raw token NEVER reaches the database. It is generated here, hashed here,
 * and only the digest crosses the boundary — so it cannot appear in
 * pg_stat_statements, in query logs, in an error detail, or in a database
 * backup. The column is `bytea` with a CHECK that the value is exactly 32
 * bytes, which makes storing a raw token structurally impossible.
 *
 * The raw value is returned to the caller exactly once, for the copy-link UI,
 * and is never persisted anywhere on our side.
 */

export const INVITATION_TOKEN_BYTES = 32;
export const INVITATION_TTL_DAYS = 7;

export type IssuedToken = {
  /** Shown once to the inviter. Never stored. */
  token: string;
  /** `\x…` hex literal, the wire form PostgreSQL accepts for bytea. */
  tokenHashLiteral: string;
};

export function hashInvitationToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** PostgREST sends bytea as a `\x`-prefixed hex string. */
export function toByteaLiteral(digest: Buffer): string {
  return `\\x${digest.toString("hex")}`;
}

export function hashInvitationTokenLiteral(token: string): string {
  return toByteaLiteral(hashInvitationToken(token));
}

export function createInvitationToken(): IssuedToken {
  // 256 bits from the platform CSPRNG. base64url keeps it URL-safe with no
  // escaping, so the link can be pasted anywhere without being mangled.
  const token = randomBytes(INVITATION_TOKEN_BYTES).toString("base64url");
  return { token, tokenHashLiteral: hashInvitationTokenLiteral(token) };
}

export function invitationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function buildInvitationUrl(siteUrl: string, token: string): string {
  // Path, not query string: `Referrer-Policy: strict-origin-when-cross-origin`
  // (set in next.config.ts) strips the path when leaving the origin, so the
  // token is not handed to third-party sites the invitee visits next.
  return new URL(`/invite/${encodeURIComponent(token)}`, siteUrl).toString();
}
