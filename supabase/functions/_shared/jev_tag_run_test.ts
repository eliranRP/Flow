// Jev tagging tests: tagWork and the HTTP handler (auth, rate limit, cap, time budget, attempts).
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { JEV_MODEL, JEV_TIMEOUT_MS, JevError, callJev, type JevCall, type JevTimer } from "./jev.ts";
import {
  JEV_TAG_ATTEMPTS,
  JEV_TAG_BUDGET_MS,
  TagStop,
  allowTagRun,
  buildTagState,
  connectorDisabled,
  handleJevTag,
  serviceRoleKey,
  tagJevCall,
  tagWork,
  transactionsPath,
} from "./jev_tag.ts";
import {
  answers,
  categories,
  CATEGORY,
  company,
  COMPANY,
  expense,
  EXPENSE,
  filing,
  memoryStore,
  NOW_ISO,
  PROJECT,
  projects,
  tagEnv,
  txnRow,
  withJobs,
} from "./jev_tag_test_support.ts";

Deno.test("tagWork stores shadow, pre-fills auto, and does not keep a suggestion when prefill fails", async () => {
  const seen: JevCall[] = [];
  const call = (_key: string, input: JevCall) => {
    seen.push(input);
    return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });
  };
  const shadow = memoryStore();
  const shadowReport = await tagWork([company({ mode: "shadow" })], shadow, call, "jev-test-key");
  assertEquals(shadowReport.tagged, 1);
  assertEquals(shadowReport.prefilled, 0);
  assertEquals(shadow.writes.length, 0);
  assertEquals(shadow.suggestions[0].modelVersion, "jev-1.13.0");
  assertEquals(shadow.suggestions[0].responseModel, "jev-1.13.0");
  assertEquals(seen[0].state, buildTagState(expense(), projects, categories));

  const withHistory = memoryStore();
  seen.length = 0;
  await tagWork([company({ mode: "shadow", expenses: [expense({ history: [filing()] })] })], withHistory, call, "jev-test-key");
  const sent = seen[0].state;
  assert(typeof sent === "object" && sent !== null && !Array.isArray(sent));
  const past = sent.past_filings;
  assert(Array.isArray(past) && past.length === 1);
  assertEquals((past[0] as Record<string, unknown>).project_name, "שיפוץ");

  const auto = memoryStore();
  const autoReport = await tagWork([company()], auto, call, "jev-test-key");
  assertEquals(autoReport.prefilled, 1);
  assertEquals(auto.writes[0].projectId, PROJECT);
  assertEquals(auto.writes[0].categoryId, CATEGORY);
  assertEquals(auto.writes[0].modelVersion, JEV_MODEL);

  const broken = memoryStore();
  broken.failPrefill = true;
  const brokenReport = await tagWork([company()], broken, call, "jev-test-key");
  assertEquals(brokenReport.failed, 1);
  assertEquals(brokenReport.prefilled, 0);
  assertEquals(broken.suggestions.length, 0);
  assertEquals(broken.failed, [EXPENSE]);

  let calls = 0;
  const again = await tagWork([company()], auto, () => {
    calls += 1;
    return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });
  }, "jev-test-key");
  assertEquals(again.skipped, 1);
  assertEquals(calls, 1);
});

Deno.test("a Jev failure does not store a suggestion, and unauthorized stops the run", async () => {
  const store = memoryStore();
  const report = await tagWork([company()], store, () => Promise.reject(new JevError("timeout")), "jev-test-key");
  assertEquals(report.failed, 1);
  assertEquals(store.suggestions.length, 0);
  await assertRejects(
    () => tagWork([company()], store, () => Promise.reject(new JevError("unauthorized")), "jev-test-key"),
    TagStop,
    "unauthorized",
  );
  assertEquals(store.suggestions.length, 0);
});

