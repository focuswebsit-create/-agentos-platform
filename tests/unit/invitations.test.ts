// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  INVITATION_TOKEN_BYTES,
  buildInvitationUrl,
  createInvitationToken,
  hashInvitationToken,
  hashInvitationTokenLiteral,
  invitationExpiry,
  toByteaLiteral,
} from "@/modules/invitations/token";
import { getEmailSender, isAutomaticEmailEnabled } from "@/modules/invitations/email-sender";
import { safeNext } from "@/components/auth/safe-next";

describe("invitation tokens", () => {
  it("produces 256 bits of entropy, URL-safe", () => {
    const { token } = createInvitationToken();
    // base64url of 32 bytes is 43 characters with no padding.
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(INVITATION_TOKEN_BYTES).toBe(32);
  });

  it("never repeats a token", () => {
    const seen = new Set(Array.from({ length: 500 }, () => createInvitationToken().token));
    expect(seen.size).toBe(500);
  });

  it("stores a SHA-256 digest, never the token itself", () => {
    const { token, tokenHashLiteral } = createInvitationToken();
    const expected = createHash("sha256").update(token, "utf8").digest("hex");
    expect(tokenHashLiteral).toBe(`\\x${expected}`);
    // The raw token must not be recoverable from, or present in, what is stored.
    expect(tokenHashLiteral).not.toContain(token);
    expect(hashInvitationToken(token)).toHaveLength(32);
  });

  it("the digest is exactly 32 bytes, matching the CHECK constraint", () => {
    const literal = hashInvitationTokenLiteral("any-token-value");
    // "\x" + 64 hex characters
    expect(literal).toHaveLength(66);
    expect(literal.slice(2)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashing is deterministic, so a replayed link resolves to the same row", () => {
    expect(hashInvitationTokenLiteral("abc")).toBe(hashInvitationTokenLiteral("abc"));
    expect(hashInvitationTokenLiteral("abc")).not.toBe(hashInvitationTokenLiteral("abd"));
  });

  it("formats bytea the way PostgreSQL expects", () => {
    expect(toByteaLiteral(Buffer.from([0x00, 0xff, 0x10]))).toBe("\\x00ff10");
  });

  it("expires seven days out", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(invitationExpiry(now).toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  it("puts the token in the path, not the query string", () => {
    const url = buildInvitationUrl("https://app.example.test", "tok_abc");
    // Referrer-Policy strips the path when leaving the origin; a query string
    // would be handed to the next site the invitee visits.
    expect(url).toBe("https://app.example.test/invite/tok_abc");
    expect(new URL(url).search).toBe("");
  });

  it("escapes a token that would otherwise alter the path", () => {
    expect(buildInvitationUrl("https://x.test", "a/b?c")).toContain("a%2Fb%3Fc");
  });
});

describe("email sender", () => {
  it("reports honestly that nothing is delivered in P1", async () => {
    const sender = getEmailSender();
    expect(sender.name).toBe("none");
    expect(isAutomaticEmailEnabled()).toBe(false);
    await expect(sender.send({ to: "a@b.test", subject: "s", text: "t" })).resolves.toEqual({
      delivered: false,
      reason: "no_provider_configured",
    });
  });
});

describe("post-login redirect target", () => {
  it("keeps a same-origin relative path", () => {
    expect(safeNext("/app/team")).toBe("/app/team");
    expect(safeNext("/app?tab=1")).toBe("/app?tab=1");
  });

  it("refuses anything that could leave the origin", () => {
    // Each of these would otherwise bounce a freshly authenticated user to an
    // attacker-controlled look-alike.
    expect(safeNext("//evil.test")).toBe("/app");
    expect(safeNext("https://evil.test")).toBe("/app");
    expect(safeNext("http://evil.test")).toBe("/app");
    expect(safeNext("/\\evil.test")).toBe("/app");
    expect(safeNext("javascript:alert(1)")).toBe("/app");
    expect(safeNext(null)).toBe("/app");
    expect(safeNext("")).toBe("/app");
  });
});
