// Jev tagging tests: questions, state, planning (thresholds, owned fields) and the PostgREST store reads and writes.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { JEV_MODEL } from "./jev.ts";
import {
  JEV_HISTORY_PER_SUPPLIER,
  JEV_TAG_DEFAULT_LIMIT,
  JEV_TAG_MAX_LIMIT,
  buildTagQuestions,
  buildTagState,
  capNewest,
  categoriesPath,
  clampTagLimit,
  createTagStore,
  integrationsPath,
  planTag,
  tagWork,
  type PrefillWrite,
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
  INCOME_CATEGORY,
  incomeAnswers,
  incomeCategories,
  memoryStore,
  OTHER,
  PROJECT,
  projects,
  txnRow,
} from "./jev_tag_test_support.ts";
import { CARD_NAME_HINT, lineQuestions } from "./jev_tag_plan.ts";

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
  const state = buildTagState(row, projects, categories);
  assert(typeof state === "object" && state !== null && !Array.isArray(state));
  assertEquals(state.amount_net, -10000);
  const plan = planTag(row, "auto", 0.9, projects, categories, answers());
  const write = plan.write;
  assert(write);
  assertEquals("allocation" in write, false);
  assertEquals("amountNet" in write, false);
  assertEquals("amount_gross" in write, false);
  assertEquals("vat_amount" in write, false);
  assertEquals("doc_date" in write, false);
  assertEquals(write.modelVersion, JEV_MODEL);
  assertEquals(write.confidence, 0.95);
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

Deno.test("threshold edges: a fill at exactly the threshold and none 0.001 below, for expense and income", () => {
  const income = expense({ direction: "income", pnlRole: null, allocationCount: 0 });
  for (const threshold of [0.8, 0.85, 0.9, 0.95]) {
    const below = Math.round((threshold - 0.001) * 1000) / 1000;
    const at = planTag(expense(), "auto", threshold, projects, categories, answers(threshold, threshold));
    assertEquals(at.write?.projectId, PROJECT);
    assertEquals(at.write?.categoryId, CATEGORY);
    assertEquals(at.write?.confidence, threshold);
    assertEquals(planTag(expense(), "auto", threshold, projects, categories, answers(threshold, below)).write, null);
    const incomeAt = planTag(income, "auto", threshold, projects, incomeCategories, incomeAnswers(threshold));
    assertEquals(incomeAt.write?.projectId, PROJECT);
    assertEquals(incomeAt.write?.categoryId, INCOME_CATEGORY);
    assertEquals(planTag(income, "auto", threshold, projects, incomeCategories, incomeAnswers(below)).write, null);
  }
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
    if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
    if (url.includes("/company_integrations")) {
      return Promise.resolve(Response.json([
        { company_id: COMPANY, enabled: true, mode: "auto", threshold: "0.90" },
        { company_id: COMPANY, enabled: true, mode: "live", threshold: 0.9 },
        { company_id: "66666666-6666-4666-8666-666666666666", enabled: true, mode: "off", threshold: 0.9 },
        { company_id: "77777777-7777-4777-8777-777777777777", enabled: false, mode: "shadow", threshold: 0.9 },
      ]));
    }
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
  assert(urls.some((url) => url.endsWith("/rest/v1/rpc/jev_projects")));
  assert(urls.every((url) => !url.includes("/rest/v1/projects")));
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
    if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/company_integrations")) {
      return Promise.resolve(Response.json([{ company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 }]));
    }
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
    if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
    if (url.includes("/company_integrations")) {
      return Promise.resolve(Response.json([{ company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 }]));
    }
    if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
    if (url.includes("/rpc/jev_supplier_history")) return Promise.resolve(new Response(null, { status: 500 }));
    if (url.includes("/transactions")) return Promise.resolve(Response.json([txnRow({ supplier_id: SUPPLIER })]));
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const store = createTagStore(fetch, "http://db.test/", "service-role-test");
  await assertRejects(() => store.listWork(20), Error, "store");
});

