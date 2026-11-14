/**
 * Test stub for the `server-only` package.
 *
 * The real one throws when imported under a browser resolution, so that a
 * server module cannot end up in a client bundle. `next build` is what enforces
 * that for real, and it runs in CI on every push; this stub only stops the
 * guard from making server modules untestable under jsdom.
 *
 * Deliberately empty.
 */
export {};
