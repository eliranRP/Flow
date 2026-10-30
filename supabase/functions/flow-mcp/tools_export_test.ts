// FLOW-162: export_report and the app's report route: the reports as a PDF or a CSV (FLOW-991: by project or
// period, several projects, xlsx and json). Invented ids and names only.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { SAMPLE_BALANCE_BODY, SAMPLE_STATEMENT_BODY } from "../_shared/report_sample.ts";
import { handle } from "./handler.ts";
import { env, pepperSecret } from "./handler_test_support.ts";
import { hmacSecret } from "./handler.ts";
import type { SigningKey } from "./sign.ts";
import { callTool } from "./tools.ts";
import { exportReport } from "./tools_export.ts";
import { rpcOf } from "./tools_test_support.ts";

const PROJECT = "b0000000-0000-4000-8000-0000000000e1";
const COMPANY = "5eb3b1ca-b8b9-4322-9227-07d8e360ac82";
const NOW = new Date("2026-10-31T07:15:00Z");

function reads(name: string) {
  if (name === "get_pnl_statement") return { status: 200, json: SAMPLE_STATEMENT_BODY };
  if (name === "mcp_balance_sheet") return { status: 200, json: SAMPLE_BALANCE_BODY };
  if (name === "get_dashboard") return { status: 200, json: { name: "נכסי הדוגמה בע״מ" } };
  if (name === "bump_report_rate") return { status: 200, json: { allowed: true, retry_after_seconds: 0 } };
  return { status: 404, json: null };
}

function codeOf(result: Awaited<ReturnType<typeof callTool>>): string | null {
  return result.structuredContent.ok ? null : result.structuredContent.error.code;
}

const decode = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

Deno.test("export_report reads the P&L and makes a PDF, named for its dates, carried as a file", async () => {
  const { calls, rpc } = rpcOf(reads);
  const result = await exportReport({ from: "2026-01-01", to: "2026-10-31" }, rpc, NOW);
  assertEquals(result.isError, false);
  assertEquals(calls.map((call) => call.name), ["get_dashboard", "get_pnl_statement"]);
  assertEquals(calls[1]?.body, { p_from: "2026-01-01", p_to: "2026-10-31", p_project_id: null, p_by_project: false, p_basis: null });
  const file = result.files?.[0];
  assertEquals(file?.mimeType, "application/pdf");
  assertEquals(new TextDecoder().decode(decode(file?.base64 ?? "").slice(0, 5)), "%PDF-");
  assertEquals(result.structuredContent.ok && result.structuredContent.data, {
    file_name: "רווח-והפסד_2026-01-01_2026-10-31_כל-הפרויקטים.pdf",
    mime_type: "application/pdf",
    size_bytes: decode(file?.base64 ?? "").length,
  });
});

Deno.test("export_report both: the balance sheet at the P&L's last day, unless as_of says otherwise; a CSV for Excel", async () => {
  const { calls, rpc } = rpcOf(reads);
  const both = await exportReport({ kind: "both", format: "csv", from: "2026-01-01", to: "2026-09-30", project_id: PROJECT }, rpc, NOW);
  assertEquals(calls.find((call) => call.name === "mcp_balance_sheet")?.body, { p_as_of: "2026-09-30", p_project_id: PROJECT });
  // ignoreBOM keeps the byte-order mark, which a default decoder drops.
  const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(decode(both.files?.[0]?.base64 ?? ""));
  assert(csv.startsWith("\uFEFF"));
  assertStringIncludes(csv, "סה״כ הכנסות,,,USD,96200.00");
  assertStringIncludes(csv, "התחייבויות והון,,USD,615000.00");
  assertEquals(both.files?.[0]?.mimeType, "text/csv");
  await exportReport({ kind: "balance", as_of: "2026-06-30" }, rpc, NOW);
  assertEquals(calls.filter((call) => call.name === "mcp_balance_sheet").at(-1)?.body, { p_as_of: "2026-06-30", p_project_id: null });
  // No date: today in Israel.
  await exportReport({ kind: "balance" }, rpc, new Date("2026-10-31T22:30:00Z"));
  assertEquals(calls.filter((call) => call.name === "mcp_balance_sheet").at(-1)?.body, { p_as_of: "2026-11-01", p_project_id: null });
});