Deno.test("off and a bad cron secret do not call Jev", async () => {
  const calls: string[] = [];
  const response = await handleJevTag(new Request("http://local/jev-tag", { method: "POST" }), {
    fetch: withJobs(() => {
      calls.push("fetch");
      return Promise.resolve(Response.json([]));
    }),
    env: () => "",
    call: () => {
      calls.push("jev");
      return Promise.resolve({ model: JEV_MODEL, answers: {}, usage: null });
    },
  });
  assertEquals(response.status, 401);
  assertEquals(calls, []);

  const off = await handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { "x-flow-cron": "cron-test" },
  }), {
    fetch: withJobs((input) => {
      calls.push(String(input));
      if (String(input).includes("read_jev_api_key")) return Promise.resolve(Response.json("jev-test-key"));
      return Promise.resolve(Response.json([]));
    }),
    env: (name) => {
      if (name === "CRON_SECRET") return "cron-test";
      if (name === "SUPABASE_URL") return "http://db.test";
      if (name === "SUPABASE_SECRET_KEYS") return JSON.stringify({ default: "service-role-test" });
      return "";
    },
    rateState: { lastAt: -1 },
    call: () => {
      calls.push("jev");
      return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });
    },
  });
  assertEquals(off.status, 200);
  const body = await off.json();
  assertEquals(body.tagged, 0);
  assertEquals(calls.includes("jev"), false);
  assert(calls.some((url) => url.includes("provider=eq.jev")));
  assert(calls.every((url) => !url.includes("enabled=eq.true")));
  assert(calls.every((url) => !url.includes("read_jev_api_key")));
});

Deno.test("either enabled false or mode off disables the connector", () => {
  assertEquals(connectorDisabled(false, "auto"), true);
  assertEquals(connectorDisabled(false, "shadow"), true);
  assertEquals(connectorDisabled(true, "off"), true);
  assertEquals(connectorDisabled(true, "shadow"), false);
  assertEquals(connectorDisabled(true, "auto"), false);
  assertEquals(connectorDisabled(true, "live"), true);
});

Deno.test("an expense from another company is not sent or stored", async () => {
  const foreignId = "99999999-9999-4999-8999-999999999999";
  const foreignCompany = "66666666-6666-4666-8666-666666666666";
  const store = memoryStore();
  let calls = 0;
  const report = await tagWork([company({
    expenses: [expense(), expense({ id: foreignId, companyId: foreignCompany })],
  })], store, () => {
    calls += 1;
    return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });
  }, "jev-test-key");
  assertEquals(calls, 1);
  assertEquals(report.failed, 1);
  assertEquals(report.prefilled, 1);
  assertEquals(store.suggestions.map((row) => row.companyId), [COMPANY]);
  assertEquals(store.suggestions.map((row) => row.transactionId), [EXPENSE]);
  assertEquals(store.writes[0].companyId, COMPANY);
});

Deno.test("only the cron secret or the service role key may run the job", async () => {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = () => {
    calls.push("fetch");
    return Promise.resolve(Response.json([]));
  };
  const user = await handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { authorization: "Bearer user-jwt" },
  }), { fetch, env: tagEnv, rateState: { lastAt: -1 } });
  assertEquals(user.status, 401);
  assertEquals(calls, []);

  const service = await handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { authorization: "Bearer service-role-test" },
  }), {
    fetch: withJobs((input) => {
      calls.push(String(input));
      return Promise.resolve(Response.json([]));
    }),
    env: tagEnv,
    rateState: { lastAt: -1 },
    readKey: () => Promise.resolve("jev-test-key"),
    call: () => {
      calls.push("jev");
      return Promise.resolve({ model: JEV_MODEL, answers: {}, usage: null });
    },
  });
  assertEquals(service.status, 200);
  assertEquals(calls.includes("jev"), false);
  assert(calls.some((url) => url.includes("provider=eq.jev")));
});

