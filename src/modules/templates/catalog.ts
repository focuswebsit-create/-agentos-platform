/**
 * Launch template catalog metadata (PRD.md §3). Display-only in P0;
 * immutable versioned global templates + install-copy arrive in P2.
 */
export type TemplateTag = "marketing" | "sales" | "support" | "research" | "operations" | "docs";

export interface TemplateMeta {
  slug: "research-writer-reviewer" | "inquiry-triage" | "document-qa" | "marketing-kit";
  tags: readonly TemplateTag[];
  agentCount: number;
  /** True when the template can run with user text/uploads only (no external connection). */
  worksWithoutIntegration: boolean;
  /** Any external action requires a verified connection AND explicit user approval. */
  requiresApprovalForExternalActions: boolean;
}

export const TEMPLATE_CATALOG: readonly TemplateMeta[] = [
  {
    slug: "research-writer-reviewer",
    tags: ["research", "marketing"],
    agentCount: 3,
    worksWithoutIntegration: true,
    requiresApprovalForExternalActions: false,
  },
  {
    slug: "inquiry-triage",
    tags: ["support", "sales"],
    agentCount: 3,
    worksWithoutIntegration: true,
    requiresApprovalForExternalActions: true,
  },
  {
    slug: "document-qa",
    tags: ["docs", "operations"],
    agentCount: 1,
    worksWithoutIntegration: true,
    requiresApprovalForExternalActions: false,
  },
  {
    slug: "marketing-kit",
    tags: ["marketing"],
    agentCount: 2,
    worksWithoutIntegration: true,
    requiresApprovalForExternalActions: false,
  },
];
