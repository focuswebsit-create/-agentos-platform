import { describe, expect, it } from "vitest";
import {
  ORG_ROLES,
  assignableRoles,
  can,
  canAssignRole,
  canManageMember,
} from "@/modules/tenancy/permissions";
import {
  isSecureOrigin,
  activeOrgCookieAttributes,
  csrfCookieAttributes,
} from "@/modules/tenancy/cookie";
import { isSameOriginRequest, timingSafeEqualHex, verifyCsrf } from "@/modules/tenancy/csrf";
import { isFreshOrgContext } from "@/modules/tenancy/context-shared";

/**
 * The server half of the permission model.
 *
 * These mirror the RLS policies, which tests/db/rls-suite.mjs proves
 * independently against a real PostgreSQL. If the two ever disagree, the
 * database wins and this file is wrong.
 */

describe("permission matrix", () => {
  it("every role may read the organisation and the member list", () => {
    for (const role of ORG_ROLES) {
      expect(can(role, "org.read")).toBe(true);
      expect(can(role, "member.list")).toBe(true);
    }
  });

  it("viewer and member cannot invite, see invitations or read the audit log", () => {
    for (const role of ["member", "viewer"] as const) {
      expect(can(role, "member.invite")).toBe(false);
      expect(can(role, "invitation.list")).toBe(false);
      expect(can(role, "audit.read")).toBe(false);
      expect(can(role, "org.update")).toBe(false);
    }
  });

  it("only the owner may suspend, transfer ownership or manage billing", () => {
    for (const action of ["org.suspend", "ownership.transfer", "billing.manage"] as const) {
      expect(can("owner", action)).toBe(true);
      expect(can("admin", action)).toBe(false);
      expect(can("member", action)).toBe(false);
      expect(can("viewer", action)).toBe(false);
    }
  });
});

describe("role assignment", () => {
  it("only an owner may create an admin", () => {
    expect(canAssignRole("owner", "admin")).toBe(true);
    expect(canAssignRole("admin", "admin")).toBe(false);
  });

  it("nobody may hand out owner — ownership is transferred, never granted", () => {
    for (const role of ORG_ROLES) {
      expect(assignableRoles(role)).not.toContain("owner");
    }
  });

  it("member and viewer may assign nothing at all", () => {
    expect(assignableRoles("member")).toHaveLength(0);
    expect(assignableRoles("viewer")).toHaveLength(0);
  });
});

describe("privilege escalation is blocked", () => {
  const owner = "00000000-0000-4000-8000-000000000001";
  const admin = "00000000-0000-4000-8000-000000000002";
  const member = "00000000-0000-4000-8000-000000000003";

  it("nobody can edit their own membership", () => {
    expect(
      canManageMember({
        actorRole: "admin",
        actorUserId: admin,
        targetRole: "admin",
        targetUserId: admin,
        nextRole: "owner",
      }),
    ).toBe(false);
    expect(
      canManageMember({
        actorRole: "owner",
        actorUserId: owner,
        targetRole: "owner",
        targetUserId: owner,
      }),
    ).toBe(false);
  });

  it("an admin cannot touch an owner", () => {
    expect(
      canManageMember({
        actorRole: "admin",
        actorUserId: admin,
        targetRole: "owner",
        targetUserId: owner,
        nextRole: "member",
      }),
    ).toBe(false);
  });

  it("an admin cannot promote anyone to admin", () => {
    expect(
      canManageMember({
        actorRole: "admin",
        actorUserId: admin,
        targetRole: "member",
        targetUserId: member,
        nextRole: "admin",
      }),
    ).toBe(false);
  });

  it("an admin may still manage a member", () => {
    expect(
      canManageMember({
        actorRole: "admin",
        actorUserId: admin,
        targetRole: "member",
        targetUserId: member,
        nextRole: "viewer",
      }),
    ).toBe(true);
  });

  it("an owner cannot mint a second owner outside transfer_ownership", () => {
    expect(
      canManageMember({
        actorRole: "owner",
        actorUserId: owner,
        targetRole: "member",
        targetUserId: member,
        nextRole: "owner",
      }),
    ).toBe(false);
  });

  it("member and viewer can manage nobody", () => {
    for (const role of ["member", "viewer"] as const) {
      expect(
        canManageMember({
          actorRole: role,
          actorUserId: member,
          targetRole: "viewer",
          targetUserId: owner,
        }),
      ).toBe(false);
    }
  });
});

