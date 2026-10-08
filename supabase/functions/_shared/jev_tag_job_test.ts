// Jev tagging tests: the per-company cap split, the lease and daily cap, failures and the outage stop.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { JEV_MODEL, JevError, type JevCall } from "./jev.ts";
import {
  JEV_TAG_BUDGET_MS,
  JEV_TAG_RESERVE_MS,
  applyDailyCap,
  companyQuotas,
  createTagJobStore,
  handleJevTag,
  tagWork,
  transactionsPath,
  type CompanyUsage,
} from "./jev_tag.ts";
import {
  answers,
  categories,
  CATEGORY,
  company,
  COMPANY,
  expense,
  EXPENSE,
  memoryStore,
  NOW_ISO,
  OTHER,
  projects,
  tagEnv,
  txnRow,
  withJobs,
} from "./jev_tag_test_support.ts";

Deno.test("the cap is split across companies in id order", () => {
  assertEquals(companyQuotas(["a", "b", "c"], 50), [17, 17, 16]);
  assertEquals(companyQuotas(["a"], 50), [50]);
  assertEquals(companyQuotas(["a", "b"], 1), [1, 0]);
  assertEquals(companyQuotas([], 50), []);
  assertEquals(JEV_TAG_RESERVE_MS, 20_000);
});

const COMPANY_A = "11111111-1111-4111-8111-111111111112";
const COMPANY_B = "22222222-2222-4222-8222-222222222223";

function lineId(n: number): string {
  return `44444444-4444-4444-8444-${n.toString(16).padStart(12, "0")}`;
}

Deno.test("a 450-line backlog does not starve the other company", async () => {
  const descriptions: string[] = [];
  const transactionUrls: string[] = [];
  const backlogA = Array.from({ length: 450 }, (_, index) => txnRow({
    id: lineId(index + 1),
    company_id: COMPANY_A,
    description: "backlog-a",
  }));
  assertEquals(backlogA.length, 450);
  const response = await handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { "x-flow-cron": "cron-test" },
  }), {
    fetch: withJobs((input, init) => {
      const url = String(input);
      if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
      if (init?.method && init.method !== "GET") return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([
          { company_id: COMPANY_A, enabled: true, mode: "shadow", threshold: 0.9 },
          { company_id: COMPANY_B, enabled: true, mode: "shadow", threshold: 0.9 },
        ]));
      }
      if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
      if (url.includes("/transactions")) {
        transactionUrls.push(url);
        const limit = Number(/limit=(\d+)$/.exec(url)?.[1] ?? "0");
        if (url.includes(`company_id=eq.${COMPANY_A}`)) {
          return Promise.resolve(Response.json(backlogA.slice(0, limit)));
        }
        return Promise.resolve(Response.json(Array.from({ length: 3 }, (_, index) => txnRow({
          id: lineId(500 + index),
          company_id: COMPANY_B,
          description: "backlog-b",
        }))));
      }
      return Promise.resolve(Response.json([]));
    }),
    env: tagEnv,
    rateState: { lastAt: -1 },
    log: () => {},
    readKey: () => Promise.resolve("jev-test-key"),
    call: (_key, input) => {
      const state = input.state;
      descriptions.push(typeof state === "object" && state !== null && !Array.isArray(state) && typeof state.description === "string" ? state.description : "");
      return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });
    },
  });
  assertEquals(response.status, 200);
  const companyA = transactionUrls.find((url) => url.includes(`company_id=eq.${COMPANY_A}`));
  const companyB = transactionUrls.find((url) => url.includes(`company_id=eq.${COMPANY_B}`));
  assert(companyA);
  assert(companyB);
  assert(companyA.endsWith("limit=25"));
  assert(companyB.endsWith("limit=25"));
  assertEquals(descriptions.filter((item) => item === "backlog-a").length, 25);
  assertEquals(descriptions.filter((item) => item === "backlog-b").length, 3);
  assertEquals(descriptions.length, 28);
});

Deno.test("an approved line is not sent to TypeSafe", async () => {
  const descriptions: string[] = [];
  const urls: string[] = [];
  const response = await handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { "x-flow-cron": "cron-test" },
  }), {
    fetch: withJobs((input, init) => {
      const url = String(input);
      if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
      urls.push(url);
      if (init?.method && init.method !== "GET") return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([
          { company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 },
        ]));
      }
      if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
      if (url.includes("/transactions")) {
        return Promise.resolve(Response.json([
          txnRow({ id: EXPENSE, description: "open-line", review_queue: [{ status: "open" }] }),
          txnRow({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            description: "approved-line",
            review_queue: [{ status: "approved" }],
          }),
        ]));
      }
      return Promise.resolve(Response.json([]));
    }),
    env: tagEnv,
    rateState: { lastAt: -1 },
    log: () => {},
    readKey: () => Promise.resolve("jev-test-key"),
    call: (_key, input) => {
      const state = input.state;
      descriptions.push(typeof state === "object" && state !== null && !Array.isArray(state) && typeof state.description === "string" ? state.description : "");
      return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });
    },
  });
  assertEquals(response.status, 200);
  assertEquals(descriptions, ["open-line"]);
  const transactions = urls.find((url) => url.includes("/transactions"));
  assert(transactions);
  assert(transactions.includes("review_queue.status=eq.open"));
  assert(transactions.includes("review_queue!inner(status)"));
});

