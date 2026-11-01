// Flow MCP team tools (FLOW-601): list_team, remove_member and the team undo kinds. Inviting and role
// changes are not tools (decision 0241). Fixtures: tools_test_support.ts.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { WRITE_TOOL_NAMES } from "./tools_schemas.ts";
import { toolsFor } from "./tools_specs.ts";
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
  // Each guard on its own: an error status with a body, an empty body, and a list.
  for (const answer of [{ status: 400, json: { message: "no company" } }, { status: 200, json: null }, { status: 200, json: [team] }]) {
    const refused = await callTool("list_team", {}, ["read"], () => Promise.resolve(answer));
    assertEquals(refused.isError, true);
  }
  const extra = await callTool("list_team", { company_id: PROJECT }, ["read"], rpc);
  assertEquals(extra.isError, true);
  const writeOnly = await callTool("list_team", {}, ["write"], rpc);
  assertEquals(writeOnly.isError, true);
});

Deno.test("invite_member and set_member_role are not tools: not listed, not callable (decision 0241)", async () => {
  const listed = toolsFor(["read", "write"]).map((spec) => spec.name);
  for (const name of ["invite_member", "set_member_role"]) {
    assertEquals(listed.includes(name), false);
    assertEquals((WRITE_TOOL_NAMES as readonly string[]).includes(name), false);
  }
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: {} } }));
  const attempts = [
    callTool("invite_member", { idempotency_key: "k", email: "new@example.com" }, ["write"], rpc),
    callTool("set_member_role", { idempotency_key: "k", member_id: MEMBER, role: "editor" }, ["write"], rpc),
  ];
  for (const result of await Promise.all(attempts)) assertEquals(result.isError, true);
  assertEquals(calls, []);
});

Deno.test("remove_member takes member_id (lower-cased; user_id is refused), and undo still takes the team kinds", async () => {
  const { calls, rpc } = rpcOf(() => ({ status: 200, json: { ok: true, data: { user_id: MEMBER } } }));
  await callTool("remove_member", { idempotency_key: "m-1", member_id: MEMBER.toUpperCase() }, ["write"], rpc);
  assertEquals(calls[0], { name: "mcp_remove_member", body: { p_idempotency_key: "m-1", p_user_id: MEMBER } });
  for (const kind of ["invite", "member_role", "member_remove"]) {
    const undone = await callTool("undo", { idempotency_key: `u-${kind}`, kind, id: MEMBER }, ["write"], rpc);
    assertEquals(undone.isError, false);
  }
  assertEquals(calls.slice(1).map((call) => call.name), ["mcp_undo", "mcp_undo", "mcp_undo"]);
  const bad = await Promise.all([
    callTool("remove_member", { idempotency_key: "k" }, ["write"], rpc),
    callTool("remove_member", { idempotency_key: "k", user_id: MEMBER }, ["write"], rpc),
  ]);
  for (const result of bad) assertEquals(result.isError, true);
  assertEquals(calls.length, 4);
});
