import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The regression these tests exist for.
 *
 * All five auth screens did this:
 *
 *     setPending(true);
 *     const supabase = createSupabaseBrowserClient();   // throws when unconfigured
 *     await supabase.auth.signInWithPassword(...);      // rejects on network failure
 *
 * Neither line was inside a try/catch. A throw from either became an unhandled
 * rejection, `setPending(false)` never ran, and the button sat on "רגע…"
 * forever with nothing on screen to explain it. On a deployment with no
 * NEXT_PUBLIC_SUPABASE_* variables that happened on the first click, every
 * time — which is exactly what was reported on the preview deployment.
 *
 * Every test below therefore asserts that `callAuth` RESOLVES. A rejection is
 * the bug.
 */

const mocks = vi.hoisted(() => ({ createSupabaseBrowserClient: vi.fn() }));
vi.mock("@/modules/supabase/browser", () => mocks);

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function load() {
  return import("@/components/auth/auth-client");
}

describe("callAuth", () => {
  it("resolves with the data on success", async () => {
    mocks.createSupabaseBrowserClient.mockReturnValue({ auth: {} });
    const { callAuth } = await load();
    const result = await callAuth(async () => ({ error: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toEqual({ error: null });
  });

  it("reports not_configured when the client cannot be built", async () => {
    // getSupabasePublicEnv() throws when the variables are missing. This is
    // the preview-deployment case, and the one that produced the stuck button.
    mocks.createSupabaseBrowserClient.mockImplementation(() => {
      throw new Error("Supabase public environment is invalid");
    });
    const { callAuth } = await load();
    const result = await callAuth(async () => "never reached");
    expect(result).toEqual({ ok: false, kind: "not_configured" });
  });

  it("reports network when the call rejects", async () => {
    mocks.createSupabaseBrowserClient.mockReturnValue({ auth: {} });
    const { callAuth } = await load();
    const result = await callAuth(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(result).toEqual({ ok: false, kind: "network" });
  });

  it("reports timeout instead of hanging forever", async () => {
    mocks.createSupabaseBrowserClient.mockReturnValue({ auth: {} });
    const { callAuth } = await load();
    // A promise that never settles is what a hung request looks like. Without
    // the race, this await would never return and the spinner would never stop.
    const result = await callAuth(() => new Promise(() => {}), 20);
    expect(result).toEqual({ ok: false, kind: "timeout" });
  });

  it("does not reject, whatever happens", async () => {
    mocks.createSupabaseBrowserClient.mockReturnValue({ auth: {} });
    const { callAuth } = await load();

    const outcomes = await Promise.allSettled([
      callAuth(async () => "ok"),
      callAuth(async () => {
        throw new Error("boom");
      }),
      callAuth(() => new Promise(() => {}), 10),
      callAuth(() => Promise.reject(new Error("rejected"))),
    ]);

    // The property the whole module exists for: the caller's `finally` always
    // runs, so the pending state always clears.
    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);
  });

  it("clears its timer when the call wins the race", async () => {
    mocks.createSupabaseBrowserClient.mockReturnValue({ auth: {} });
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const { callAuth } = await load();
    await callAuth(async () => "fast", 5_000);
    // A 5-second timer left behind on every keystroke-fast call would keep the
    // page alive and, under fake timers in a test suite, hang the run.
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

describe("authFailureMessage", () => {
  const errors = {
    notConfigured: "not configured",
    timeout: "timed out",
    network: "network",
  };

  it("maps each failure to its own message", async () => {
    const { authFailureMessage } = await load();
    expect(authFailureMessage({ ok: false, kind: "not_configured" }, errors)).toBe(
      "not configured",
    );
    expect(authFailureMessage({ ok: false, kind: "timeout" }, errors)).toBe("timed out");
    expect(authFailureMessage({ ok: false, kind: "network" }, errors)).toBe("network");
  });

  it("keeps not_configured distinct from network", async () => {
    const { authFailureMessage } = await load();
    // Retrying fixes a network failure and cannot fix a missing variable.
    // Collapsing them would tell the user to keep trying something that will
    // never work.
    expect(authFailureMessage({ ok: false, kind: "not_configured" }, errors)).not.toBe(
      authFailureMessage({ ok: false, kind: "network" }, errors),
    );
  });
});
