"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormAlert, Spinner, TextField } from "@/components/auth/form-parts";
import { sendJson } from "@/components/auth/api-client";
import type { Dictionary } from "@/i18n";

/**
 * Creating an agent goes through create_agent(), which also opens the first
 * draft in the same transaction. There is no client-side insert: 0007 grants
 * none, so an agent cannot exist without somewhere to edit it.
 */
export function CreateAgentForm({ t, orgId }: { t: Dictionary; orgId: string }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const res = await sendJson<{ id: string }>("/api/agents", "POST", {
      orgId,
      name,
      ...(description.trim() ? { description: description.trim() } : {}),
    });

    if (!res.ok) {
      setPending(false);
      setError(
        res.code === "ORG_ACCESS_DENIED" ? t.agents.noCreatePermission : t.auth.errors.generic,
      );
      return;
    }

    // Deliberately stays pending through the navigation: re-enabling the button
    // while the route transition is in flight invites a second agent from a
    // double click.
    router.push(`/app/agents/${res.data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <TextField
        id="agentName"
        label={t.agents.nameLabel}
        placeholder={t.agents.namePlaceholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        minLength={2}
        maxLength={120}
        disabled={pending}
      />
      <TextField
        id="agentDescription"
        label={t.agents.descriptionLabel}
        placeholder={t.agents.descriptionPlaceholder}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        disabled={pending}
      />

      <Button type="submit" disabled={pending || name.trim().length < 2}>
        {pending ? <Spinner label={t.agents.creating} /> : t.agents.create}
      </Button>
    </form>
  );
}
