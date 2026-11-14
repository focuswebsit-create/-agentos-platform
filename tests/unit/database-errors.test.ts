import { describe, expect, it } from "vitest";
import { mapDatabaseError } from "@/modules/api/respond";

/**
 * The regression: creating an organisation on a Supabase project with no
 * migrations applied answered "משהו השתבש. נסו שוב." — something went wrong,
 * try again.
 *
 * PostgREST had said exactly what was wrong. These are the literal bodies it
 * returned for this project, captured by a read-only probe:
 *
 *   PGRST205  Could not find the table 'public.organizations' in the schema cache
 *   PGRST202  Could not find the function public.create_organization(p_name, p_slug)
 *             in the schema cache
 *
 * mapDatabaseError matched on prose only, recognised neither, and fell through
 * to a generic "try again". Retrying could never have worked: the function did
 * not exist.
 */

const PGRST202 = {
  code: "PGRST202",
  message:
    "Could not find the function public.create_organization(p_name, p_slug) in the schema cache",
};
const PGRST205 = {
  code: "PGRST205",
  message: "Could not find the table 'public.organizations' in the schema cache",
};

describe("mapDatabaseError — an unprovisioned database", () => {
  it("maps a missing function to DATABASE_NOT_PROVISIONED", () => {
    expect(mapDatabaseError(PGRST202).code).toBe("DATABASE_NOT_PROVISIONED");
  });

  it("maps a missing table to DATABASE_NOT_PROVISIONED", () => {
    expect(mapDatabaseError(PGRST205).code).toBe("DATABASE_NOT_PROVISIONED");
  });

  it("maps the raw Postgres codes too, not only PostgREST's", () => {
    // undefined_table and undefined_function, for callers that reach Postgres
    // without going through PostgREST.
    expect(mapDatabaseError({ code: "42P01", message: "x" }).code).toBe("DATABASE_NOT_PROVISIONED");
    expect(mapDatabaseError({ code: "42883", message: "x" }).code).toBe("DATABASE_NOT_PROVISIONED");
  });

  it("matches on the code, so a reworded message still maps", () => {
    // PostgREST owns that prose and can change it in any release. The code is
    // the stable part of the contract.
    expect(mapDatabaseError({ code: "PGRST202", message: "anything at all" }).code).toBe(
      "DATABASE_NOT_PROVISIONED",
    );
  });

  it("does not tell the user to try again", () => {
    // The whole point. "נסו שוב" is advice that cannot work here.
    const { message } = mapDatabaseError(PGRST202);
    expect(message).not.toMatch(/נסו שוב\.?$/);
    expect(message).toContain("לא יעזור");
  });

  it("names no table, no function and no part of the driver's text", () => {
    const { message } = mapDatabaseError(PGRST202);
    expect(message).not.toContain("create_organization");
    expect(message).not.toContain("organizations");
    expect(message).not.toContain("schema cache");
    expect(message).not.toContain("PGRST");
  });

  it("still accepts a bare string, as older callers pass", () => {
    expect(mapDatabaseError("SEAT_LIMIT_REACHED").code).toBe("SEAT_LIMIT_REACHED");
    expect(mapDatabaseError(undefined).code).toBe("VALIDATION_FAILED");
  });

  it("leaves the existing mappings alone", () => {
    expect(mapDatabaseError({ message: "ORG_SLUG_TAKEN" }).code).toBe("ORG_SLUG_TAKEN");
    expect(mapDatabaseError({ message: "EMAIL_NOT_VERIFIED" }).code).toBe("EMAIL_NOT_VERIFIED");
    expect(mapDatabaseError({ message: "ORG_SUSPENDED" }).code).toBe("ORG_SUSPENDED");
  });
});
