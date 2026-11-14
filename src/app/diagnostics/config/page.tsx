import type { Metadata } from "next";
import { connection } from "next/server";
import { ConfigReport } from "@/components/shared/config-report";
import { describeSupabasePublicEnv } from "@/config/env";

export const metadata: Metadata = {
  title: "Configuration diagnostics",
  robots: { index: false, follow: false },
};

/**
 * Why this page is reachable without signing in: it is the page you need when
 * you cannot sign in. Gating it behind a login would make it useless in the
 * only situation it exists for.
 *
 * Why that is safe: it shows four booleans about two variables that are shipped
 * to every browser by design, and never any part of a value. Whether a
 * deployment is configured is already visible — the sign-in screen says so in
 * words. This page only says which of the four possible reasons it is.
 *
 * `instant = false` keeps it out of the prerender, the same way every
 * authenticated route in this project does. A cached answer here would report
 * the configuration of whichever build produced the cache, which is the exact
 * confusion the page exists to clear up.
 */
export const instant = false;

export default async function ConfigDiagnosticsPage() {
  // Both are needed, and neither is enough alone. `instant = false` permits a
  // blocking route under cacheComponents; `connection()` is what actually ties
  // the render to a request, without which Next sees nothing dynamic here and
  // prerenders the page anyway — baking in the build's answer and destroying
  // the only thing this page is for.
  await connection();
  const server = describeSupabasePublicEnv();

  return (
    <main id="main" className="mx-auto w-full max-w-xl space-y-6 px-4 py-10 sm:px-6">
      <header className="space-y-1.5">
        <h1 className="text-xl font-bold tracking-tight">Configuration diagnostics</h1>
        <p className="text-sm text-muted-foreground">
          Public Supabase configuration, as the server sees it and as the browser sees it. No values
          are shown.
        </p>
      </header>
      <ConfigReport server={server} />
    </main>
  );
}
