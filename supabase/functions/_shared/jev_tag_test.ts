import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { JEV_MODEL, JevError, type JevCall } from "./jev.ts";
import {
  JEV_TAG_LIMIT,
  StoreConflict,
  TagStop,
  buildTagQuestions,
  buildTagState,
  categoriesPath,
  createTagStore,
  handleJevTag,
  integrationsPath,
  planTag,
  projectsPath,
  reviewQueuePath,
  selectUntagged,
  suggestionsPath,
  tagWork,
  transactionsPath,
  type PrefillWrite,
  type SuggestionRow,
  type TagCompanyWork,
  type TagExpense,
  type TagStore,
} from "./jev_tag.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
const EXPENSE = "44444444-4444-4444-8444-444444444444";
const COMPANY = "55555555-5555-4555-8555-555555555555";

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

Deno.test("selectUntagged keeps open untagged expenses, oldest first, and respects the limit", () => {
  const older = expense({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", docDate: "2026-04-01" });
  const newer = expense({ id: EXPENSE, docDate: "2026-04-12" });
  const tagged = expense({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", docDate: "2026-03-01" });
  const closed = expense({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", docDate: "2026-01-01" });
  const picked = selectUntagged(
    [older.id, newer.id, tagged.id],
    [tagged.id],
    [newer, tagged, closed, older],
    1,
  );
  assertEquals(picked.map((row) => row.id), [older.id]);
  assertEquals(JEV_TAG_LIMIT, 20);
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
        { company_id: COMPANY, mode: "auto", threshold: "0.90" },
        { company_id: COMPANY, mode: "live", threshold: 0.9 },
      ]));
    }
    if (url.includes("/projects")) return Promise.resolve(Response.json(projects));
    if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
    if (url.includes("/review_queue")) return Promise.resolve(Response.json([{ transaction_id: EXPENSE }]));
    if (url.includes("/tag_suggestions") && (!init || init.method === "GET" || init.method === undefined)) {
      return Promise.resolve(Response.json([]));
    }
    if (url.includes("/transactions") && (!init || init.method === "GET" || init.method === undefined)) {
      return Promise.resolve(Response.json([{
        id: EXPENSE,
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
      }]));
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
  assert(urls.some((url) => url.includes(integrationsPath())));
  assert(urls.some((url) => url.includes(projectsPath(COMPANY))));
  assert(urls.some((url) => url.includes(categoriesPath(COMPANY))));
  assert(urls.some((url) => url.includes(reviewQueuePath(COMPANY))));
  assert(urls.some((url) => url.includes(suggestionsPath(COMPANY, JEV_MODEL))));
  assert(urls.some((url) => url.includes(transactionsPath(COMPANY, [EXPENSE]).split("&order=")[0])));
  assert(urls.every((url) => !url.includes("status=eq.approved")));
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

function memoryStore(): TagStore & { suggestions: SuggestionRow[]; writes: PrefillWrite[]; failPrefill: boolean } {
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
    fetch: () => {
      calls.push("fetch");
      return Promise.resolve(Response.json([]));
    },
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
    fetch: (input) => {
      calls.push(String(input));
      if (String(input).includes("read_jev_api_key")) return Promise.resolve(Response.json("jev-test-key"));
      return Promise.resolve(Response.json([]));
    },
    env: (name) => {
      if (name === "CRON_SECRET") return "cron-test";
      if (name === "SUPABASE_URL") return "http://db.test";
      if (name === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-test";
      return "";
    },
    call: () => {
      calls.push("jev");
      return Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });
    },
  });
  assertEquals(off.status, 200);
  const body = await off.json();
  assertEquals(body.tagged, 0);
  assertEquals(calls.includes("jev"), false);
  assert(calls.some((url) => url.includes("enabled=eq.true")));
});
