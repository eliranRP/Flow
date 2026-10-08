import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { JEV_MODEL, JEV_TIMEOUT_MS, JevError, callJev, type JevCall, type JevTimer } from "./jev.ts";
import {
  JEV_HISTORY_PER_SUPPLIER,
  JEV_TAG_ATTEMPTS,
  JEV_TAG_BUDGET_MS,
  JEV_TAG_DEFAULT_LIMIT,
  JEV_TAG_MAX_LIMIT,
  JEV_TAG_RESERVE_MS,
  StoreConflict,
  TagStop,
  allowTagRun,
  applyDailyCap,
  buildTagQuestions,
  buildTagState,
  capNewest,
  categoriesPath,
  clampTagLimit,
  companyQuotas,
  connectorDisabled,
  createTagJobStore,
  createTagStore,
  handleJevTag,
  integrationsPath,
  planTag,
  projectsPath,
  serviceRoleKey,
  tagJevCall,
  tagWork,
  transactionsPath,
  type CompanyUsage,
  type PrefillWrite,
  type SuggestionRow,
  type TagCompanyWork,
  type TagExpense,
  type TagFiling,
  type TagStore,
} from "./jev_tag.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
const EXPENSE = "44444444-4444-4444-8444-444444444444";
const COMPANY = "55555555-5555-4555-8555-555555555555";
const NOW_ISO = "2026-10-08T05:00:00.000Z";

function expense(overrides: Partial<TagExpense> = {}): TagExpense {
  return {
    id: EXPENSE,
    companyId: COMPANY,
    description: "מלט",
    docDate: "2026-04-12",
    supplierName: "מחסן",
    amountGross: -11800,
    amountNet: -10000,
    vatAmount: -1800,
    projectId: null,
    categoryId: null,
    projectAssigned: false,
    categoryAssigned: false,
    userAssigned: false,
    pnlRole: "project",
    allocationCount: 0,
    ...overrides,
  };
}

function txnRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPENSE,
    company_id: COMPANY,
    description: "מלט",
    doc_date: "2026-04-12",
    supplier_id: null,
    amount_gross: -11800,
    amount_net: -10000,
    vat_amount: -1800,
    project_id: null,
    category_id: null,
    project_assigned: false,
    category_assigned: false,
    user_assigned: false,
    pnl_role: "project",
    review_queue: [{ status: "open" }],
    allocations: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab" }],
    suppliers: { name: "מחסן" },
    tagged: null,
    ...overrides,
  };
}

const projects = [
  { id: PROJECT, name: "שיפוץ" },
  { id: OTHER, name: "מחסן" },
];
const categories = [{ id: CATEGORY, name: "חומרים" }];

function answers(projectConfidence = 0.95, categoryConfidence = 0.95) {
  return {
    project: { type: "choice", choice: PROJECT, confidence: projectConfidence, probabilities: { [PROJECT]: projectConfidence } },
    category: {
      type: "choice",
      choice: CATEGORY,
      confidence: categoryConfidence,
      probabilities: null,
    },
    amount_gross: 1,
  };
}

Deno.test("questions use project and category ids, and 256 options omit that question", () => {
  const questions = buildTagQuestions(projects, categories);
  assertEquals(questions.project.type, "choice");
  assertEquals(questions.category.type, "choice");
  if (questions.project.type === "choice") assertEquals(questions.project.criteria[PROJECT], "שיפוץ");
  const many = Array.from({ length: 256 }, (_, index) => ({ id: `p${index}`, name: `פרויקט ${index}` }));
  const capped = buildTagQuestions(many, categories);
  assertEquals("project" in capped, false);
  assertEquals("category" in capped, true);
});

Deno.test("state carries amounts for the model and the plan does not write them", () => {
  const row = expense();
  const state = buildTagState(row);
  assert(typeof state === "object" && state !== null && !Array.isArray(state));
  assertEquals(state.amount_net, -10000);
  const plan = planTag(row, "auto", 0.9, projects, categories, answers());
  const write = plan.write;
  assert(write);
  assertEquals(write.allocation?.amountNet, -10000);
  assertEquals("amount_gross" in write, false);
  assertEquals("vat_amount" in write, false);
  assertEquals("doc_date" in write, false);
  assertEquals(write.categorySuggested, true);
  assertEquals("projectAssigned" in write, false);
  assertEquals("userAssigned" in write, false);
});

