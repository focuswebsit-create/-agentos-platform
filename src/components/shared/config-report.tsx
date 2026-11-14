"use client";

import * as React from "react";
import { describeSupabasePublicEnv, type PublicConfigReport } from "@/config/env";

/**
 * The browser's view of the public configuration, next to the server's.
 *
 * The disagreement between them IS the diagnosis, and it is the one failure
 * mode that cannot be seen any other way:
 *
 *   server yes / browser yes   — configured; a sign-in failure is elsewhere
 *   server yes / browser no    — the BUILD ran before the variables were set.
 *                                They are on the host and not in the bundle.
 *                                A restart cannot fix it; only a rebuild can.
 *   server no  / browser no    — the variables are genuinely absent.
 *   server no  / browser yes   — the host lost a variable the build had.
 *
 * `NEXT_PUBLIC_*` values are substituted into the bundle when the build runs,
 * because a browser has no `process.env` to read. The server, by contrast,
 * reads the live process. That is why the two can differ at all, and why
 * "the variable is set in the dashboard" and "the browser can sign in" are not
 * the same statement.
 *
 * Booleans only. No value, no fragment, no length, no prefix.
 */

const ROWS: Array<{ key: keyof PublicConfigReport; label: string }> = [
  { key: "urlConfigured", label: "URL configured" },
  { key: "urlValid", label: "URL valid" },
  { key: "publishableKeyConfigured", label: "Publishable key configured" },
  { key: "keyFormatValid", label: "Key format valid" },
];

function Mark({ value }: { value: boolean }) {
  return (
    <span className={value ? "text-success" : "text-destructive"} aria-label={String(value)}>
      {value ? "true" : "false"}
    </span>
  );
}

export function ConfigReport({ server }: { server: PublicConfigReport }) {
  // Computed in the browser, from whatever the build put in the bundle.
  const browser = React.useMemo(() => describeSupabasePublicEnv(), []);

  const serverOk = ROWS.every((r) => server[r.key]);
  const browserOk = ROWS.every((r) => browser[r.key]);

  const verdict = browserOk
    ? serverOk
      ? "Configured on both sides. A sign-in failure is not a configuration problem — check the Supabase project is running."
      : "The browser bundle has values the host does not. The host lost a variable the build had."
    : serverOk
      ? "THE BUILD RAN BEFORE THE VARIABLES WERE SET. They are present on the host but absent from the bundle, so the browser cannot sign in. A restart or a cached redeploy cannot fix this; the build has to run again with them present."
      : "The variables are absent on both sides. Set them for this environment, then rebuild.";

  return (
    <div className="space-y-4">
      <table className="w-full text-sm" data-testid="config-report">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 text-start font-medium">
              Check
            </th>
            <th scope="col" className="py-2 text-start font-medium">
              Server
            </th>
            <th scope="col" className="py-2 text-start font-medium">
              Browser
            </th>
          </tr>
        </thead>
        <tbody className="divide-y font-mono text-xs">
          {ROWS.map((row) => (
            <tr key={row.key}>
              <td className="py-2 font-sans">{row.label}</td>
              <td className="py-2">
                <Mark value={server[row.key]} />
              </td>
              <td className="py-2">
                <Mark value={browser[row.key]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p
        data-testid="config-verdict"
        className={
          browserOk
            ? "rounded-lg border border-success/30 bg-success/5 px-3.5 py-3 text-sm text-success"
            : "rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
        }
      >
        {verdict}
      </p>
    </div>
  );
}