Deno.test("a second run inside the interval is rate limited and does not call Jev", async () => {
  const state = { lastAt: -1 };
  assertEquals(allowTagRun(state, 1_000, 60_000).ok, true);
  const blocked = allowTagRun(state, 2_000, 60_000);
  assertEquals(blocked.ok, false);
  if (!blocked.ok) assertEquals(blocked.retryAfterSeconds, 59);
  assertEquals(allowTagRun(state, 61_000, 60_000).ok, true);
  assertEquals(allowTagRun({ lastAt: -1 }, Number.NaN, 60_000).ok, false);

  const calls: string[] = [];
  const lines: string[] = [];
  const rateState = { lastAt: -1 };
  const run = (now: number) => handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { "x-flow-cron": "cron-test" },
  }), {
    fetch: withJobs((input) => {
      const url = String(input);
      if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
      calls.push(url);
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([
          { company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 },
        ]));
      }
      if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
      if (url.includes("/transactions")) return Promise.resolve(Response.json([txnRow()]));
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
    env: tagEnv,
    now: () => now,
    rateState,
    intervalMs: 60_000,
    log: (line) => lines.push(line),
    readKey: () => {
      calls.push("key");
      return Promise.resolve("jev-test-key");
    },
    call: () => {
      calls.push("jev");
      return Promise.resolve({
        model: JEV_MODEL,
        answers: answers(),
        usage: { input_tokens: 12, output_tokens: 3 },
      });
    },
  });
  const before = calls.filter((item) => item === "jev").length;
  const first = await run(10_000);
  assertEquals(first.status, 200);
  const firstBody = await first.json();
  assertEquals(firstBody.input_tokens, 12);
  assertEquals(firstBody.output_tokens, 3);
  const firstJev = calls.filter((item) => item === "jev").length - before;
  assert(firstJev >= 1);
  assertEquals(lines.length, 1);
  assert(lines[0].includes("input_tokens=12"));
  assert(lines[0].includes("output_tokens=3"));
  assert(!lines[0].includes("מלט"));
  assert(!lines[0].includes(EXPENSE));
  const jevAfterFirst = calls.filter((item) => item === "jev").length;
  const second = await run(11_000);
  assertEquals(second.status, 429);
  assertEquals(second.headers.get("retry-after"), "59");
  const body = await second.json();
  assertEquals(body.error, "rate_limited");
  assertEquals(calls.filter((item) => item === "jev").length - jevAfterFirst, 0);
  assertEquals(calls.filter((item) => item === "key"), ["key"]);
});

Deno.test("a wrong non-empty cron header is 401 and does not call Jev", async () => {
  const calls: string[] = [];
  const response = await handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { "x-flow-cron": "not-the-secret" },
  }), {
    fetch: withJobs(() => {
      calls.push("fetch");
      return Promise.resolve(Response.json([]));
    }),
    env: tagEnv,
    rateState: { lastAt: -1 },
    call: () => {
      calls.push("jev");
      return Promise.resolve({ model: JEV_MODEL, answers: {}, usage: null });
    },
  });
  assertEquals(response.status, 401);
  assertEquals(calls, []);
  const body = await response.json();
  assertEquals(body.error, "unauthorized");
});

Deno.test("a missing service key fails closed and ignores the legacy env var", async () => {
  assertEquals(serviceRoleKey(() => ""), "");
  assertEquals(serviceRoleKey((name) => name === "SUPABASE_SECRET_KEYS" ? "not-json" : ""), "");
  assertEquals(serviceRoleKey((name) => name === "SUPABASE_SECRET_KEYS" ? "{}" : ""), "");
  assertEquals(serviceRoleKey((name) => name === "SUPABASE_SECRET_KEYS" ? JSON.stringify({ default: 1 }) : ""), "");
  assertEquals(
    serviceRoleKey((name) => name === "SUPABASE_SECRET_KEYS" ? JSON.stringify({ default: "service-role-test" }) : ""),
    "service-role-test",
  );

  const calls: string[] = [];
  const response = await handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { "x-flow-cron": "cron-test" },
  }), {
    fetch: withJobs(() => {
      calls.push("fetch");
      return Promise.resolve(Response.json([]));
    }),
    env: (name) => {
      if (name === "CRON_SECRET") return "cron-test";
      if (name === "SUPABASE_URL") return "http://db.test";
      if (name === "SUPABASE_SERVICE_ROLE_KEY") return "legacy-ignored";
      return "";
    },
    rateState: { lastAt: -1 },
    call: () => {
      calls.push("jev");
      return Promise.resolve({ model: JEV_MODEL, answers: {}, usage: null });
    },
  });
  assertEquals(response.status, 500);
  assertEquals((await response.json()).error, "missing_key");
  assertEquals(calls, []);
});