Deno.test("a call is not started when fewer than 20 seconds of the budget remain", async () => {
  const second = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let clock = 0;
  let calls = 0;
  const stopped = await tagWork([company({
    mode: "shadow",
    expenses: [expense(), expense({ id: second, description: "later" })],
  })], memoryStore(), () => {
    calls += 1;
    clock = JEV_TAG_BUDGET_MS - JEV_TAG_RESERVE_MS + 1;
    return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });
  }, "jev-test-key", {
    now: () => clock,
    budgetMs: JEV_TAG_BUDGET_MS,
    log: () => {},
  });
  assertEquals(calls, 1);
  assertEquals(stopped.budget_skipped, 1);
  assertEquals(stopped.tagged, 1);

  let exact = 0;
  clock = 0;
  const stillOpen = await tagWork([company({
    mode: "shadow",
    expenses: [expense(), expense({ id: second })],
  })], memoryStore(), () => {
    exact += 1;
    if (exact === 1) clock = JEV_TAG_BUDGET_MS - JEV_TAG_RESERVE_MS;
    return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });
  }, "jev-test-key", {
    now: () => clock,
    budgetMs: JEV_TAG_BUDGET_MS,
    log: () => {},
  });
  assertEquals(exact, 2);
  assertEquals(stillOpen.budget_skipped, 0);
  assertEquals(stillOpen.tagged, 2);
});

Deno.test("an overhead or shared line is not asked for a project", async () => {
  const overhead = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const shared = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const split = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const owned = "12121212-1212-4121-8121-121212121212";
  const seen: JevCall[] = [];
  const store = memoryStore();
  await tagWork([company({
    mode: "shadow",
    expenses: [
      expense({ id: overhead, pnlRole: "overhead", description: "overhead" }),
      expense({ id: shared, pnlRole: "shared", description: "shared-cost" }),
      expense({ id: split, allocationCount: 2, description: "split" }),
      expense({ description: "normal" }),
      expense({ id: owned, projectAssigned: true, projectId: OTHER, description: "owned" }),
    ],
  })], store, (_key, input) => {
    seen.push(input);
    return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });
  }, "jev-test-key", { log: () => {} });

  assertEquals(seen.length, 5);
  for (const input of seen.slice(0, 3)) {
    assertEquals("project" in input.questions, false);
    assertEquals("category" in input.questions, true);
  }
  assertEquals("project" in seen[3].questions, true);
  assertEquals("project" in seen[4].questions, true);
  for (const row of store.suggestions.slice(0, 3)) {
    assertEquals("project" in row.answers, false);
    assert("category" in row.answers);
  }
  assert("project" in store.suggestions[3].answers);
  assert("project" in store.suggestions[4].answers);
  assertEquals(store.writes.length, 0);

  const auto = memoryStore();
  const autoSeen: JevCall[] = [];
  await tagWork([company({
    expenses: [expense({ id: overhead, pnlRole: "overhead" })],
  })], auto, (_key, input) => {
    autoSeen.push(input);
    return Promise.resolve({ model: JEV_MODEL, answers: answers(0.4, 0.95), usage: null });
  }, "jev-test-key", { log: () => {} });
  assertEquals(autoSeen.length, 1);
  assertEquals("project" in autoSeen[0].questions, false);
  assertEquals("project" in auto.suggestions[0].answers, false);
  assertEquals(auto.suggestions[0].confidence, 0.95);
  assertEquals(auto.writes.length, 1);
  assertEquals(auto.writes[0].projectId, undefined);
  assertEquals(auto.writes[0].categoryId, CATEGORY);
});

const SECOND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THIRD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

Deno.test("the daily cap keeps only the granted lines, newest first, per company", async () => {
  const other = "66666666-6666-4666-8666-666666666666";
  const asked: Array<[string, string, number]> = [];
  const granted: Record<string, number> = { [COMPANY]: 1, [other]: 0 };
  const capped = await applyDailyCap([
    company({ expenses: [expense(), expense({ id: SECOND }), expense({ id: THIRD })] }),
    company({ companyId: other, expenses: [expense({ id: SECOND, companyId: other })] }),
    company({ companyId: "77777777-7777-4777-8777-777777777777", expenses: [] }),
  ], {
    reserveCalls: (companyId, runId, want) => {
      asked.push([companyId, runId, want]);
      return Promise.resolve(granted[companyId] ?? 0);
    },
  }, RUN);
  assertEquals(asked, [[COMPANY, RUN, 3], [other, RUN, 1]]);
  assertEquals(capped.capSkipped, 3);
  assertEquals(capped.reserved, [COMPANY, other]);
  assertEquals(capped.work.length, 1);
  assertEquals(capped.work[0].expenses.map((row) => row.id), [EXPENSE]);
});