Deno.test("export_report refuses a bad kind, format, range, date, project or flag before any read", async () => {
  const { calls, rpc } = rpcOf(reads);
  for (
    const bad of [
      { kind: "cash" },
      { format: "docx" },
      { columns: "week" },
      { columns: "month" },
      { columns: "quarter", from: "2020-01-01", to: "2029-12-31" },
      { columns: "month", by_project: true, from: "2026-01-01", to: "2026-03-31" },
      { project_ids: ["nope"] },
      { project_ids: PROJECT },
      { project_ids: [PROJECT], project_id: PROJECT },
      { from: "2026-01-01" },
      { from: "2026-03-01", to: "2026-02-01" },
      { as_of: "2026-02-30" },
      { project_id: "nope" },
      { project_id: PROJECT, by_project: true },
      { by_project: "yes" },
      { expand: 1 },
      { basis: "accrual" },
      { extra: 1 },
    ]
  ) {
    assertEquals(codeOf(await callTool("export_report", bad, ["read"], rpc)), "validation", JSON.stringify(bad));
  }
  assertEquals(calls.length, 0);
});

Deno.test("export_report: another company's project is not_found; a failed read is refused", async () => {
  const missing = rpcOf((name) => (name === "get_pnl_statement" ? { status: 200, json: null } : reads(name)));
  assertEquals(codeOf(await callTool("export_report", { project_id: PROJECT }, ["read"], missing.rpc)), "not_found");
  // The balance sheet raises P0002 for another company's project: PostgREST's 404.
  const foreign = rpcOf((name) => (name === "mcp_balance_sheet" ? { status: 404, json: { code: "P0002" } } : reads(name)));
  assertEquals(codeOf(await callTool("export_report", { kind: "balance", project_id: PROJECT }, ["read"], foreign.rpc)), "not_found");
  const down = rpcOf((name) => (name === "mcp_balance_sheet" ? { status: 500, json: null } : reads(name)));
  assertEquals(codeOf(await callTool("export_report", { kind: "both" }, ["read"], down.rpc)), "refused");
});

type Seen = { url: string; authorization: string; company: string | null; body: unknown };

function appDeps(seen: Seen[]) {
  return {
    env: (name: string) => env[name],
    fetch: (input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: input, authorization: headers.get("authorization") ?? "", company: headers.get("x-flow-company"), body: init?.body ? JSON.parse(String(init.body)) : null });
      const name = input.split("/").pop() ?? "";
      if (name === "user") return Promise.resolve(new Response(JSON.stringify({ id: "user-1" })));
      const answer = reads(name);
      return Promise.resolve(new Response(JSON.stringify(answer.json), { status: answer.status }));
    },
    now: () => NOW.getTime(),
  };
}

const appRequest = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1:54321/functions/v1/flow-mcp/report", {
    method: "POST",
    headers: { origin: "https://flow-app-dx5.pages.dev", authorization: "Bearer app-jwt", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

Deno.test("the app's report route reads as the signed-in user, on the company the app shows, and returns the file", async () => {
  const seen: Seen[] = [];
  const response = await handle(appRequest({ kind: "pnl", by_project: true }, { "x-flow-company": COMPANY.toUpperCase() }), appDeps(seen));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "application/pdf");
  assertStringIncludes(response.headers.get("content-disposition") ?? "", `filename*=UTF-8''${encodeURIComponent("רווח-והפסד_2026-01-01_2026-10-31_לפי-פרויקט.pdf")}`);
  assertEquals(response.headers.get("access-control-allow-origin"), "https://flow-app-dx5.pages.dev");
  assertEquals(response.headers.get("access-control-expose-headers"), "content-disposition");
  assertEquals(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).slice(0, 5)), "%PDF-");
  const statement = seen.find((call) => call.url.endsWith("/rpc/get_pnl_statement"));
  assertEquals(statement?.authorization, "Bearer app-jwt");
  assertEquals(statement?.company, COMPANY);
  assertEquals((statement?.body as Record<string, unknown>).p_by_project, true);
});

Deno.test("the report route refuses a foreign origin, no session and bad arguments", async () => {
  const seen: Seen[] = [];
  assertEquals((await handle(appRequest({}, { origin: "https://evil.example" }), appDeps(seen))).status, 403);
  const signedOut = { ...appDeps(seen), fetch: () => Promise.resolve(new Response("{}", { status: 401 })) };
  assertEquals((await handle(appRequest({}), signedOut)).status, 401);
  const bad = await handle(appRequest({ format: "docx" }), appDeps(seen));
  assertEquals(bad.status, 400);
  assertEquals((await bad.json()).error, "validation");
  // Only the limit is counted: no report is read.
  assertEquals(seen.filter((call) => call.url.includes("/rpc/")).map((call) => call.url.split("/").pop()), ["bump_report_rate"]);
});

