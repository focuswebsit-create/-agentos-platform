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
  // Two rings, because they are not the same question.
  //
  // Ring 1 - the secret itself. Only the module that constructs the client may
  // read it, so there is exactly one place where a BYPASSRLS credential enters
  // the process.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/config/env.server.ts", "src/modules/service-role/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/config/env.server",
              message:
                "Server-only secrets. Only src/modules/service-role/ reads them, and it is " +
                "the single construction site for the BYPASSRLS client.",
            },
          ],
        },
      ],
    },
  },
  // Ring 2 - the client. ARCHITECTURE.md names two authorities that need it and
  // they are different things: the platform-admin boundary, which reads across
  // tenants on purpose, and the execution plane, which writes run state and
  // spend that no customer may write. Both are listed; nothing else may.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/modules/service-role/**",
      "src/modules/platform-admin/**",
      "src/modules/runtime/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/service-role/client", "@/modules/service-role/client/*"],
              message:
                "The service-role Supabase client carries BYPASSRLS. Only the platform-admin " +
                "boundary and the execution plane (src/modules/runtime/) may construct it; " +
                "everywhere else, use their exported guards and audited methods.",
            },
          ],
        },
      ],
    },
  },
  // Ring 3 - model-provider API keys. Only the provider implementations may
  // read them, so a route, a page or a component cannot reach a key even by
  // accident. Callers that need to know whether a provider is ready ask the
  // registry, which answers with a boolean.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/config/provider-keys.server.ts", "src/modules/agent-engine/providers/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/config/provider-keys.server",
              message:
                "Model-provider API keys. Only src/modules/agent-engine/providers/ reads them; " +
                "ask the agent-engine registry whether a provider is configured instead.",
            },
          ],
        },
      ],
    },
  },
  // No module may read a secret straight out of process.env, bypassing the
  // validated accessor and its browser/naming guards.
  {
    files: ["src/**/*.{ts,tsx}"],
    // cron.server.ts and provider-keys.server.ts are the only other readers of
    // a server secret. Each is a separate file precisely so that whoever needs
    // one secret cannot also reach another (see their header comments).
    ignores: [
      "src/config/env.server.ts",
      "src/config/cron.server.ts",
      "src/config/provider-keys.server.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']" +
            "[property.name=/SECRET|SERVICE_ROLE|API_KEY/]",
          message:
            "Read secrets through their validated accessor (@/config/env.server, " +
            "cron.server or provider-keys.server), which refuses to run in the browser " +
            "and rejects browser-exposed names.",
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
