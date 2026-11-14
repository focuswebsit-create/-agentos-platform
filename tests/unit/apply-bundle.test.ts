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
