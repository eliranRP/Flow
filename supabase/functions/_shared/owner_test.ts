import { companyHint, jwtSub, ownedCompany, resolveOwnerCompany } from "./owner.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const bearer = (sub: string, extra: Record<string, unknown> = { mcp_tid: "tid-1", company_id: "c-1" }) =>
  `Bearer ${b64({ alg: "HS256" })}.${b64({ sub, role: "authenticated", ...extra })}.sig`;

Deno.test("jwtSub reads sub and rejects junk", () => {
  assertEquals(jwtSub(bearer("u-1")), "u-1");
  assertEquals(jwtSub("Bearer nope"), null);
  assertEquals(jwtSub(""), null);
});

Deno.test("session user resolves through the owner lookup", async () => {
  const result = await resolveOwnerCompany(bearer("u-1"), {
    getUserId: () => Promise.resolve("u-1"),
    ownedBy: (id) => Promise.resolve(id === "u-1" ? "c-1" : null),
    readableCompanies: () => Promise.reject(new Error("not used")),
  });
  assertEquals(result, { companyId: "c-1" });
});

Deno.test("session-less MCP JWT falls back to RLS-readable owned company", async () => {
  const result = await resolveOwnerCompany(bearer("u-1"), {
    getUserId: () => Promise.resolve(null),
    ownedBy: () => Promise.reject(new Error("not used")),
    readableCompanies: () => Promise.resolve([{ id: "c-1", owner_id: "u-1" }]),
  });
  assertEquals(result, { companyId: "c-1" });
});

Deno.test("viewer token and rejected token are refused", async () => {
  const viewer = await resolveOwnerCompany(bearer("u-2"), {
    getUserId: () => Promise.resolve(null),
    ownedBy: () => Promise.resolve(null),
    readableCompanies: () => Promise.resolve([{ id: "c-1", owner_id: "u-1" }]),
  });
  assertEquals(viewer, { error: "no company" });
  const rejected = await resolveOwnerCompany(bearer("u-1"), {
    getUserId: () => Promise.resolve(null),
    ownedBy: () => Promise.resolve(null),
    readableCompanies: () => Promise.resolve(null),
  });
  assertEquals(rejected, { error: "unauthorized" });
});

Deno.test("the fallback takes only a flow-mcp token for its own company (FLOW-205)", async () => {
  const deps = {
    getUserId: () => Promise.resolve(null),
    ownedBy: () => Promise.reject(new Error("not used")),
    readableCompanies: () => Promise.resolve([{ id: "c-1", owner_id: "u-1" }, { id: "c-2", owner_id: "u-1" }]),
  };
  assertEquals(await resolveOwnerCompany(bearer("u-1", {}), deps), { error: "unauthorized" });
  assertEquals(await resolveOwnerCompany(bearer("u-1", { company_id: "c-1" }), deps), { error: "unauthorized" });
  assertEquals(await resolveOwnerCompany(bearer("u-1", { mcp_tid: "tid-1" }), deps), { error: "unauthorized" });
  assertEquals(await resolveOwnerCompany(bearer("u-1", { mcp_tid: "tid-1", company_id: "c-2" }), deps), { companyId: "c-2" });
  assertEquals(await resolveOwnerCompany(bearer("u-1", { mcp_tid: "tid-1", company_id: "c-9" }), deps), { error: "no company" });
});

Deno.test("companyHint reads the app's x-flow-company header and drops anything that is not an id (FLOW-601)", () => {
  const id = "5EB3B1CA-B8B9-4322-9227-07D8E360AC82";
  const req = (value?: string) => new Request("https://example.supabase.co/functions/v1/sumit-sync", {
    method: "POST",
    headers: value === undefined ? {} : { "x-flow-company": value },
  });
  assertEquals(companyHint(req(` ${id} `)), id.toLowerCase());
  assertEquals(companyHint(req("not-an-id")), null);
  assertEquals(companyHint(req()), null);
});

Deno.test("ownedCompany asks owner_company_for with the hint and refuses an error or a missing company (FLOW-601)", async () => {
  const calls: unknown[] = [];
  const client = (answer: { data: unknown; error: unknown }) => ({
    rpc: (fn: "owner_company_for", args: { p_user: string; p_hint?: string }) => {
      calls.push([fn, args]);
      return Promise.resolve(answer);
    },
  });
  assertEquals(await ownedCompany(client({ data: "c-1", error: null }), "u-1", "c-1"), "c-1");
  assertEquals(await ownedCompany(client({ data: "c-1", error: null }), "u-1", null), "c-1");
  assertEquals(calls, [
    ["owner_company_for", { p_user: "u-1", p_hint: "c-1" }],
    ["owner_company_for", { p_user: "u-1" }],
  ]);
  assertEquals(await ownedCompany(client({ data: null, error: null }), "u-1", null), null);
  assertEquals(await ownedCompany(client({ data: "c-1", error: { message: "boom" } }), "u-1", null), null);
});