Deno.test("the job store reads the lease and the grant from SQL and fails closed", async () => {
  const bodies: Array<[string, unknown]> = [];
  let lease: unknown = true;
  let grant: unknown = 2;
  const jobs = createTagJobStore((input, init) => {
    const url = String(input);
    bodies.push([url.replace("http://db.test/rest/v1/rpc/", ""), JSON.parse(String(init?.body))]);
    if (url.endsWith("jev_take_lease")) return Promise.resolve(Response.json(lease));
    if (url.endsWith("jev_reserve_calls")) return Promise.resolve(Response.json(grant));
    return Promise.resolve(new Response(null, { status: 204 }));
  }, "http://db.test/", "service-role-test");
  assertEquals(await jobs.takeLease(RUN, 180), true);
  lease = false;
  assertEquals(await jobs.takeLease(RUN, 180), false);
  lease = [];
  assertEquals(await jobs.takeLease(RUN, 180), false);
  assertEquals(await jobs.reserveCalls(COMPANY, RUN, 3), 2);
  grant = 9;
  assertEquals(await jobs.reserveCalls(COMPANY, RUN, 3), 3);
  grant = -1;
  await assertRejects(() => jobs.reserveCalls(COMPANY, RUN, 3), Error, "store");
  grant = "x";
  await assertRejects(() => jobs.reserveCalls(COMPANY, RUN, 3), Error, "store");
  const usage: CompanyUsage = { calls: 2, input_tokens: 10, output_tokens: 4, tagged: 1, failed: 1 };
  await jobs.finishUsage(COMPANY, RUN, usage);
  await jobs.releaseLease(RUN);
  assertEquals(bodies[0], ["jev_take_lease", { p_holder: RUN, p_seconds: 180 }]);
  assertEquals(bodies[3], ["jev_reserve_calls", { p_company: COMPANY, p_run: RUN, p_want: 3 }]);
  assertEquals(bodies.at(-2), ["jev_finish_usage", {
    p_company: COMPANY,
    p_run: RUN,
    p_calls: 2,
    p_input_tokens: 10,
    p_output_tokens: 4,
    p_tagged: 1,
    p_failed: 1,
  }]);
  assertEquals(bodies.at(-1), ["jev_release_lease", { p_holder: RUN }]);
});

Deno.test("a failed call marks the line, and usage counts every call per company", async () => {
  const store = memoryStore();
  const usage = new Map<string, CompanyUsage>();
  let calls = 0;
  const report = await tagWork([company({
    mode: "shadow",
    expenses: [expense(), expense({ id: SECOND })],
  })], store, () => {
    calls += 1;
    if (calls === 1) return Promise.reject(new JevError("timeout"));
    return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: { input_tokens: 7, output_tokens: 2 } });
  }, "jev-test-key", { usage, log: () => {} });
  assertEquals(report.failed, 1);
  assertEquals(report.tagged, 1);
  assertEquals(store.failed, [EXPENSE]);
  assertEquals(usage.get(COMPANY), { calls: 2, input_tokens: 7, output_tokens: 2, tagged: 1, failed: 1 });
});

Deno.test("the candidate query skips a failed line until its retry time", () => {
  const path = transactionsPath(COMPANY, 10, NOW_ISO);
  assert(path.includes("failed:jev_line_failures()"));
  assert(path.includes(`failed.model_version=eq.${JEV_MODEL}`));
  assert(path.includes(`failed.retry_after=gt.${encodeURIComponent(NOW_ISO)}`));
  assert(path.includes("failed=is.null"));
});

type JobLog = { rpc: string[]; jev: number; key: number };

