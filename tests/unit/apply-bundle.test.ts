// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The bundle the owner pastes into the Supabase SQL Editor is GENERATED from
 * supabase/migrations/ by scripts/build-apply-bundle.sh, and committed.
 *
 * Committed-and-generated files drift. Someone edits a migration, the RLS
 * suite passes against the edited file, and the bundle still holds the old
 * text - so what gets applied to Supabase is not what was verified. These
 * tests fail the moment that happens.
 */

const BUNDLE = "supabase/apply/01_bundle_development.sql";
const migrations = readdirSync("supabase/migrations")
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

describe("the apply bundle", () => {
  const bundle = readFileSync(BUNDLE, "utf8");

  it("contains every migration, in numeric order", () => {
    let cursor = -1;
    for (const file of migrations) {
      const at = bundle.indexOf(`-- >>> ${file}`);
      expect(
        at,
        `${file} is missing from the bundle - run scripts/build-apply-bundle.sh`,
      ).toBeGreaterThan(-1);
      expect(at, `${file} is out of order in the bundle`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("is byte-identical to a fresh build from the current migrations", () => {
    // Regenerate into a scratch copy of the repository layout and compare. If
    // this fails, a migration changed after the bundle was built, and the file
    // the owner would apply is not the file the RLS suite verified.
    const scratch = mkdtempSync(join(tmpdir(), "bundle-"));
    execFileSync("bash", [
      "-c",
      `mkdir -p "${scratch}/supabase/apply" "${scratch}/scripts" &&
      cp -r supabase/migrations "${scratch}/supabase/" &&
      cp scripts/build-apply-bundle.sh "${scratch}/scripts/" &&
      bash "${scratch}/scripts/build-apply-bundle.sh" >/dev/null`,
    ]);
    const fresh = readFileSync(join(scratch, BUNDLE), "utf8");
    expect(fresh === bundle, "bundle is stale - run scripts/build-apply-bundle.sh and commit").toBe(
      true,
    );
  });

  it("is one transaction, guarded at both ends", () => {
    expect(bundle.match(/^begin;$/gm)).toHaveLength(1);
    expect(bundle.match(/^commit;$/gm)).toHaveLength(1);
    // Refuses to run onto an existing install, so it cannot be applied twice.
    expect(bundle).toContain("AgentOS is already installed in this database");
    // And rolls everything back if anon can execute anything afterwards.
    expect(bundle).toContain("post-check: anon can execute");
  });

  it("carries no credential, project reference or connection string", () => {
    expect(bundle).not.toMatch(/sb_secret_[A-Za-z0-9]|sb_publishable_[A-Za-z0-9]/);
    expect(bundle).not.toMatch(/[a-z0-9]{20}\.supabase\.co/);
    expect(bundle).not.toMatch(/postgres(ql)?:\/\/[^\s]*:[^\s]+@/);
  });
});

describe("the incremental file 0019-0022 (for a database that has 0001-0018)", () => {
  const FILE = "supabase/apply/03_incremental_0019_0022.sql";
  const incremental = readFileSync(FILE, "utf8");

  it("is byte-identical to a fresh build from the current migrations", () => {
    const scratch = mkdtempSync(join(tmpdir(), "incremental-"));
    execFileSync("bash", [
      "-c",
      `mkdir -p "${scratch}/supabase/apply" "${scratch}/scripts" &&
      cp -r supabase/migrations "${scratch}/supabase/" &&
      cp scripts/build-incremental-bundle.sh "${scratch}/scripts/" &&
      bash "${scratch}/scripts/build-incremental-bundle.sh" >/dev/null`,
    ]);
    const fresh = readFileSync(join(scratch, FILE), "utf8");
    expect(fresh === incremental, "stale - run scripts/build-incremental-bundle.sh").toBe(true);
  });

  it("contains exactly 0019-0022, in order, and nothing earlier", () => {
    let cursor = -1;
    for (const f of [
      "0019_settle_run_idempotent.sql",
      "0020_billing_entitlements.sql",
      "0021_test_runs.sql",
      "0022_knowledge.sql",
    ]) {
      const at = incremental.indexOf(`-- >>> ${f}`);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(incremental).not.toContain("-- >>> 0018_");
  });

  it("is one transaction, guarded at both ends", () => {
    expect(incremental.match(/^begin;$/gm)).toHaveLength(1);
    expect(incremental.match(/^commit;$/gm)).toHaveLength(1);
    expect(incremental).toContain("preflight: migrations 0001-0018 are not all present");
    expect(incremental).toContain("preflight: 0020-0022 are already");
    expect(incremental).toContain("post-check: anon can execute");
  });

  it("carries no credential or project reference", () => {
    expect(incremental).not.toMatch(/sb_secret_[A-Za-z0-9]|sb_publishable_[A-Za-z0-9]/);
    expect(incremental).not.toMatch(/[a-z0-9]{20}\.supabase\.co/);
  });
});

describe("the incremental file 0023-0024 (for a database that has 0001-0022)", () => {
  const FILE = "supabase/apply/04_incremental_0023_0024.sql";
  const incremental = readFileSync(FILE, "utf8");

  it("is byte-identical to a fresh build from the current migrations", () => {
    const scratch = mkdtempSync(join(tmpdir(), "incremental2-"));
    execFileSync("bash", [
      "-c",
      `mkdir -p "${scratch}/supabase/apply" "${scratch}/scripts" &&
      cp -r supabase/migrations "${scratch}/supabase/" &&
      cp scripts/build-incremental-0023-0024.sh "${scratch}/scripts/" &&
      bash "${scratch}/scripts/build-incremental-0023-0024.sh" >/dev/null`,
    ]);
    expect(readFileSync(join(scratch, FILE), "utf8") === incremental, "stale").toBe(true);
  });

  it("contains exactly 0023-0024, is one guarded transaction, and carries no credential", () => {
    expect(incremental.indexOf("-- >>> 0023_")).toBeGreaterThan(-1);
    expect(incremental.indexOf("-- >>> 0024_")).toBeGreaterThan(
      incremental.indexOf("-- >>> 0023_"),
    );
    expect(incremental).not.toContain("-- >>> 0022_");
    expect(incremental.match(/^begin;$/gm)).toHaveLength(1);
    expect(incremental.match(/^commit;$/gm)).toHaveLength(1);
    expect(incremental).toContain("post-check: anon can execute");
    expect(incremental).not.toMatch(/sb_secret_[A-Za-z0-9]|[a-z0-9]{20}\.supabase\.co/);
  });
});
