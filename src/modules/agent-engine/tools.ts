import type { ToolRisk } from "@/modules/contracts";

/**
 * Curated tool catalog (display-only in P0). Tools execute only through curated
 * server handlers after policy intersection (SECURITY.md §3) — implemented in P4.
 * No shell, no arbitrary network, no unvetted MCP servers.
 */
export interface ToolDefinition {
  key: string;
  risk: ToolRisk;
  /** Phase in which the tool is planned to become operational. */
  plannedPhase: "P4";
}

export const TOOL_CATALOG: readonly ToolDefinition[] = [
  { key: "knowledge.search", risk: "read_only", plannedPhase: "P4" },
  { key: "text.summarize", risk: "read_only", plannedPhase: "P4" },
  { key: "email.send_draft", risk: "requires_approval", plannedPhase: "P4" },
];