function jobRun(options: { lease?: boolean; grant?: (want: number) => number; fail?: "unauthorized" }) {
  const log: JobLog = { rpc: [], jev: 0, key: 0 };
  const finished: unknown[] = [];
  const run = handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { "x-flow-cron": "cron-test" },
  }), {
    fetch: (input, init) => {
      const url = String(input);
      if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
      const rpc = /\/rpc\/(\w+)$/.exec(url)?.[1];
      if (rpc) {
        log.rpc.push(rpc);
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (rpc === "jev_take_lease") return Promise.resolve(Response.json(options.lease ?? true));
        if (rpc === "jev_reserve_calls") return Promise.resolve(Response.json((options.grant ?? ((want) => want))(body.p_want)));
        if (rpc === "jev_finish_usage") finished.push(body);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (init?.method && init.method !== "GET") return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([{ company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 }]));
      }
      if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
      if (url.includes("/transactions")) {
        return Promise.resolve(Response.json([txnRow(), txnRow({ id: SECOND }), txnRow({ id: THIRD })]));
      }
      return Promise.resolve(Response.json([]));
    },
    env: tagEnv,
    rateState: { lastAt: -1 },
    runId: () => RUN,
    log: () => {},
    readKey: () => {
      log.key += 1;
      return Promise.resolve("jev-test-key");
    },
    call: () => {
      log.jev += 1;
      if (options.fail) return Promise.reject(new JevError(options.fail));
      return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: { input_tokens: 5, output_tokens: 1 } });
    },
  });
  return { run, log, finished };
}

Deno.test("a run that finds the lease taken is 409 and does not call Jev", async () => {
  const { run, log } = jobRun({ lease: false });
  const response = await run;
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "busy");
  assertEquals(log.jev, 0);
  assertEquals(log.key, 0);
  assertEquals(log.rpc, ["jev_take_lease"]);
});

Deno.test("the run sends only the calls the cap granted, logs usage, and frees the lease", async () => {
  const { run, log, finished } = jobRun({ grant: () => 1 });
  const response = await run;
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.tagged, 1);
  assertEquals(body.cap_skipped, 2);
  assertEquals(body.skipped, 2);
  assertEquals(log.jev, 1);
  assertEquals(finished, [{
    p_company: COMPANY,
    p_run: RUN,
    p_calls: 1,
    p_input_tokens: 5,
    p_output_tokens: 1,
    p_tagged: 1,
    p_failed: 0,
  }]);
  assertEquals(log.rpc, ["jev_take_lease", "jev_line_flags", "jev_reserve_calls", "jev_finish_usage", "jev_release_lease"]);
});

Deno.test("a spent cap does not read the key or call Jev", async () => {
  const { run, log, finished } = jobRun({ grant: () => 0 });
  const response = await run;
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.cap_skipped, 3);
  assertEquals(log.jev, 0);
  assertEquals(log.key, 0);
  assertEquals((finished as { p_calls: number }[]).map((row) => row.p_calls), [0]);
  assertEquals(log.rpc, ["jev_take_lease", "jev_line_flags", "jev_reserve_calls", "jev_finish_usage", "jev_release_lease"]);
});

Deno.test("a stopped run still records the call it made and frees the lease", async () => {
  const { run, log, finished } = jobRun({ fail: "unauthorized" });
  const response = await run;
  assertEquals(response.status, 500);
  assertEquals(log.jev, 1);
  assertEquals((finished[0] as { p_calls: number }).p_calls, 1);
  assertEquals(log.rpc.at(-1), "jev_release_lease");
});

Deno.test("a reserve that throws for one company still finishes the companies before it", async () => {
  const other = "66666666-6666-4666-8666-666666666666";
  const reserved: string[] = [];
  await assertRejects(() => applyDailyCap([
    company(),
    company({ companyId: other, expenses: [expense({ id: SECOND, companyId: other })] }),
  ], {
    reserveCalls: (companyId) => companyId === other ? Promise.reject(new Error("store")) : Promise.resolve(1),
  }, RUN, reserved));
  assertEquals(reserved, [COMPANY, other]);
});

Deno.test("a suggestion that cannot be saved marks the line", async () => {
  const store = memoryStore();
  store.saveSuggestion = () => Promise.reject(new Error("store"));
  const report = await tagWork([company({ mode: "shadow" })], store, () =>
    Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null }), "jev-test-key", { log: () => {} });
  assertEquals(report.failed, 1);
  assertEquals(store.failed, [EXPENSE]);
});

Deno.test("three provider failures in a row end the run without sending the rest", async () => {
  const store = memoryStore();
  const ids = [EXPENSE, SECOND, THIRD, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"];
  let calls = 0;
  const report = await tagWork([company({ mode: "shadow", expenses: ids.map((id) => expense({ id })) })], store, () => {
    calls += 1;
    return Promise.reject(new JevError("unavailable"));
  }, "jev-test-key", { log: () => {} });
  assertEquals(calls, 3);
  assertEquals(report.failed, 3);
  assertEquals(report.skipped, 2);
  assertEquals(store.failed, ids.slice(0, 3));

  let mixed = 0;
  const bad = await tagWork([company({ mode: "shadow", expenses: ids.map((id) => expense({ id })) })], memoryStore(), () => {
    mixed += 1;
    return Promise.reject(new JevError(mixed % 2 === 0 ? "invalid_request" : "timeout"));
  }, "jev-test-key", { log: () => {} });
  assertEquals(mixed, 5);
  assertEquals(bad.failed, 5);
});