describe("active-organisation cookie", () => {
  it("is httpOnly and SameSite=Lax", () => {
    const attrs = activeOrgCookieAttributes("https://app.example.test");
    expect(attrs.httpOnly).toBe(true);
    expect(attrs.sameSite).toBe("lax");
    expect(attrs.secure).toBe(true);
    expect(attrs.path).toBe("/");
  });

  it("drops Secure only on a plain-HTTP origin, so localhost still works", () => {
    expect(isSecureOrigin("http://localhost:3000")).toBe(false);
    expect(isSecureOrigin("https://app.example.test")).toBe(true);
    // Unknown or unparseable: assume HTTPS rather than weaken the cookie.
    expect(isSecureOrigin(undefined)).toBe(true);
    expect(isSecureOrigin("not a url")).toBe(true);
  });

  it("the CSRF cookie is readable by scripts, which is what double-submit needs", () => {
    expect(csrfCookieAttributes("https://x.test").httpOnly).toBe(false);
  });
});

describe("CSRF", () => {
  const base = {
    method: "POST",
    origin: "https://app.example.test",
    secFetchSite: "same-origin",
    selfOrigin: "https://app.example.test",
    cookieToken: "a".repeat(64),
    headerToken: "a".repeat(64),
  };

  it("accepts a well-formed same-origin POST", () => {
    expect(verifyCsrf(base).ok).toBe(true);
  });

  it("rejects anything that is not a POST", () => {
    expect(verifyCsrf({ ...base, method: "GET" })).toMatchObject({ reason: "method_not_allowed" });
  });

  it("rejects a cross-site request", () => {
    expect(verifyCsrf({ ...base, secFetchSite: "cross-site" })).toMatchObject({
      reason: "cross_origin",
    });
    expect(verifyCsrf({ ...base, secFetchSite: null, origin: "https://evil.test" })).toMatchObject({
      reason: "cross_origin",
    });
  });

  it("fails closed when the browser reveals no origin at all", () => {
    expect(verifyCsrf({ ...base, secFetchSite: null, origin: null })).toMatchObject({
      reason: "cross_origin",
    });
  });

  it("rejects a missing or mismatched token", () => {
    expect(verifyCsrf({ ...base, headerToken: null })).toMatchObject({ reason: "missing_token" });
    expect(verifyCsrf({ ...base, headerToken: "b".repeat(64) })).toMatchObject({
      reason: "token_mismatch",
    });
  });

  it("treats same-site as cross-origin: a sibling subdomain is not us", () => {
    expect(verifyCsrf({ ...base, secFetchSite: "same-site" }).ok).toBe(false);
  });

  it("compares tokens without leaking length or prefix", () => {
    expect(timingSafeEqualHex("abc", "abc")).toBe(true);
    expect(timingSafeEqualHex("abc", "abd")).toBe(false);
    expect(timingSafeEqualHex("abc", "abcd")).toBe(false);
    expect(timingSafeEqualHex("", "")).toBe(false);
  });

  it("same-origin detection handles a port and a trailing path", () => {
    expect(
      isSameOriginRequest({
        origin: "http://localhost:3000",
        secFetchSite: null,
        selfOrigin: "http://localhost:3000/app",
      }),
    ).toBe(true);
  });
});

describe("stale organisation context", () => {
  const a = "00000000-0000-4000-8000-0000000000aa";
  const b = "00000000-0000-4000-8000-0000000000bb";

  it("accepts a submission rendered against the active organisation", () => {
    expect(isFreshOrgContext(a, a)).toBe(true);
  });

  it("refuses a submission from a screen rendered for another organisation", () => {
    expect(isFreshOrgContext(b, a)).toBe(false);
  });

  it("refuses a submission that names no organisation at all", () => {
    expect(isFreshOrgContext(null, a)).toBe(false);
  });
});