Deno.test("the report route's file name escapes the marks RFC 5987 does not allow bare", async () => {
  const seen: Seen[] = [];
  const deps = appDeps(seen);
  const named = {
    ...deps,
    fetch: (input: string, init?: RequestInit) => input.endsWith("/rpc/get_pnl_statement")
      ? Promise.resolve(new Response(JSON.stringify({ ...SAMPLE_STATEMENT_BODY, project_id: PROJECT, project_name: "O'Neil (North)*!", by_project: false, projects: [] })))
      : deps.fetch(input, init),
  };
  const response = await handle(appRequest({ project_id: PROJECT }), named);
  assertEquals(response.status, 200);
  const disposition = response.headers.get("content-disposition") ?? "";
  assertStringIncludes(disposition, "O%27Neil-%28North%29-%21.pdf");
  assertEquals(/filename\*=UTF-8''[A-Za-z0-9%!#$&+\-.^_`|~]+$/.test(disposition.replace(/%[0-9A-F]{2}/g, "")), true, disposition);
});

Deno.test("the report route counts each file against the user's limit, before any read, and says when to come back", async () => {
  const seen: Seen[] = [];
  await handle(appRequest({}), appDeps(seen));
  const bump = seen.find((call) => call.url.endsWith("/rpc/bump_report_rate"));
  assertEquals(bump?.body, { p_user: "user-1" });
  assertEquals(bump?.authorization, "Bearer secret-key");
  const limitedSeen: Seen[] = [];
  const base = appDeps(limitedSeen);
  const limited = {
    ...base,
    fetch: (input: string, init?: RequestInit) => input.endsWith("/rpc/bump_report_rate")
      ? Promise.resolve(new Response(JSON.stringify({ allowed: false, retry_after_seconds: 42 })))
      : base.fetch(input, init),
  };
  const refused = await handle(appRequest({}), limited);
  assertEquals(refused.status, 429);
  assertEquals(refused.headers.get("retry-after"), "42");
  assertEquals(refused.headers.get("access-control-allow-origin"), "https://flow-app-dx5.pages.dev");
  assertEquals((await refused.json()).error, "rate_limited");
  assertEquals(limitedSeen.some((call) => call.url.includes("/rpc/get_pnl_statement")), false);
  const down = { ...base, fetch: (input: string, init?: RequestInit) => input.endsWith("/rpc/bump_report_rate") ? Promise.resolve(new Response("{}", { status: 500 })) : base.fetch(input, init) };
  assertEquals((await handle(appRequest({}), down)).status, 503);
});

Deno.test("export_report through the MCP counts against the same file limit, before any read", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as SigningKey;
  jwk.kid = "report-kid";
  jwk.alg = "ES256";
  const token = `flow_mcp_${"r".repeat(43)}`;
  const hash = await hmacSecret(token, new TextEncoder().encode(pepperSecret));
  const localEnv: Record<string, string> = { ...env, FLOW_MCP_SIGNING_KEY: JSON.stringify(jwk) };
  let allowed = false;
  let scope = ["read"];
  const asked: Array<{ name: string; body: unknown }> = [];
  const deps = {
    env: (name: string) => localEnv[name],
    fetch: (input: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      const name = input.split("/").pop() ?? "";
      asked.push({ name, body });
      if (name === "lookup_mcp_credential") {
        if (body?.p_token_hash !== hash) return Promise.resolve(new Response(JSON.stringify({ found: false })));
        return Promise.resolve(new Response(JSON.stringify({
          found: true,
          id: "88888888-8888-4000-8000-000000000166",
          user_id: "aaaaaaaa-aaaa-4000-8000-000000000166",
          company_id: "cccccccc-cccc-4000-8000-000000000166",
          scope,
          expires_at: "2099-01-01T00:00:00.000Z",
          revoked_at: null,
        })));
      }
      if (name === "bump_mcp_rate") return Promise.resolve(new Response(JSON.stringify({ allowed: true, retry_after_seconds: 0 })));
      if (name === "bump_report_rate") return Promise.resolve(new Response(JSON.stringify({ allowed, retry_after_seconds: 30 })));
      if (name === "touch_mcp_credential") return Promise.resolve(new Response("null"));
      const answer = reads(name);
      return Promise.resolve(new Response(JSON.stringify(answer.json), { status: answer.status }));
    },
    now: () => NOW.getTime(),
  };
  const call = async () => (await handle(new Request("http://127.0.0.1:54321/functions/v1/flow-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "export_report", arguments: { format: "csv" } } }),
  }), deps)).json();
  // A token that may not read is refused before the count: it uses up none of the user's files.
  scope = ["write"];
  assertEquals((await call()).result.structuredContent.error.code, "forbidden");
  assertEquals(asked.some((item) => item.name === "bump_report_rate"), false);
  scope = ["read"];
  const refused = await call();
  assertEquals(refused.result.isError, true);
  assertEquals(refused.result.structuredContent.error.code, "rate_limited");
  assertEquals(asked.find((item) => item.name === "bump_report_rate")?.body, { p_user: "aaaaaaaa-aaaa-4000-8000-000000000166" });
  assertEquals(asked.some((item) => item.name === "get_pnl_statement"), false);
  allowed = true;
  const made = await call();
  assertEquals(made.result.isError, false);
  assertEquals(made.result.content[1].type, "resource");
  assertEquals(made.result.content[1].resource.mimeType, "text/csv");
});

