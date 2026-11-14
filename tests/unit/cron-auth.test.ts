// @vitest-environment node
//
// Not jsdom: these accessors refuse to run when `window` is defined, which is
// the guard doing its job — a server secret must never be read in a browser.
// jsdom defines `window`, so under the default environment every assertion
// below would pass for the wrong reason.
import { describe, expect, it } from "vitest";
import { hasCronSecret, matchesCronSecret } from "@/config/cron.server";

const GOOD = "a".repeat(32);

describe("cron secret", () => {
  it("is disabled when unset, so the endpoint 404s rather than standing open", () => {
    expect(hasCronSecret({})).toBe(false);
    expect(matchesCronSecret(GOOD, {})).toBe(false);
  });

  it("treats a short secret as absent", () => {
    // Short enough to brute force is the same as not configured. Accepting it
    // would leave the endpoint open behind a token someone picked in a hurry.
    const short = "abc";
    expect(hasCronSecret({ AGENTOS_CRON_SECRET: short })).toBe(false);
    expect(matchesCronSecret(short, { AGENTOS_CRON_SECRET: short })).toBe(false);
  });

  it("accepts the configured secret and nothing else", () => {
    const env = { AGENTOS_CRON_SECRET: GOOD };
    expect(hasCronSecret(env)).toBe(true);
    expect(matchesCronSecret(GOOD, env)).toBe(true);
    expect(matchesCronSecret("b".repeat(32), env)).toBe(false);
    expect(matchesCronSecret(GOOD + "x", env)).toBe(false);
    expect(matchesCronSecret(GOOD.slice(0, 31), env)).toBe(false);
  });

  it("refuses a missing or non-string token without throwing", () => {
    const env = { AGENTOS_CRON_SECRET: GOOD };
    expect(matchesCronSecret(null, env)).toBe(false);
    expect(matchesCronSecret(undefined, env)).toBe(false);
  });

  it("ignores surrounding whitespace in the configured value", () => {
    // A secret pasted into a dashboard field often arrives with a newline.
    expect(matchesCronSecret(GOOD, { AGENTOS_CRON_SECRET: `  ${GOOD}\n` })).toBe(true);
  });
});
