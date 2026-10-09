// Flow MCP tools tests: the project group tools (FLOW-406 server 2, decision 0164). Fixtures: tools_test_support.ts.
import { assertEquals } from "jsr:@std/assert@1";
import { callTool } from "./tools.ts";
import { rpcOf } from "./tools_test_support.ts";

Deno.test("project group tools forward their input and list_projects carries groups (FLOW-406)", async () => {
  const GROUP = "44444444-4444-4444-8444-444444444406";
  const PROJECT = "55555555-5555-4555-8555-555555555406";
  const group = {
    id: GROUP,
    name: "North",
    sort_order: 1,
    project_count: 1,
    income_agorot: 100,
    direct_agorot: 40,
    shared_agorot: 0,
    profit_before_shared_agorot: 60,
    profit_agorot: 60,
    by_currency: [],
  };
  const { calls, rpc } = rpcOf((name) => {
    if (name === "get_dashboard") {
      return {
        status: 200,
        json: {
          basis: "cash",
          projects: [{
            id: PROJECT,
            name: "Site Alpha",
            status: "active",
            group_id: GROUP,
            income_agorot: 100,
            direct_agorot: 40,
            shared_agorot: 0,
            profit_agorot: 60,
          }],
          groups: [group],
        },
      };
    }
    if (name === "list_project_groups") {
      return {
        status: 200,
        json: [{ id: GROUP, name: "North", sort_order: 1, project_count: 1 }],
      };
    }
    if (name === "get_project_group") {
      return { status: 200, json: { ...group, basis: "cash", projects: [] } };
    }
    return {
      status: 200,
      json: { ok: true, data: { id: GROUP, undo_kind: "project_group" } },
    };
  });

  const listed = await callTool("list_projects", {}, ["read"], rpc);
  if (!listed.structuredContent.ok) throw new Error("list_projects failed");
  const data = listed.structuredContent.data as {
    projects: { group_id: string }[];
    groups: unknown[];
  };
  assertEquals(data.projects[0]?.group_id, GROUP);
  assertEquals(data.groups, [group]);
  const totals = await callTool("get_totals", {}, ["read"], rpc);
  if (!totals.structuredContent.ok) throw new Error("get_totals failed");
  assertEquals(
    (totals.structuredContent.data as { groups: unknown[] }).groups,
    [group],
  );

  const groups = await callTool("list_project_groups", {}, ["read"], rpc);
  assertEquals(groups.isError, false);
  assertEquals(calls.at(-1), { name: "list_project_groups", body: {} });
  const one = await callTool(
    "get_project_group",
    {
      id: GROUP.toUpperCase(),
      basis: "invoiced",
      from: "2026-09-01",
      to: "2026-09-30",
    },
    ["read"],
    rpc,
  );
  assertEquals(one.isError, false);
  assertEquals(calls.at(-1), {
    name: "get_project_group",
    body: {
      p_id: GROUP,
      p_basis: "invoiced",
      p_from: "2026-09-01",
      p_to: "2026-09-30",
    },
  });

  await callTool(
    "create_project_group",
    { idempotency_key: "pg-1", name: "  North " },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1), {
    name: "mcp_create_project_group",
    body: { p_idempotency_key: "pg-1", p_name: "North" },
  });
  await callTool(
    "set_project_group",
    {
      idempotency_key: "pg-2",
      project_id: PROJECT.toUpperCase(),
      group_id: GROUP,
    },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1), {
    name: "mcp_set_project_group",
    body: {
      p_idempotency_key: "pg-2",
      p_project_id: PROJECT,
      p_group_id: GROUP,
    },
  });
  await callTool(
    "set_project_group",
    { idempotency_key: "pg-3", project_id: PROJECT, group_id: null },
    ["write"],
    rpc,
  );
  assertEquals(calls.at(-1)?.body.p_group_id, null);
  for (const kind of ["project_group", "project_group_member"]) {
    const undo = await callTool(
      "undo",
      { idempotency_key: `u-${kind}`, kind, id: GROUP },
      ["write"],
      rpc,
    );
    assertEquals(undo.isError, false);
    assertEquals(calls.at(-1)?.body.p_kind, kind);
  }

  const before = calls.length;
  for (
    const [tool, input, scope] of [
      ["get_project_group", {}, ["read"]],
      ["get_project_group", { id: "nope" }, ["read"]],
      ["get_project_group", { id: GROUP, from: "2026-09-01" }, ["read"]],
      ["get_project_group", { id: GROUP, basis: "accrual" }, ["read"]],
      ["list_project_groups", { company_id: GROUP }, ["read"]],
      ["create_project_group", { idempotency_key: "k", name: "x" }, ["write"]],
      ["create_project_group", { idempotency_key: "k", name: "North‮" }, [
        "write",
      ]],
      ["set_project_group", { idempotency_key: "k", project_id: PROJECT }, [
        "write",
      ]],
      ["set_project_group", {
        idempotency_key: "k",
        project_id: "nope",
        group_id: null,
      }, ["write"]],
      ["set_project_group", {
        idempotency_key: "k",
        project_id: PROJECT,
        group_id: null,
        extra: 1,
      }, ["write"]],
    ] as [string, Record<string, unknown>, string[]][]
  ) {
    const result = await callTool(tool, input, scope, rpc);
    assertEquals(result.isError, true, `${tool} ${JSON.stringify(input)}`);
  }
  assertEquals(calls.length, before);

  const { rpc: missing } = rpcOf(() => ({ status: 200, json: null }));
  const notFound = await callTool(
    "get_project_group",
    { id: GROUP },
    ["read"],
    missing,
  );
  if (notFound.structuredContent.ok) throw new Error("expected not_found");
  assertEquals(notFound.structuredContent.error.code, "not_found");
});