Deno.test("the handler clamps a passed cap, filters one company, and skips Vault when nothing is enabled", async () => {
  const urls: string[] = [];
  const keys: string[] = [];
  const run = (body: string | undefined, rateState: { lastAt: number }) => handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: {
      "x-flow-cron": "cron-test",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body,
  }), {
    fetch: withJobs((input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([
          { company_id: COMPANY, enabled: false, mode: "shadow", threshold: 0.9 },
          { company_id: "66666666-6666-4666-8666-666666666666", enabled: true, mode: "off", threshold: 0.9 },
        ]));
      }
      return Promise.resolve(Response.json([]));
    }),
    env: tagEnv,
    rateState,
    log: () => {},
    readKey: () => {
      keys.push("key");
      return Promise.resolve("jev-test-key");
    },
    call: () => {
      keys.push("jev");
      return Promise.resolve({ model: JEV_MODEL, answers: {}, usage: null });
    },
  });

  const disabled = await run(JSON.stringify({ limit: 1000, company_id: COMPANY }), { lastAt: -1 });
  assertEquals(disabled.status, 200);
  assertEquals(keys, []);
  assert(urls.some((url) => url.includes(`company_id=eq.${COMPANY}`) && url.includes("provider=eq.jev")));
  assert(urls.every((url) => !url.includes("/transactions")));
  assert(urls.every((url) => !url.includes("read_jev_api_key")));

  const enabledUrls: string[] = [];
  const capped = await handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { "x-flow-cron": "cron-test", "content-type": "application/json" },
    body: JSON.stringify({ limit: 1 }),
  }), {
    fetch: withJobs((input) => {
      const url = String(input);
      if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
      enabledUrls.push(url);
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([
          { company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 },
          { company_id: "66666666-6666-4666-8666-666666666666", enabled: true, mode: "shadow", threshold: 0.9 },
        ]));
      }
      if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
      if (url.includes("/transactions") && url.includes(`company_id=eq.${COMPANY}`)) {
        return Promise.resolve(Response.json([txnRow()]));
      }
      if (url.includes("/transactions")) return Promise.resolve(Response.json([]));
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
    env: tagEnv,
    rateState: { lastAt: -1 },
    log: () => {},
    readKey: () => Promise.resolve("jev-test-key"),
    call: () => Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null }),
  });
  assertEquals(capped.status, 200);
  const transactionUrls = enabledUrls.filter((url) => url.includes("/transactions"));
  assertEquals(transactionUrls.length, 1);
  assert(transactionUrls[0].endsWith("limit=1"));
  assert(transactionUrls[0].includes("order=doc_date.desc"));
  assert(!transactionUrls[0].includes("id=in."));
  assert(enabledUrls.every((url) => !url.includes("66666666-6666-4666-8666-666666666666")));

  const hardCapUrls: string[] = [];
  const hardCap = await handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { "x-flow-cron": "cron-test", "content-type": "application/json" },
    body: JSON.stringify({ limit: 1000 }),
  }), {
    fetch: withJobs((input) => {
      const url = String(input);
      if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
      hardCapUrls.push(url);
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([
          { company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 },
        ]));
      }
      if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
      if (url.includes("/transactions")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json([]));
    }),
    env: tagEnv,
    rateState: { lastAt: -1 },
    log: () => {},
    readKey: () => Promise.reject(new Error("vault")),
  });
  assertEquals(hardCap.status, 200);
  const hardTransactions = hardCapUrls.filter((url) => url.includes("/transactions"));
  assertEquals(hardTransactions.length, 1);
  assert(hardTransactions[0].endsWith("limit=100"));
  assert(!hardTransactions[0].includes("limit=1000"));

  const bad = await handleJevTag(new Request("http://local/jev-tag", {
    method: "POST",
    headers: { authorization: "Bearer service-role-test", "content-type": "application/json" },
    body: JSON.stringify({ company_id: "not-a-uuid" }),
  }), {
    fetch: () => Promise.reject(new Error("fetch")),
    env: tagEnv,
    rateState: { lastAt: -1 },
  });
  assertEquals(bad.status, 400);
});