Deno.test("auto at the threshold pre-fills, and just below it only plans a stored suggestion", () => {
  const at = planTag(expense(), "auto", 0.9, projects, categories, answers(0.9, 0.9));
  assertEquals(at.confidence, 0.9);
  assertEquals(at.write?.projectId, PROJECT);
  assertEquals(at.write?.categoryId, CATEGORY);
  const below = planTag(expense(), "auto", 0.9, projects, categories, answers(0.9, 0.89));
  assertEquals(below.confidence, 0.89);
  assertEquals(below.write, null);
  assertEquals(below.answers.category, answers(0.9, 0.89).category);
});

Deno.test("shadow stores the plan and does not pre-fill even at confidence 1", () => {
  const plan = planTag(expense(), "shadow", 0.9, projects, categories, answers(1, 1));
  assertEquals(plan.confidence, 1);
  assertEquals(plan.write, null);
});

Deno.test("a user-owned field stays, and a shared or split line does not take one project", () => {
  const owned = planTag(
    expense({ projectAssigned: true, projectId: OTHER }),
    "auto",
    0.9,
    projects,
    categories,
    answers(),
  );
  assertEquals(owned.write?.projectId, undefined);
  assertEquals(owned.write?.categoryId, CATEGORY);
  assertEquals(owned.write?.allocation, null);

  const categoryOwned = planTag(
    expense({ userAssigned: true, categoryId: CATEGORY }),
    "auto",
    0.9,
    projects,
    categories,
    answers(),
  );
  assertEquals(categoryOwned.write, null);

  const shared = planTag(expense({ pnlRole: "shared" }), "auto", 0.9, projects, categories, answers());
  assertEquals(shared.write?.projectId, undefined);
  assertEquals(shared.write?.categoryId, CATEGORY);

  const split = planTag(expense({ allocationCount: 2 }), "auto", 0.9, projects, categories, answers());
  assertEquals(split.write?.projectId, undefined);
});

Deno.test("an unknown choice or a missing answer fails closed and stores confidence 0", () => {
  const unknown = planTag(expense(), "auto", 0.9, projects, categories, {
    project: { choice: "not-a-project", confidence: 0.99 },
    category: { choice: CATEGORY, confidence: 0.99 },
  });
  assertEquals(unknown.confidence, 0);
  assertEquals(unknown.write, null);
  const missing = planTag(expense(), "auto", 0.9, projects, categories, {
    category: { choice: CATEGORY, confidence: 0.99, probabilities: null },
  });
  assertEquals(missing.confidence, 0);
  assertEquals(missing.write, null);
});

