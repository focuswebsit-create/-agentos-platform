// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ChatModule from "@/modules/runtime/chat";
import type * as NextServer from "next/server";

const KEY = "wk_abcdefghijklmnopqrstuvwxyz012345";
const TOKEN = "a".repeat(43);

const m = vi.hoisted(() => ({
  widget: null as null | {
    enabled: boolean;
    greeting: string | null;
    allowedOrigins: string[];
    agentName: string;
  },
  open: vi.fn(async () => ({ ok: true as const, token: "t".repeat(43) })),
  post: vi.fn(async () => ({ ok: true as const, reply: "שלום!", handoff: false })),
  list: vi.fn(async () => ({ ok: true as const, status: "open", messages: [] })),
}));

vi.mock("@/modules/runtime/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof ChatModule>()),
  getWidgetInfo: vi.fn(async () => m.widget),
  openConversation: m.open,
  postVisitorMessage: m.post,
  listMessages: m.list,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof NextServer>()),
  connection: vi.fn(async () => {}),
}));

function req(path: string, init: RequestInit = {}) {
  return new Request(`https://agentos.test${path}`, init);
}

beforeEach(() => {
  m.widget = {
    enabled: true,
    greeting: "שלום",
    allowedOrigins: ["https://shop.example.co.il"],
    agentName: "MARKET",
  };
  m.open.mockClear();
  m.post.mockClear();
});

describe("GET /chat/:key — the hosted window", () => {
  async function page(key = KEY) {
    const { GET } = await import("@/app/chat/[key]/route");
    return GET(req(`/chat/${key}`), { params: Promise.resolve({ key }) } as never);
  }

  it("allows embedding only from the widget's own sites, via CSP frame-ancestors", async () => {
    const res = await page();
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(res.status).toBe(200);
    expect(csp).toContain("frame-ancestors 'self' https://shop.example.co.il");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("unsafe-inline");
  });

  it("renders messages as text, never HTML, and has no inline style attributes CSP would block", async () => {
    const html = await (await page()).text();
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
    expect(html).not.toMatch(/ style="/);
    expect(html).toContain('dir="rtl"');
  });

  it("drops non-https or malformed embedding origins", async () => {
    m.widget = {
      ...m.widget!,
      allowedOrigins: ["http://insecure.example", "javascript:alert(1)", "https://ok.example"],
    };
    const csp = (await page()).headers.get("content-security-policy") ?? "";
    expect(csp).toContain("https://ok.example");
    expect(csp).not.toContain("insecure.example");
    expect(csp).not.toContain("javascript");
  });

  it("answers 404 for a disabled or unknown widget", async () => {
    m.widget = { ...m.widget!, enabled: false };
    expect((await page()).status).toBe(404);
    m.widget = null;
    expect((await page()).status).toBe(404);
    expect((await page("not-a-key")).status).toBe(404);
  });

  it("escapes the agent name and config so they cannot break out of the document", async () => {
    m.widget = {
      ...m.widget!,
      agentName: "<script>x</script>",
      greeting: "</script><script>bad()",
    };
    const html = await (await page()).text();
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("</script><script>bad()");
  });
});

describe("public chat API", () => {
  it("refuses a browser request from another website's origin", async () => {
    const { POST } = await import("@/app/api/chat/[key]/conversations/route");
    const res = await POST(
      req(`/api/chat/${KEY}/conversations`, {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
      { params: Promise.resolve({ key: KEY }) } as never,
    );
    expect(res.status).toBe(403);
    expect(m.open).not.toHaveBeenCalled();
  });

  it("opens a conversation from the hosted page's own origin", async () => {
    const { POST } = await import("@/app/api/chat/[key]/conversations/route");
    const res = await POST(
      req(`/api/chat/${KEY}/conversations`, {
        method: "POST",
        headers: { origin: "https://agentos.test" },
      }),
      { params: Promise.resolve({ key: KEY }) } as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("token");
  });

  it("requires the visitor token in a header to post", async () => {
    const { POST } = await import("@/app/api/chat/[key]/messages/route");
    const res = await POST(
      req(`/api/chat/${KEY}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: "שלום" }),
      }),
      { params: Promise.resolve({ key: KEY }) } as never,
    );
    expect(res.status).toBe(404);
    expect(m.post).not.toHaveBeenCalled();
  });

  it("returns the agent's reply for a valid message", async () => {
    const { POST } = await import("@/app/api/chat/[key]/messages/route");
    const res = await POST(
      req(`/api/chat/${KEY}/messages`, {
        method: "POST",
        headers: { "x-visitor-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ content: "שלום" }),
      }),
      { params: Promise.resolve({ key: KEY }) } as never,
    );
    expect(await res.json()).toEqual({ reply: "שלום!", handoff: false });
  });

  it("rejects an oversized message before it reaches the database", async () => {
    const { POST } = await import("@/app/api/chat/[key]/messages/route");
    const res = await POST(
      req(`/api/chat/${KEY}/messages`, {
        method: "POST",
        headers: { "x-visitor-token": TOKEN },
        body: JSON.stringify({ content: "x".repeat(2001) }),
      }),
      { params: Promise.resolve({ key: KEY }) } as never,
    );
    expect(res.status).toBe(400);
    expect(m.post).not.toHaveBeenCalled();
  });
});

describe("buildChannelPrompt", () => {
  it("includes recent history and the new message", async () => {
    const { buildChannelPrompt } =
      await vi.importActual<typeof ChatModule>("@/modules/runtime/chat");
    const p = buildChannelPrompt(
      [
        { role: "visitor", content: "מה השעות?", at: "" },
        { role: "agent", content: "9-18", at: "" },
      ],
      "ובשישי?",
    );
    expect(p).toContain("Customer: מה השעות?");
    expect(p).toContain("You: 9-18");
    expect(p).toContain("ובשישי?");
  });
});
