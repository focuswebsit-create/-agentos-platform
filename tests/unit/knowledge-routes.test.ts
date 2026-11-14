// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const KB = "77777777-7777-4777-8777-777777777777";

const m = vi.hoisted(() => ({
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data: name && args ? "doc-1" : null,
    error: null,
  })),
  deleted: [] as Array<{ id: string }>,
  filters: {} as Record<string, unknown>,
}));

vi.mock("@/modules/api/guard", () => ({
  guardApi: vi.fn(async () => ({
    ok: true,
    context: { orgId: ORG, userId: "u", role: "member" },
    requestId: "33333333-3333-4333-8333-333333333333",
  })),
}));
vi.mock("@/modules/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const chain = {
      delete: () => chain,
      eq: (c: string, v: unknown) => {
        m.filters[c] = v;
        return chain;
      },
      select: async () => ({ data: m.deleted, error: null }),
    };
    return { rpc: m.rpc, from: () => chain };
  },
}));

function req(url: string, method: string, body: unknown) {
  return new Request(`https://agentos.test${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function addDoc(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/knowledge/[id]/documents/route");
  return POST(
    req(`/api/knowledge/${KB}/documents`, "POST", {
      orgId: ORG,
      title: "שעות פעילות",
      sourceType: "paste",
      mimeType: "text/plain",
      content: "ראשון עד חמישי 09:00-18:00.",
      ...body,
    }) as never,
    { params: Promise.resolve({ id: KB }) } as never,
  );
}

beforeEach(() => {
  m.rpc.mockClear();
  m.deleted = [];
  m.filters = {};
});

describe("POST /api/knowledge/:id/documents", () => {
  it("chunks the text server-side and writes it through one function", async () => {
    const res = await addDoc({});
    expect(res.status).toBe(200);
    const [name, args] = m.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("add_knowledge_document");
    expect(args.p_knowledge_base_id).toBe(KB);
    expect(args.p_chunks).toEqual(["ראשון עד חמישי 09:00-18:00."]);
    expect(String(args.p_content_sha256)).toMatch(/^\\x[0-9a-f]{64}$/);
  });

  it("refuses a type outside the allow-list without touching the database", async () => {
    const res = await addDoc({ mimeType: "text/html" });
    expect(res.status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses a document larger than 512KB in UTF-8 bytes", async () => {
    // 300k Hebrew letters is under the character bound but ~600KB in UTF-8.
    const res = await addDoc({ content: "א".repeat(300_000) });
    expect(res.status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("strips control characters before storing", async () => {
    await addDoc({ content: "a\u0000b\u0007c" });
    const [, args] = m.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_chunks).toEqual(["abc"]);
  });
});

describe("DELETE /api/knowledge/documents/:id", () => {
  async function del() {
    const { DELETE } = await import("@/app/api/knowledge/documents/[id]/route");
    return DELETE(
      req(`/api/knowledge/documents/${KB}`, "DELETE", { orgId: ORG }) as never,
      { params: Promise.resolve({ id: KB }) } as never,
    );
  }

  it("deletes within the caller's organisation", async () => {
    m.deleted = [{ id: KB }];
    expect((await del()).status).toBe(200);
    expect(m.filters).toMatchObject({ id: KB, org_id: ORG });
  });

  it("reports not found when RLS deleted nothing (other org, or a member)", async () => {
    expect((await del()).status).toBe(403);
  });
});
