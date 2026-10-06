import { jwtSub, resolveOwnerCompany } from "./owner.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const bearer = (sub: string) => `Bearer ${b64({ alg: "HS256" })}.${b64({ sub, role: "authenticated" })}.sig`;

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
