import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  // tests/db/ holds standalone database verification runners executed with
  // `node`, not through vitest. Printing their PASS/FAIL report to stdout is
  // the entire point, so `no-console` is lifted here and nowhere else.
  {
    files: ["tests/db/**/*.{mjs,ts}"],
    rules: { "no-console": "off" },
  },
  // Containment of the service-role credential (SECURITY.md 7, CLAUDE.md 5 and 9).
  //
  // The Supabase secret key carries BYPASSRLS and is the only credential able to read
  // across tenants. Keeping it out of customer-reachable code is enforced here rather
  // than left to review discipline. The allowlist below is the complete set of files
  // permitted to touch it.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/config/env.server.ts", "src/modules/platform-admin/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/config/env.server",
              message:
                "Server-only secrets. Import it from src/modules/platform-admin/ only, " +
                "where every service-role read is org-filtered and audited.",
            },
          ],
          patterns: [
            {
              group: ["@/modules/platform-admin/client", "@/modules/platform-admin/client/*"],
              message:
                "The service-role Supabase client is internal to src/modules/platform-admin/. " +
                "Use its exported guards and audited service methods instead.",
            },
          ],
        },
      ],
    },
  },
  // No module may read the secret key straight out of process.env, bypassing the
  // validated accessor and its browser/naming guards.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/config/env.server.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']" +
            "[property.name=/SECRET|SERVICE_ROLE/]",
          message:
            "Read secrets through getSupabaseSecretEnv() in @/config/env.server, which " +
            "refuses to run in the browser and rejects browser-exposed names.",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
