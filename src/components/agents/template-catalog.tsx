"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { FormAlert } from "@/components/auth/form-parts";
import { InstallTemplateButton } from "./install-template-button";
import type { CatalogTemplate } from "@/modules/templates/data";
import type { Dictionary } from "@/i18n";

export function TemplateCatalog({
  t,
  orgId,
  templates,
  canInstall,
}: {
  t: Dictionary;
  orgId: string;
  templates: readonly CatalogTemplate[];
  canInstall: boolean;
}) {
  const [error, setError] = React.useState("");

  return (
    <div className="space-y-4">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <FormAlert tone="info">{t.templates.copyNotice}</FormAlert>

      <ul className="grid gap-4 sm:grid-cols-2">
        {templates.map((template) => (
          <li
            key={template.id}
            className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold">{template.name}</h3>
              <Badge variant="outline">{template.category}</Badge>
            </div>
            <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
              {template.description}
            </p>
            <p className="text-xs text-muted-foreground">
              {t.templates.requiredTools}:{" "}
              {template.requiredTools.length === 0
                ? t.templates.noTools
                : template.requiredTools.join(", ")}
            </p>
            {canInstall ? (
              <InstallTemplateButton
                t={t}
                orgId={orgId}
                versionId={template.activeVersionId}
                onError={setError}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{t.templates.noInstallPermission}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
