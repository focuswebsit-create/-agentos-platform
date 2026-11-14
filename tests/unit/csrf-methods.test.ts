// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isMutationMethod, verifyCsrf } from "@/modules/tenancy/csrf";

/**
 * The regression: "הבקשה נדחתה מטעמי אבטחה" on every save in Agent Studio.
 *
 * verifyCsrf refused any method that was not POST. Seven endpoints use PATCH,
 * PUT or DELETE, so every legitimate request to them was rejected as a forgery
 * - saving an agent, saving its draft, organisation settings, changing a
 * member's role, removing a member, and two Super Admin actions. Publishing
 * failed with them, because the editor saves first.
 *
 * The existing tests sent POST and checked it passed, and sent GET and checked
 * it failed. Nothing ever sent a VALID PATCH. A check that rejects everything
 * but POST passes every one of those tests.
 */

const TOKEN = "a".repeat(64);
const valid = {
  origin: "https://agentos.test",
  secFetchSite: "same-origin",
  selfOrigin: "https://agentos.test",
  cookieToken: TOKEN,
  headerToken: TOKEN,
};

describe("verifyCsrf accepts every mutation method the API uses", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    it(`${method} with a valid token from the same origin is accepted`, () => {
      expect(verifyCsrf({ ...valid, method }).ok).toBe(true);
    });

    // The other half: accepting the method must not have relaxed anything else.
    it(`${method} with a mismatched token is still refused`, () => {
      expect(verifyCsrf({ ...valid, method, headerToken: "b".repeat(64) })).toMatchObject({
        ok: false,
        reason: "token_mismatch",
      });
    });

    it(`${method} from another site is still refused`, () => {
      expect(verifyCsrf({ ...valid, method, secFetchSite: "cross-site" })).toMatchObject({
        ok: false,
        reason: "cross_origin",
      });
    });

    it(`${method} with no token is still refused`, () => {
      expect(verifyCsrf({ ...valid, method, cookieToken: undefined })).toMatchObject({
        ok: false,
        reason: "missing_token",
      });
    });
  }

  it("treats the method case-insensitively", () => {
    expect(verifyCsrf({ ...valid, method: "patch" }).ok).toBe(true);
  });
});

describe("verifyCsrf still refuses the safe methods", () => {
  // The intent the original rule existed for: a navigation, a prefetch or an
  // <img src> must never change anything, even with a token present.
  for (const method of ["GET", "HEAD", "OPTIONS", "TRACE", "CONNECT", "PURGE"]) {
    it(`${method} is refused even with a valid token`, () => {
      expect(verifyCsrf({ ...valid, method })).toMatchObject({
        ok: false,
        reason: "method_not_allowed",
      });
    });
  }
});

/**
 * The systemic guard. Finds every route handler that runs a CSRF check and
 * asserts each HTTP method it exports is one the check accepts. This is the
 * test that would have caught the bug the day the first PATCH route was added,
 * and it catches the next one: a new route that exports a method the check
 * refuses fails here, by name.
 */
describe("every CSRF-checked route exports only methods the check accepts", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : name === "route.ts" ? [path] : [];
    });
  }

  const checked = walk("src/app/api").filter((file) => {
    const src = readFileSync(file, "utf8");
    return /mutation:\s*true|guardAdminApi\(|verifyCsrf\(/.test(src);
  });

  it("finds the routes it is meant to check", () => {
    // If this drops to zero the scan is broken, and every assertion below
    // would pass vacuously.
    expect(checked.length).toBeGreaterThan(10);
  });

  for (const file of checked) {
    const src = readFileSync(file, "utf8");
    const methods = [
      ...src.matchAll(/export async function (GET|HEAD|POST|PUT|PATCH|DELETE)\b/g),
    ].map((m) => m[1] ?? "");

    // GET is allowed to coexist on a route only if it does not run the check -
    // a guarded GET would always fail. None of the current routes do that.
    for (const method of methods) {
      it(`${file.replace("src/app/api/", "")} ${method} is a method the CSRF check accepts`, () => {
        expect(isMutationMethod(method), `${method} would always be refused by verifyCsrf`).toBe(
          true,
        );
      });
    }
  }
});

describe("allowedOrigins - switching between Vercel preview URLs", () => {
  // Every Vercel deployment has its own URL plus a branch alias, and
  // NEXT_PUBLIC_SITE_URL usually names production. Five copies of the old
  // helper returned the configured URL INSTEAD of the request's own origin, so
  // a browser that sends no Sec-Fetch-Site had its same-origin request
  // compared against production and refused.
  const withEnv = async (value: string | undefined, fn: () => void | Promise<void>) => {
    const prev = process.env.NEXT_PUBLIC_SITE_URL;
    if (value === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = value;
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = prev;
    }
  };

  const preview = "https://agentos-demo-git-feature-team.vercel.app";
  const production = "https://agentos.example";

  it("always includes the origin the request was sent to", async () => {
    const { allowedOrigins } = await import("@/modules/tenancy/csrf");
    await withEnv(production, () => {
      expect(allowedOrigins(new Request(`${preview}/api/agents`))).toContain(preview);
    });
  });

  it("also includes the configured site URL when it differs", async () => {
    const { allowedOrigins } = await import("@/modules/tenancy/csrf");
    await withEnv(production, () => {
      expect(allowedOrigins(new Request(`${preview}/api/agents`))).toEqual([preview, production]);
    });
  });

  it("does not duplicate an origin", async () => {
    const { allowedOrigins } = await import("@/modules/tenancy/csrf");
    await withEnv(preview, () => {
      expect(allowedOrigins(new Request(`${preview}/api/agents`))).toEqual([preview]);
    });
  });

  it("ignores a malformed configured value rather than trusting it", async () => {
    const { allowedOrigins } = await import("@/modules/tenancy/csrf");
    await withEnv("not a url", () => {
      expect(allowedOrigins(new Request(`${preview}/api/agents`))).toEqual([preview]);
    });
  });

  it("a preview request with no Sec-Fetch-Site now passes, where it used to fail", async () => {
    const { allowedOrigins } = await import("@/modules/tenancy/csrf");
    await withEnv(production, () => {
      const result = verifyCsrf({
        method: "PUT",
        origin: preview,
        secFetchSite: null,
        selfOrigin: allowedOrigins(new Request(`${preview}/api/agents/x/draft`)),
        cookieToken: TOKEN,
        headerToken: TOKEN,
      });
      expect(result.ok).toBe(true);
    });
  });

  it("an attacker's origin is still refused", async () => {
    const { allowedOrigins } = await import("@/modules/tenancy/csrf");
    await withEnv(production, () => {
      const result = verifyCsrf({
        method: "PUT",
        origin: "https://evil.test",
        secFetchSite: null,
        selfOrigin: allowedOrigins(new Request(`${preview}/api/agents/x/draft`)),
        cookieToken: TOKEN,
        headerToken: TOKEN,
      });
      expect(result).toMatchObject({ ok: false, reason: "cross_origin" });
    });
  });
});