Deno.test("capNewest keeps the newest expenses and clamps the run cap", () => {
  const older = expense({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", docDate: "2026-04-01" });
  const newer = expense({ id: EXPENSE, docDate: "2026-04-12" });
  const picked = capNewest([older, newer], 1);
  assertEquals(picked.map((row) => row.id), [EXPENSE]);
  assertEquals(JEV_TAG_DEFAULT_LIMIT, 50);
  assertEquals(JEV_TAG_MAX_LIMIT, 100);
  assertEquals(clampTagLimit(undefined), 50);
  assertEquals(clampTagLimit(0), 50);
  assertEquals(clampTagLimit(-3), 50);
  assertEquals(clampTagLimit("nope"), 50);
  assertEquals(clampTagLimit(1.9), 1);
  assertEquals(clampTagLimit(80), 80);
  assertEquals(clampTagLimit(100), 100);
  assertEquals(clampTagLimit(101), 100);
  assertEquals(clampTagLimit("1000"), 100);
});

Deno.test("the store reads only enabled Jev rows and open untagged expenses", async () => {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = String(input);
    urls.push(url);
    bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
    if (url.includes("/company_integrations")) {
      return Promise.resolve(Response.json([
        { company_id: COMPANY, enabled: true, mode: "auto", threshold: "0.90" },
        { company_id: COMPANY, enabled: true, mode: "live", threshold: 0.9 },
        { company_id: "66666666-6666-4666-8666-666666666666", enabled: true, mode: "off", threshold: 0.9 },
        { company_id: "77777777-7777-4777-8777-777777777777", enabled: false, mode: "shadow", threshold: 0.9 },
      ]));
    }
    if (url.includes("/projects")) return Promise.resolve(Response.json(projects));
    if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
    if (url.includes("/review_queue")) {
      return Promise.resolve(Response.json([
        { transaction_id: EXPENSE },
        { transaction_id: "88888888-8888-4888-8888-888888888888" },
      ]));
    }
    if (url.includes("/tag_suggestions") && (!init || init.method === "GET" || init.method === undefined)) {
      return Promise.resolve(Response.json([]));
    }
    if (url.includes("/transactions") && (!init || init.method === "GET" || init.method === undefined)) {
      return Promise.resolve(Response.json([
        txnRow(),
        txnRow({
          id: "88888888-8888-4888-8888-888888888888",
          company_id: "66666666-6666-4666-8666-666666666666",
          description: "other",
          doc_date: "2026-04-01",
        }),
        txnRow({
          id: "99999999-9999-4999-8999-999999999999",
          doc_date: "2026-04-11",
          tagged: [{ model_version: JEV_MODEL }],
        }),
        txnRow({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          doc_date: "2026-04-10",
          review_queue: [{ status: "approved" }],
        }),
      ]));
    }
    if (url.includes("/allocations") && (!init || init.method === "GET" || init.method === undefined)) {
      return Promise.resolve(Response.json([]));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const store = createTagStore(fetch, "http://db.test/", "service-role-test");
  const work = await store.listWork(20);
  assertEquals(work.length, 1);
  assertEquals(work[0].mode, "auto");
  assertEquals(work[0].threshold, 0.9);
  assertEquals(work[0].expenses.length, 1);
  assertEquals(work[0].expenses[0].companyId, COMPANY);
  assertEquals(work[0].expenses[0].id, EXPENSE);
  assertEquals(work[0].expenses[0].supplierName, "מחסן");
  assertEquals(work[0].expenses[0].allocationCount, 1);
  assert(urls.every((url) => !url.includes("66666666-6666-4666-8666-666666666666")));
  assert(urls.every((url) => !url.includes("77777777-7777-4777-8777-777777777777")));
  assert(urls.some((url) => url.includes(integrationsPath())));
  assert(urls.some((url) => url.includes(projectsPath(COMPANY))));
  assert(urls.some((url) => url.includes(categoriesPath(COMPANY))));
  assert(urls.every((url) => !url.includes("/review_queue?")));
  assert(urls.every((url) => !url.includes("/tag_suggestions?")));
  assert(urls.every((url) => !url.includes("/allocations?")));
  assert(urls.every((url) => !url.includes("/suppliers?")));
  assert(urls.every((url) => !url.includes("id=in.")));
  const transactions = urls.find((url) => url.includes("/transactions"));
  assert(transactions);
  assert(transactions.includes(`company_id=eq.${COMPANY}`));
  assert(transactions.includes("order=doc_date.desc,id.desc"));
  assert(transactions.endsWith("limit=20"));
  assert(transactions.includes("tagged=is.null"));
  assert(transactions.includes(`tagged.model_version=eq.${JEV_MODEL}`));
  assert(transactions.includes("review_queue!inner(status)"));
  assert(!transactions.includes(EXPENSE));
  assert(urls.every((url) => !url.includes("status=eq.approved")));
  assert(urls.every((url) => !url.includes("jev_supplier_history")), "no supplier, no history call");
});

const SUPPLIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function filing(overrides: Partial<TagFiling> = {}): TagFiling {
  return {
    docDate: "2026-03-01",
    description: "מלט",
    amountNet: -9000,
    projectId: PROJECT,
    categoryId: CATEGORY,
    pnlRole: "project",
    split: false,
    ...overrides,
  };
}

Deno.test("state carries the supplier's past filings with names, and none without history", () => {
  const plain = buildTagState(expense(), projects, categories);
  assert(typeof plain === "object" && plain !== null && !Array.isArray(plain));
  assertEquals("past_filings" in plain, false);
  const archived = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const history = [
    filing(),
    filing({ projectId: archived, categoryId: null, pnlRole: "shared", split: true }),
    ...Array.from({ length: 6 }, () => filing()),
  ];
  const state = buildTagState(expense({ history }), projects, categories);
  assert(typeof state === "object" && state !== null && !Array.isArray(state));
  const past = state.past_filings;
  assert(Array.isArray(past));
  assertEquals(past.length, JEV_HISTORY_PER_SUPPLIER);
  assertEquals(past[0], {
    doc_date: "2026-03-01",
    description: "מלט",
    amount_net: -9000,
    project_id: PROJECT,
    project_name: "שיפוץ",
    category_id: CATEGORY,
    category_name: categories.find((row) => row.id === CATEGORY)?.name ?? null,
    pnl_role: "project",
    split: false,
  });
  assertEquals(past[1], {
    doc_date: "2026-03-01",
    description: "מלט",
    amount_net: -9000,
    project_id: archived,
    project_name: null,
    category_id: null,
    category_name: null,
    pnl_role: "shared",
    split: true,
  });
});

Deno.test("the store loads each supplier's filed lines in one SQL call per company", async () => {
  const OTHER_SUPPLIER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/company_integrations")) {
      return Promise.resolve(Response.json([{ company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 }]));
    }
    if (url.includes("/projects")) return Promise.resolve(Response.json(projects));
    if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
    if (url.includes("/rpc/jev_supplier_history")) {
      return Promise.resolve(Response.json([
        { supplier_id: SUPPLIER, doc_date: "2026-03-01", description: "מלט", amount_net: -9000, project_id: PROJECT, category_id: CATEGORY, pnl_role: "project", split: false },
        { supplier_id: SUPPLIER, doc_date: "2026-02-01", description: "חול", amount_net: "-500", project_id: "not-an-id", category_id: null, pnl_role: null, split: true },
        { supplier_id: SUPPLIER, doc_date: null, amount_net: 1 },
      ]));
    }
    if (url.includes("/transactions")) {
      return Promise.resolve(Response.json([
        txnRow({ supplier_id: SUPPLIER }),
        txnRow({ id: "99999999-9999-4999-8999-999999999999", doc_date: "2026-04-11", supplier_id: OTHER_SUPPLIER }),
        txnRow({ id: "88888888-8888-4888-8888-888888888888", doc_date: "2026-04-10", supplier_id: SUPPLIER }),
      ]));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const store = createTagStore(fetch, "http://db.test/", "service-role-test");
  const work = await store.listWork(20);
  const history = calls.filter((call) => call.url.includes("/rpc/jev_supplier_history"));
  assertEquals(history.length, 1);
  assertEquals(history[0].body, {
    p_company: COMPANY,
    p_suppliers: [SUPPLIER, OTHER_SUPPLIER].sort(),
    p_per: JEV_HISTORY_PER_SUPPLIER,
  });
  const [first, other, third] = work[0].expenses;
  assertEquals(first.history, [
    filing(),
    filing({ docDate: "2026-02-01", description: "חול", amountNet: -500, projectId: null, categoryId: null, pnlRole: null, split: true }),
  ]);
  assertEquals(other.history, undefined);
  assertEquals(third.history?.length, 2);
});

Deno.test("a failed history read fails the listing like any other store read", async () => {
  const fetch: typeof globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("/company_integrations")) {
      return Promise.resolve(Response.json([{ company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 }]));
    }
    if (url.includes("/projects")) return Promise.resolve(Response.json(projects));
    if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
    if (url.includes("/rpc/jev_supplier_history")) return Promise.resolve(new Response(null, { status: 500 }));
    if (url.includes("/transactions")) return Promise.resolve(Response.json([txnRow({ supplier_id: SUPPLIER })]));
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const store = createTagStore(fetch, "http://db.test/", "service-role-test");
  await assertRejects(() => store.listWork(20), Error, "store");
});

Deno.test("prefill writes the suggestion flags and the allocation, and not the review", async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const store = createTagStore(fetch, "http://db.test", "service-role-test");
  const write: PrefillWrite = {
    companyId: COMPANY,
    transactionId: EXPENSE,
    projectId: PROJECT,
    categoryId: CATEGORY,
    categorySuggested: true,
    allocation: { projectId: PROJECT, amountNet: -10000 },
  };
  await store.prefill(write);
  const patch = calls.find((call) => call.method === "PATCH");
  assert(patch);
  assertEquals(patch.body, { project_id: PROJECT, category_id: CATEGORY, category_suggested: true });
  assert(patch.url.includes("/transactions"));
  assertEquals(calls.some((call) => call.url.includes("/review_queue")), false);
  const allocation = calls.find((call) => call.method === "POST" && call.url.endsWith("/allocations"));
  assertEquals(allocation?.body, {
    company_id: COMPANY,
    transaction_id: EXPENSE,
    project_id: PROJECT,
    share_bp: 10000,
    amount_net: -10000,
  });
});

Deno.test("a returned model other than the pin is stored on the suggestion", async () => {
  const store = memoryStore();
  const report = await tagWork([company({ mode: "shadow" })], store, () => Promise.resolve({
    model: "jev-1.99.0",
    answers: answers(),
    usage: null,
  }), "jev-test-key");
  assertEquals(report.tagged, 1);
  assertEquals(store.suggestions[0].modelVersion, "jev-1.13.0");
  assertEquals(store.suggestions[0].responseModel, "jev-1.99.0");

  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Promise.resolve(new Response(null, { status: 201 }));
  };
  const db = createTagStore(fetch, "http://db.test", "service-role-test");
  await db.saveSuggestion(store.suggestions[0]);
  assertEquals(calls[0].url, "http://db.test/rest/v1/tag_suggestions");
  assertEquals(calls[0].body, {
    company_id: COMPANY,
    transaction_id: EXPENSE,
    answers: store.suggestions[0].answers,
    confidence: store.suggestions[0].confidence,
    model_version: "jev-1.13.0",
    response_model: "jev-1.99.0",
  });
});

