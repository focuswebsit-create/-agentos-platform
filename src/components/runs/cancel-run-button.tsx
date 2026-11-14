"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/auth/form-parts";
import { sendJson } from "@/components/auth/api-client";
import type { Dictionary } from "@/i18n";

export function CancelRunButton({
  t,
  orgId,
  runId,
}: {
  t: Dictionary;
  orgId: string;
  runId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function cancel() {
    setPending(true);
    await sendJson(`/api/runs/${runId}/cancel`, "POST", { orgId });
    setPending(false);
    // Refresh regardless of the outcome: cancelling a run that already
    // finished is not an error, and the server's status is the truth either way.
    router.refresh();
  }

  return (
    <Button type="button" variant="outline" onClick={() => void cancel()} disabled={pending}>
      {pending ? <Spinner label={t.runs.cancelling} /> : t.runs.cancel}
    </Button>
  );
}
