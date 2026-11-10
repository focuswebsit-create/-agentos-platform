import { BotIcon, MailCheckIcon, PlugZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { interpolate, type Dictionary } from "@/i18n";
import { TEMPLATE_CATALOG } from "@/modules/templates/catalog";

export function TemplateCards({ t }: { t: Dictionary }) {
  const tt = t.home.templates;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {TEMPLATE_CATALOG.map((tpl) => {
        const copy = tt.items[tpl.slug];
        return (
          <Card
            key={tpl.slug}
            className="group transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-brand-indigo/5"
          >
            <CardHeader>
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <BotIcon aria-hidden className="size-4 text-primary" />
                {tpl.agentCount === 1
                  ? tt.singleAgent
                  : interpolate(tt.agents, { n: tpl.agentCount })}
              </div>
              <CardTitle className="text-lg">{copy.name}</CardTitle>
              <CardDescription className="leading-relaxed">{copy.body}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto flex flex-wrap gap-2">
              {tpl.worksWithoutIntegration ? (
                <Badge variant="secondary">
                  <PlugZapIcon aria-hidden />
                  {tt.noIntegration}
                </Badge>
              ) : null}
              {tpl.requiresApprovalForExternalActions ? (
                <Badge variant="outline">
                  <MailCheckIcon aria-hidden />
                  {tt.approvalRequired}
                </Badge>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