function memoryStore(): TagStore & { suggestions: SuggestionRow[]; writes: PrefillWrite[]; failPrefill: boolean; failed: string[] } {
  const suggestions: SuggestionRow[] = [];
  const writes: PrefillWrite[] = [];
  const store = {
    suggestions,
    writes,
    failPrefill: false,
    listWork: () => Promise.resolve([]),
    saveSuggestion: (row: SuggestionRow) => {
      if (suggestions.some((saved) => saved.transactionId === row.transactionId && saved.modelVersion === row.modelVersion)) {
        return Promise.reject(new StoreConflict());
      }
      suggestions.push(row);
      return Promise.resolve();
    },
    prefill: (write: PrefillWrite) => {
      if (store.failPrefill) return Promise.reject(new Error("store"));
      writes.push(write);
      return Promise.resolve();
    },
    deleteSuggestion: (transactionId: string, modelVersion: string) => {
      const index = suggestions.findIndex((row) => row.transactionId === transactionId && row.modelVersion === modelVersion);
      if (index >= 0) suggestions.splice(index, 1);
      return Promise.resolve();
    },
    failed: [] as string[],
    markFailed: (_companyId: string, transactionId: string) => {
      store.failed.push(transactionId);
      return Promise.resolve();
    },
  };
  return store;
}

