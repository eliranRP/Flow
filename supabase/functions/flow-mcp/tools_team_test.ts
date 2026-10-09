// Flow MCP team tools (FLOW-601): list_team, invite_member, set_member_role, remove_member and their
// undo kinds. Fixtures: tools_test_support.ts.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { PROJECT, rpcOf } from "./tools_test_support.ts";

const MEMBER = "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const INVITE = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

Deno.test("list_team passes the team through and refuses a failed read or a write-only token", async () => {
  const team = {
    company_id: PROJECT,
    role: "owner",
    can_manage: true,
    members: [{ user_id: MEMBER, name: "Dana Example", email: "dana@example.com", role: "owner", you: true }],
    invites: [{ id: INVITE, email: "new@example.com", role: "viewer", created_at: "2026-10-09T10:00:00Z" }],
  };
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: team }));
  const read = await callTool("list_team", {}, ["read"], rpc);
  assertEquals(read.structuredContent, { ok: true, data: team });
  assertEquals(calls, [{ name: "list_team", body: {} }]);
  const failed = await callTool("list_team", {}, ["read"], () => Promise.resolve({ status: 400, json: null }));
  assertEquals(failed.isError, true);
  const extra = await callTool("list_team", { company_id: PROJECT }, ["read"], rpc);
  assertEquals(extra.isError, true);
  const writeOnly = await callTool("list_team", {}, ["write"], rpc);
  assertEquals(writeOnly.isError, true);
});

Deno.test("invite_member forwards the email and role, viewer by default, and checks its arguments", async () => {
  const { calls, rpc } = rpcOf(() => ({
    status: 200,
    json: { ok: true, data: { id: INVITE, email: "new@example.com", role: "viewer", status: "pending", existing: false, undo_kind: "invite" } },
  }));
  const invited = await callTool("invite_member", { idempotency_key: "inv-1", email: " New@Example.com " }, ["write"], rpc);
  assertEquals(invited.isError, false);
  assertEquals(calls[0], {
    name: "mcp_invite_member",
    body: { p_idempotency_key: "inv-1", p_email: "New@Example.com", p_role: "viewer" },
  });
  await callTool("invite_member", { idempotency_key: "inv-2", email: "new@example.com", role: "editor" }, ["write"], rpc);
  assertEquals(calls[1].body, { p_idempotency_key: "inv-2", p_email: "new@example.com", p_role: "editor" });
  const cases = [
    callTool("invite_member", { email: "new@example.com" }, ["write"], rpc),
    callTool("invite_member", { idempotency_key: "k", email: "x" }, ["write"], rpc),
    callTool("invite_member", { idempotency_key: "k", email: "new@example.com", role: "owner" }, ["write"], rpc),
    callTool("invite_member", { idempotency_key: "k", email: "new@example.com", company_id: PROJECT }, ["write"], rpc),
  ];
  for (const result of await Promise.all(cases)) {
    assertEquals(result.isError, true);
    if (!result.structuredContent.ok) assertEquals(result.structuredContent.error.code, "validation");
  }
  const denied = await callTool("invite_member", { idempotency_key: "k", email: "new@example.com" }, ["read"], rpc);
  assertEquals(denied.isError, true);
  assertEquals(calls.length, 2);
});

Deno.test("set_member_role and remove_member take member_id (lower-cased; user_id is refused), and undo takes the team kinds", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { user_id: MEMBER } } }));
  await callTool("set_member_role", { idempotency_key: "r-1", member_id: MEMBER.toUpperCase(), role: "editor" }, ["write"], rpc);
  assertEquals(calls[0], {
    name: "mcp_set_member_role",
    body: { p_idempotency_key: "r-1", p_user_id: MEMBER, p_role: "editor" },
  });
  await callTool("remove_member", { idempotency_key: "m-1", member_id: MEMBER }, ["write"], rpc);
  assertEquals(calls[1], { name: "mcp_remove_member", body: { p_idempotency_key: "m-1", p_user_id: MEMBER } });
  for (const kind of ["invite", "member_role", "member_remove"]) {
    const undone = await callTool("undo", { idempotency_key: `u-${kind}`, kind, id: MEMBER }, ["write"], rpc);
    assertEquals(undone.isError, false);
  }
  assertEquals(calls.slice(2).map((call) => call.name), ["mcp_undo", "mcp_undo", "mcp_undo"]);
  const bad = await Promise.all([
    callTool("set_member_role", { idempotency_key: "k", member_id: MEMBER }, ["write"], rpc),
    callTool("set_member_role", { idempotency_key: "k", member_id: "nope", role: "viewer" }, ["write"], rpc),
    callTool("remove_member", { idempotency_key: "k" }, ["write"], rpc),
    callTool("remove_member", { idempotency_key: "k", user_id: MEMBER }, ["write"], rpc),
  ]);
  for (const result of bad) assertEquals(result.isError, true);
  assertEquals(calls.length, 5);
});
