"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { sendJson } from "@/components/auth/api-client";
import type { Dictionary } from "@/i18n";

/**
 * Keeps a live run's page current, and makes sure a queued run gets executed.
 *
 * Polling: while the run is queued or running, the server component is
 * re-rendered every few seconds. The server is the truth; this only asks again.
 *
 * The kick: execution starts in the dispatch request's `after()`, which a
 * serverless platform may cut short. If the run is still queued a few seconds
 * after it was created, this calls /api/runs/:id/execute ONCE. That request
 * stays open for the whole execution. The server claims the run atomically, so
 * a kick that races the original worker cannot execute it twice.
 */

const POLL_MS = 2_500;
const KICK_AFTER_MS = 4_000;
const STUCK_AFTER_MS = 60_000;

export function RunLiveWatcher({
  t,
  orgId,
  runId,
  status,
  createdAt,
  canKick,
}: {
  t: Dictionary;
  orgId: string;
  runId: string;
  status: "queued" | "running" | "awaiting_approval";
  createdAt: string;
  /** Viewers may watch, but only roles that may start runs may kick one. */
  canKick: boolean;
}) {
  const router = useRouter();
  const kicked = React.useRef(false);
  const [kicking, setKicking] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  const age = now - new Date(createdAt).getTime();

  React.useEffect(() => {
    if (status !== "queued" || !canKick || kicked.current || age < KICK_AFTER_MS) return;
    kicked.current = true;
    setKicking(true);
    void sendJson(`/api/runs/${runId}/execute`, "POST", { orgId }).finally(() => {
      setKicking(false);
      router.refresh();
    });
  }, [status, canKick, age, orgId, runId, router]);

  const message =
    status === "running"
      ? t.runs.live.running
      : kicking
        ? t.runs.live.kicking
        : age > STUCK_AFTER_MS
          ? t.runs.live.stuck
          : t.runs.live.waiting;

  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="run-live-status"
      className="rounded-lg border border-border bg-muted/50 px-3.5 py-3 text-sm text-muted-foreground"
    >
      {message}
    </p>
  );
}
