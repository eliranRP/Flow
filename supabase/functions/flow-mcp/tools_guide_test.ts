// Flow MCP tests: the get_started guide stays in step with the tool lists (FLOW-217).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { getStartedPayload, OPTIONAL_TOOLS, SERVER_INSTRUCTIONS, TOOL_GROUPS, WORKFLOWS } from "./tools_guide.ts";
import { READ_TOOL_NAMES, WRITE_TOOL_NAMES } from "./tools_schemas.ts";
import { toolsFor } from "./tools_specs.ts";
import { rpcOf } from "./tools_test_support.ts";

const ALL: string[] = [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES];
const present = (name: string) => ALL.includes(name);

Deno.test("every tool is in exactly one group, and every group tool is real", () => {
  const seen = new Map<string, number>();
  for (const group of TOOL_GROUPS) {
    for (const name of group.tools) {
      if (OPTIONAL_TOOLS.includes(name) && !present(name)) continue;
      assert(present(name), `${name} in group ${group.id} is not a tool`);
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
  }
  for (const name of ALL) assertEquals(seen.get(name), 1, `${name} must be in exactly one group`);
});

Deno.test("every tool name in a workflow step is a real tool", () => {
  for (const workflow of WORKFLOWS) {
    for (const step of workflow.steps) {
      for (const name of step.match(/[a-z]+(?:_[a-z]+)+/g) ?? []) {
        if (name === "undo_kind" || name === "idempotency_key" || name === "batch_key") continue;
        assert(present(name) || OPTIONAL_TOOLS.includes(name), `${name} in ${workflow.id} is not a tool`);
      }
    }
  }
});

Deno.test("instructions are short and point to get_started", () => {
  assert(SERVER_INSTRUCTIONS.length <= 1200, `instructions are ${SERVER_INSTRUCTIONS.length} chars`);
  assert(SERVER_INSTRUCTIONS.includes("get_started"));
  assert(SERVER_INSTRUCTIONS.includes("idempotency_key") && SERVER_INSTRUCTIONS.includes("undo"));
});

Deno.test("a read scope lists no write tools; a write scope lists no read tools but the sync poll", () => {
  const read = getStartedPayload(["read"]);
  const readTools = read.groups.flatMap((g) => g.tools);
  assert(readTools.length > 0 && readTools.every((t) => t.kind === "read"));
  assertEquals(readTools.length, READ_TOOL_NAMES.length);
  assert(read.workflows.length > 0, "the first-look workflow stays");
  const names = readTools.map((t) => t.name);
  for (const w of read.workflows) {
    for (const step of w.steps) {
      for (const n of step.match(/[a-z]+(?:_[a-z]+)+/g) ?? []) if (present(n)) assert(names.includes(n), `${n} leaked`);
    }
  }
  const write = getStartedPayload(["write"]).groups.flatMap((g) => g.tools);
  assertEquals(write.filter((t) => t.kind === "read").map((t) => t.name), ["get_sync_status"]);
  assertEquals(getStartedPayload([]).groups, []);
});

Deno.test("summaries are the first sentence of the description, at most 160 characters", () => {
  const specs = new Map(toolsFor(["read", "write"]).map((s) => [s.name, s.description]));
  for (const tool of getStartedPayload(["read", "write"]).groups.flatMap((g) => g.tools)) {
    assert(tool.summary.length > 0 && tool.summary.length <= 160, tool.name);
    assert(specs.get(tool.name)?.startsWith(tool.summary.replace(/…$/, "")), tool.name);
  }
});

Deno.test("get_started is callable with read scope only", async () => {
  const { rpc } = rpcOf(() => ({ status: 500, json: null }));
  const ok = await callTool("get_started", {}, ["read"], rpc);
  assertEquals(ok.isError, false);
  const body = ok.structuredContent;
  assertEquals(body.ok ? (body.data as { rules: string[] }).rules.length : 0, 4);
  const denied = await callTool("get_started", {}, ["write"], rpc);
  assert(denied.isError);
  const extra = await callTool("get_started", { x: 1 }, ["read"], rpc);
  assert(extra.isError);
});
