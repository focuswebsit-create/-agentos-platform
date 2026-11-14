import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` ships a browser build that throws on import, which is the
      // whole point of it. Under the jsdom environment every server module
      // would therefore be untestable, and the usual workaround - dropping the
      // import from the module - would trade a real production guarantee for a
      // test convenience.
      //
      // Stubbing it here loses nothing: the guarantee is enforced by
      // `next build`, which fails if a server-only module reaches a client
      // bundle, and that runs in CI on every push.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