Deno.test("the run stops at the time budget and reports the expenses it skipped", async () => {
  const second = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const third = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let clock = 0;
  let calls = 0;
  const store = memoryStore();
  const report = await tagWork([company({
    mode: "shadow",
    expenses: [
      expense(),
      expense({ id: second, docDate: "2026-04-11" }),
      expense({ id: third, docDate: "2026-04-10" }),
    ],
  })], store, () => {
    calls += 1;
    clock = JEV_TAG_BUDGET_MS;
    return Promise.resolve({
      model: JEV_MODEL,
      answers: answers(),
      usage: { input_tokens: 10, output_tokens: 4 },
    });
  }, "jev-test-key", {
    now: () => clock,
    budgetMs: JEV_TAG_BUDGET_MS,
    log: () => {},
  });
  assertEquals(calls, 1);
  assertEquals(report.tagged, 1);
  assertEquals(report.budget_skipped, 2);
  assertEquals(report.skipped, 2);
  assertEquals(report.input_tokens, 10);
  assertEquals(report.output_tokens, 4);
  assertEquals(store.suggestions.length, 1);

  let blocked = 0;
  const none = await tagWork([company({
    expenses: [expense(), expense({ id: second })],
  })], memoryStore(), () => {
    blocked += 1;
    return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });
  }, "jev-test-key", {
    now: (() => {
      let reads = 0;
      return () => {
        reads += 1;
        return reads === 1 ? 0 : JEV_TAG_BUDGET_MS;
      };
    })(),
    budgetMs: JEV_TAG_BUDGET_MS,
    log: () => {},
  });
  assertEquals(blocked, 0);
  assertEquals(none.budget_skipped, 2);
  assertEquals(none.tagged, 0);
});

Deno.test("the candidate query orders by date descending and limits to the cap", () => {
  const path = transactionsPath(COMPANY, 1000, NOW_ISO);
  assert(path.includes("order=doc_date.desc,id.desc"));
  assert(path.endsWith("limit=100"));
  assert(path.includes("tagged=is.null"));
  assert(path.includes("review_queue!inner(status)"));
  assert(!path.includes("id=in."));
  assert(!path.includes(EXPENSE));
  assertEquals(transactionsPath(COMPANY, 20, NOW_ISO).includes("limit=20"), true);
});

const quietTimer: JevTimer = {
  sleep() {
    return Promise.resolve();
  },
  arm(_ms, _fire) {
    return { cancel() {} };
  },
};

Deno.test("each expense gets at most two attempts and the body has no max-output field", async () => {
  const bodies: string[] = [];
  let calls = 0;
  const sample: JevCall = {
    state: { description: "מלט" },
    questions: {
      project: { type: "choice", instructions: "Choose the project id for this expense.", criteria: { [PROJECT]: "שיפוץ" } },
    },
  };
  await assertRejects(() => tagJevCall((_url, init) => {
    calls += 1;
    bodies.push(String(init?.body ?? ""));
    return Promise.resolve(new Response("{}", { status: 429, headers: { "retry-after": "1" } }));
  }, quietTimer)("test-key", sample), JevError, "rate_limited");
  assertEquals(calls, JEV_TAG_ATTEMPTS);
  assertEquals(JEV_TAG_ATTEMPTS, 2);
  assertEquals(JEV_TIMEOUT_MS, 8000);
  const sent = JSON.parse(bodies[0]) as Record<string, unknown>;
  assertEquals(sent.model, JEV_MODEL);
  assertEquals("max_tokens" in sent, false);
  assertEquals("max_output_tokens" in sent, false);
  assertEquals("question" in sent, false);

  let uncapped = 0;
  await assertRejects(() => callJev("test-key", sample, {
    timer: quietTimer,
    fetch: withJobs(() => {
      uncapped += 1;
      return Promise.resolve(new Response("{}", { status: 429 }));
    }),
  }), JevError, "rate_limited");
  assertEquals(uncapped, 4);
});