Deno.test("prefill is one SQL call with the ids only, and reports a line that closed meanwhile", async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  let reply: unknown = { project: true, category: true };
  const fetch: typeof globalThis.fetch = (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Promise.resolve(Response.json(reply));
  };
  const store = createTagStore(fetch, "http://db.test", "service-role-test");
  const write: PrefillWrite = {
    companyId: COMPANY,
    transactionId: EXPENSE,
    projectId: PROJECT,
    categoryId: CATEGORY,
    modelVersion: JEV_MODEL,
    confidence: 0.93,
  };
  assertEquals(await store.prefill(write), true);
  assertEquals(calls.length, 1);
  assert(calls[0].url.endsWith("/rest/v1/rpc/jev_prefill"));
  assertEquals(calls[0].method, "POST");
  // No amount from the job: SQL reads the allocation amount from the line (decision 0139).
  assertEquals(calls[0].body, {
    p_company: COMPANY,
    p_transaction: EXPENSE,
    p_project: PROJECT,
    p_category: CATEGORY,
    p_model: JEV_MODEL,
    p_confidence: 0.93,
  });
  reply = { project: false, category: false, skipped: "closed" };
  assertEquals(await store.prefill({ ...write, projectId: undefined }), false);
  assertEquals((calls[1].body as Record<string, unknown>).p_project, null);
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

Deno.test("FLOW-707: the card's nickname reaches Jev in the state and the questions", async () => {
  const fetch: typeof globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
    if (url.includes("/company_integrations")) {
      return Promise.resolve(Response.json([{ company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 }]));
    }
    if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
    if (url.includes("/connector_connections")) {
      assert(url.includes(`company_id=eq.${COMPANY}`) && url.includes("provider=eq.mercury"));
      return Promise.resolve(Response.json([{ card_labels: [
        { last4: "4242", label: "Example Street Utilities" },
        { last4: "12345", label: "not a last 4" },
      ] }]));
    }
    if (url.includes("/transactions")) {
      assert(url.includes("card_last4:provider_meta->>card_last4"));
      return Promise.resolve(Response.json([
        txnRow({ card_last4: "4242" }),
        txnRow({ id: "99999999-9999-4999-8999-999999999999", doc_date: "2026-04-11", card_last4: "1111" }),
        txnRow({ id: "88888888-8888-4888-8888-888888888888", doc_date: "2026-04-10" }),
      ]));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const work = await createTagStore(fetch, "http://db.test/", "service-role-test").listWork(20);
  const [named, unnamed, noCard] = work[0].expenses;
  assertEquals([named.cardLast4, named.cardName], ["4242", "Example Street Utilities"]);
  assertEquals([unnamed.cardLast4, unnamed.cardName], ["1111", undefined]);
  assertEquals([noCard.cardLast4, noCard.cardName], [null, undefined]);

  const state = buildTagState(named, projects, categories) as Record<string, unknown>;
  assertEquals(state.card_name, "Example Street Utilities");
  assertEquals("card_name" in (buildTagState(unnamed, projects, categories) as Record<string, unknown>), false);
  const asked = lineQuestions(named, work[0]);
  assert(String(asked.project.instructions).endsWith(CARD_NAME_HINT));
  assert(String(asked.category.instructions).endsWith(CARD_NAME_HINT));
  assertEquals(lineQuestions(unnamed, work[0]).project.instructions, "Choose the project id for this expense.");
});

Deno.test("FLOW-707: a failed card-name read still lists the lines, without names", async () => {
  const fetch: typeof globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
    if (url.includes("/company_integrations")) {
      return Promise.resolve(Response.json([{ company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 }]));
    }
    if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
    if (url.includes("/connector_connections")) return Promise.resolve(new Response(null, { status: 500 }));
    if (url.includes("/transactions")) return Promise.resolve(Response.json([txnRow({ card_last4: "4242" })]));
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const work = await createTagStore(fetch, "http://db.test/", "service-role-test").listWork(20);
  assertEquals(work[0].expenses.length, 1);
  assertEquals(work[0].expenses[0].cardName, undefined);
});
