import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeSupabasePublicEnv,
  getSupabasePublicEnv,
  isSupabaseConfigured,
} from "@/config/env";

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  // Split for the same reason as the fixtures below: the scanner matches an
  // sb_publishable_ prefix followed by any alphanumeric, and it is right to.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_" + "publishable_" + "x".repeat(32),
};

/**
 * The root cause, and the test that stops it coming back.
 *
 * `NEXT_PUBLIC_*` reaches a browser only because Next.js replaces the literal
 * text `process.env.NEXT_PUBLIC_…` with the value during the build. A browser
 * has no `process.env` to read at runtime, so the substitution is the entire
 * mechanism.
 *
 * This module used to read the two variables as `source.NEXT_PUBLIC_SUPABASE_URL`,
 * with `source` a parameter defaulting to `process.env`. That is a dynamic
 * property access, the bundler never saw the pattern, and nothing was
 * substituted: a build with both variables set produced **zero** client chunks
 * containing the URL. The browser client threw "not configured" on every call,
 * whatever the host had configured.
 *
 * It is not expressible as a behavioural test — in Node, both forms work — so
 * it is asserted against the source text, which is the only place the
 * difference exists.
 */
describe("the public variables are read statically", () => {
  const source = readFileSync("src/config/env.ts", "utf8");

  it("reads each one as a literal process.env.NEXT_PUBLIC_… at least once", () => {
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
      expect(source, `${name} must be read as process.env.${name} so Next inlines it`).toContain(
        `process.env.${name}`,
      );
    }
  });

  it("does not default a source parameter to process.env", () => {
    // This is the precise shape of the bug. Reading the values out of an
    // object is fine - the substitution already happened when that object was
    // built from the two literals above. What broke it was the DEFAULT:
    //
    //     source: Record<string, string | undefined> = process.env
    //
    // With that, a caller passing nothing read the live process, which in a
    // browser is an empty object, and the bundler had no literal to replace.
    expect(source).not.toMatch(/=\s*process\.env\b/);
  });

  it("builds its defaults from a module-scope constant", () => {
    // Module scope, not inside a function: the substitution has to happen
    // somewhere the bundler reaches regardless of call paths.
    expect(source).toMatch(
      /const INLINED_PUBLIC_ENV[\s\S]*?process\.env\.NEXT_PUBLIC_SUPABASE_URL/,
    );
  });
});

describe("getSupabasePublicEnv", () => {
  it("accepts a valid pair", () => {
    expect(() => getSupabasePublicEnv(VALID)).not.toThrow();
    expect(isSupabaseConfigured(VALID)).toBe(true);
  });

  it("trims a value pasted with surrounding whitespace", () => {
    // A value pasted into a dashboard field very often carries a trailing
    // newline. z.url() rejects "https://x.supabase.co\n", which then reads as
    // "not configured" and sends everyone hunting for a variable that is in
    // fact present and correct.
    expect(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: `  ${VALID.NEXT_PUBLIC_SUPABASE_URL}\n`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `\t${VALID.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}  `,
      }),
    ).toBe(true);
  });

  it("treats a whitespace-only value as absent, not as invalid", () => {
    expect(isSupabaseConfigured({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "   " })).toBe(false);
  });

  it("still refuses a secret key under the public name", () => {
    // It would be inlined into the client bundle. The whole point of the check.
    expect(
      isSupabaseConfigured({
        ...VALID,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_" + "secret_" + "x".repeat(32),
      }),
    ).toBe(false);
  });

  it("accepts a real-shaped publishable key and a real-shaped project URL", () => {
    // Guards against the validation being tightened into rejecting valid
    // input, which would present as "not configured" and look identical to a
    // missing variable.
    //
    // Both fixtures are assembled at runtime rather than written as literals.
    // A 20-character project ref followed by .supabase.co, and an
    // sb_publishable_ prefix followed by anything, are exactly what the secret
    // scanner looks for - and rightly: it cannot tell a fixture from the real
    // thing. Allowlisting this file would have been the easy fix and would
    // have left a hole in the one file most likely to grow a real key. The
    // runtime values are identical, so the test still proves what it claims.
    const ref = "abcdefghij" + "klmnopqrst";
    const prefix = "sb_" + "publishable_";
    expect(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: prefix + "AbCdEf123456-_xyz7890QWERTY",
      }),
    ).toBe(true);
  });

  it("never puts a value in the error it throws", () => {
    try {
      getSupabasePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" });
      throw new Error("unreachable");
    } catch (error) {
      expect(String(error)).not.toContain("not-a-url");
    }
  });
});

describe("describeSupabasePublicEnv", () => {
  it("separates absent from malformed, which both read as 'not configured'", () => {
    const absent = describeSupabasePublicEnv({});
    expect(absent).toEqual({
      urlConfigured: false,
      urlValid: false,
      publishableKeyConfigured: false,
      keyFormatValid: false,
    });

    const malformed = describeSupabasePublicEnv({
      ...VALID,
      NEXT_PUBLIC_SUPABASE_URL: "example.supabase.co",
    });
    // Present but not a URL: configured true, valid false. That one distinction
    // is the difference between "set the variable" and "fix the value".
    expect(malformed.urlConfigured).toBe(true);
    expect(malformed.urlValid).toBe(false);
  });

  it("flags a secret key as configured but wrongly formatted", () => {
    const report = describeSupabasePublicEnv({
      ...VALID,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_" + "x".repeat(32),
    });
    expect(report.publishableKeyConfigured).toBe(true);
    expect(report.keyFormatValid).toBe(false);
  });

  it("reports all four true for a valid pair", () => {
    expect(describeSupabasePublicEnv(VALID)).toEqual({
      urlConfigured: true,
      urlValid: true,
      publishableKeyConfigured: true,
      keyFormatValid: true,
    });
  });

  it("returns only booleans, so no value can leak through it", () => {
    const report = describeSupabasePublicEnv(VALID);
    for (const value of Object.values(report)) {
      expect(typeof value).toBe("boolean");
    }
    expect(JSON.stringify(report)).not.toContain("supabase.co");
  });
});