// FLOW-991: columns by project or period, several projects, xlsx and json.
const P2 = "b0000000-0000-4000-8000-0000000000e2";
const projectsBody = { ...SAMPLE_STATEMENT_BODY, projects: SAMPLE_STATEMENT_BODY.projects.map((project, index) => (index === 0 ? { ...project, project_id: PROJECT } : index === 1 ? { ...project, project_id: P2 } : project)) };
function listed(name: string) {
  if (name === "get_dashboard") return { status: 200, json: { name: "נכסי הדוגמה בע״מ", projects: [{ id: PROJECT, name: "Maple Ave" }, { id: P2, name: "Riverside Commons" }] } };
  if (name === "get_pnl_statement") return { status: 200, json: projectsBody };
  return reads(name);
}

Deno.test("export_report json by project: a column per project and כללי; the total is the company's", async () => {
  const { rpc } = rpcOf(listed);
  const result = await exportReport({ columns: "project", format: "json", from: "2026-01-01", to: "2026-10-31" }, rpc, NOW);
  assertEquals(result.isError, false);
  assertEquals(result.files, undefined);
  const data = (result.structuredContent as { data: { reports: { grids: { columns: string[]; rows: { label: string; amounts_minor: number[]; total_minor: number }[] }[] }[] } }).data;
  const grid = data.reports[0]!.grids[0]!;
  assertEquals(grid.columns, ["Maple Ave", "Riverside Commons Phase Two Townhomes", "כללי"]);
  const net = grid.rows.find((row) => row.label === "רווח נקי")!;
  assertEquals(net.amounts_minor, [2_100_000, 1_420_000, -620_000]);
  assertEquals(net.total_minor, 2_900_000);
});

Deno.test("export_report by project with projects picked: only their columns, no כללי", async () => {
  const { rpc } = rpcOf(listed);
  const result = await exportReport({ columns: "project", format: "json", project_ids: [P2] }, rpc, NOW);
  const grid = (result.structuredContent as { data: { reports: { grids: { columns: string[] }[] }[] } }).data.reports[0]!.grids[0]!;
  assertEquals(grid.columns, ["Riverside Commons"]);
  // A project the company does not have is not_found.
  const other = await exportReport({ columns: "project", project_ids: ["b0000000-0000-4000-8000-0000000000ff"] }, rpc, NOW);
  assertEquals(codeOf(other), "not_found");
});

Deno.test("export_report by quarter: one P&L read per quarter, and the balance sheet at each quarter's end, as xlsx", async () => {
  const { calls, rpc } = rpcOf(listed);
  const result = await exportReport({ kind: "both", columns: "quarter", format: "xlsx", from: "2026-01-01", to: "2026-10-31" }, rpc, NOW);
  assertEquals(result.isError, false);
  assertEquals(calls.filter((call) => call.name === "get_pnl_statement").map((call) => [call.body.p_from, call.body.p_to]), [
    ["2026-01-01", "2026-03-31"],
    ["2026-04-01", "2026-06-30"],
    ["2026-07-01", "2026-09-30"],
    ["2026-10-01", "2026-10-31"],
  ]);
  assertEquals(calls.filter((call) => call.name === "mcp_balance_sheet").map((call) => call.body.p_as_of), ["2026-03-31", "2026-06-30", "2026-09-30", "2026-10-31"]);
  assertEquals(result.files?.[0]?.mimeType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assertEquals(result.files?.[0]?.name, "דוחות_2026-01-01_2026-10-31_כל-הפרויקטים.xlsx");
  // An xlsx is a zip.
  assertEquals([...decode(result.files?.[0]?.base64 ?? "").slice(0, 2)], [0x50, 0x4B]);
});

Deno.test("export_report with two projects picked: the balance sheet reads each project and adds them up", async () => {
  const { calls, rpc } = rpcOf(listed);
  const result = await exportReport({ kind: "balance", format: "json", project_ids: [PROJECT, P2], as_of: "2026-10-31" }, rpc, NOW);
  assertEquals(calls.filter((call) => call.name === "mcp_balance_sheet").map((call) => call.body.p_project_id), [PROJECT, P2]);
  const grid = (result.structuredContent as { data: { reports: { grids: { rows: { label: string; amounts_minor: number[] }[] }[] }[] } }).data.reports[0]!.grids[0]!;
  // Each project read returns the sample: the sum is twice it.
  assertEquals(grid.rows.find((row) => row.label === "סה״כ נכסים")?.amounts_minor, [123_000_000]);
});
