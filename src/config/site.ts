export const siteConfig = {
  name: "AgentOS",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  /** Current delivery phase, shown in dev badges and docs. */
  phase: "P0",
} as const;

/** Marketing header navigation. Routes not built in P0 are rendered as non-links. */
export const marketingNav = [
  { key: "product", href: "/#product" },
  { key: "templates", href: "/#templates" },
  { key: "pricing", href: "/pricing" },
] as const;