function company(overrides: Partial<TagCompanyWork> = {}): TagCompanyWork {
  return {
    companyId: COMPANY,
    mode: "auto",
    threshold: 0.9,
    projects,
    categories,
    expenses: [expense()],
    ...overrides,
  };
}

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
  assertEquals(seen[0].state, buildTagState(expense()));

  const auto = memoryStore();
  const autoReport = await tagWork([company()], auto, call, "jev-test-key");
  assertEquals(autoReport.prefilled, 1);
  assertEquals(auto.writes[0].projectId, PROJECT);
  assertEquals(auto.writes[0].categorySuggested, true);

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

function tagEnv(name: string): string {
  if (name === "CRON_SECRET") return "cron-test";
  if (name === "SUPABASE_URL") return "http://db.test";
  if (name === "SUPABASE_SECRET_KEYS") return JSON.stringify({ default: "service-role-test" });
  return "";
}

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
      calls.push(url);
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([
          { company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 },
        ]));
      }
      if (url.includes("/projects")) return Promise.resolve(Response.json(projects));
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
      enabledUrls.push(url);
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([
          { company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 },
          { company_id: "66666666-6666-4666-8666-666666666666", enabled: true, mode: "shadow", threshold: 0.9 },
        ]));
      }
      if (url.includes("/projects")) return Promise.resolve(Response.json(projects));
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
      hardCapUrls.push(url);
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([
          { company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 },
        ]));
      }
      if (url.includes("/projects")) return Promise.resolve(Response.json(projects));
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

/** Lets the job's lease and cap RPCs succeed: the lease is free and the cap grants every call. */
function withJobs(fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof globalThis.fetch {
  return (input, init) => {
    const url = String(input);
    if (url.endsWith("/rpc/jev_take_lease")) return Promise.resolve(Response.json(true));
    if (url.endsWith("/rpc/jev_reserve_calls")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { p_want?: number };
      return Promise.resolve(Response.json(body.p_want ?? 0));
    }
    if (/\/rpc\/jev_(release_lease|finish_usage|mark_failed)$/.test(url)) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return fetch(input, init);
  };
}

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
      if (init?.method && init.method !== "GET") return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([
          { company_id: COMPANY_A, enabled: true, mode: "shadow", threshold: 0.9 },
          { company_id: COMPANY_B, enabled: true, mode: "shadow", threshold: 0.9 },
        ]));
      }
      if (url.includes("/projects")) return Promise.resolve(Response.json(projects));
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
      urls.push(url);
      if (init?.method && init.method !== "GET") return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([
          { company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 },
        ]));
      }
      if (url.includes("/projects")) return Promise.resolve(Response.json(projects));
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
      if (url.includes("/projects")) return Promise.resolve(Response.json(projects));
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
  assertEquals(log.rpc, ["jev_take_lease", "jev_reserve_calls", "jev_finish_usage", "jev_release_lease"]);
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
  assertEquals(log.rpc, ["jev_take_lease", "jev_reserve_calls", "jev_finish_usage", "jev_release_lease"]);
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
