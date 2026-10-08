// Jev tagging tests: income lines, flags, the no-project option, finished projects and past guesses.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { JEV_MODEL, type JevCall } from "./jev.ts";
import {
  JEV_NO_PROJECT,
  buildTagQuestions,
  buildTagState,
  createTagStore,
  lineProjects,
  lineQuestions,
  planTag,
  tagWork,
  type PrefillWrite,
  type TagFiling,
} from "./jev_tag.ts";
import {
  answers,
  categories,
  CATEGORY,
  company,
  COMPANY,
  expense,
  EXPENSE,
  INCOME_CATEGORY,
  incomeAnswers,
  incomeCategories,
  memoryStore,
  OTHER,
  PROJECT,
  projects,
  txnRow,
} from "./jev_tag_test_support.ts";

const CUSTOMER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

Deno.test("an income line gets a project and an income category, and auto pre-fills both", async () => {
  const seen: JevCall[] = [];
  const store = memoryStore();
  const income = expense({
    direction: "income",
    supplierName: "לקוח",
    supplierId: CUSTOMER,
    amountGross: 11800,
    amountNet: 10000,
    vatAmount: 1800,
    pnlRole: null,
    allocationCount: 0,
  });
  const report = await tagWork(
    [company({ incomeCategories, expenses: [income] })],
    store,
    (_key, input) => {
      seen.push(input);
      return Promise.resolve({ model: JEV_MODEL, answers: incomeAnswers(), usage: null });
    },
    "jev-test-key",
  );
  assertEquals(report.tagged, 1);
  assertEquals(report.prefilled, 1);
  assertEquals(store.writes.length, 1);
  // SQL writes no allocation for income (decision 0145): the job sends only ids.
  assertEquals(store.writes[0].projectId, PROJECT);
  assertEquals(store.writes[0].categoryId, INCOME_CATEGORY);
  assertEquals(store.writes[0].confidence, 0.97);
  const questions = seen[0].questions;
  assertEquals(Object.keys(questions).sort(), ["category", "project"]);
  assertEquals(questions.category.type === "choice" && Object.keys(questions.category.criteria), [INCOME_CATEGORY]);
  assert(String(questions.project.instructions).includes("income line"));
  const state = seen[0].state as Record<string, unknown>;
  assertEquals(state.direction, "income");
  assertEquals(state.customer, "לקוח");
  assertEquals("supplier" in state, false);
  assertEquals(store.suggestions[0].confidence, 0.97);
  assertEquals((store.suggestions[0].answers.category as { choice: string }).choice, INCOME_CATEGORY);
});

Deno.test("an expense category is not a valid answer on an income line", () => {
  const income = expense({ direction: "income", pnlRole: null, allocationCount: 0 });
  const plan = planTag(income, "auto", 0.5, projects, incomeCategories, answers());
  assertEquals(plan.write, null);
  // The category answer is the expense id, which income does not offer: it scores 0.
  assertEquals(plan.confidence, 0);
});

Deno.test("a flagged line's call also asks Jev to score the flag, with the flags in the state", async () => {
  const seen: JevCall[] = [];
  const store = memoryStore();
  const flagged = expense({ flags: [{ kind: "amount_spike", detail: { typical_amount_minor: 1000, ratio: 10 } }] });
  await tagWork(
    [company({ mode: "shadow", expenses: [flagged, expense({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })] })],
    store,
    (_key, input) => {
      seen.push(input);
      return Promise.resolve({
        model: JEV_MODEL,
        answers: { ...answers(0.9, 0.8), anomaly: { type: "noul", noul: 0.72 } },
        usage: null,
      });
    },
    "jev-test-key",
  );
  assertEquals(seen.length, 2);
  assertEquals(seen[0].questions.anomaly?.type, "noul");
  assertEquals((seen[0].state as Record<string, unknown>).flags, [
    { kind: "amount_spike", typical_amount_minor: 1000, ratio: 10 },
  ]);
  assertEquals("anomaly" in seen[1].questions, false);
  assertEquals("flags" in (seen[1].state as Record<string, unknown>), false);
  // The score is kept with the answers and does not change the suggestion's confidence.
  assertEquals(store.suggestions[0].answers.anomaly, { type: "noul", noul: 0.72 });
  assertEquals(store.suggestions[0].confidence, 0.8);
});

Deno.test("a flag alone does not make a call when there is nothing to ask", () => {
  assertEquals(buildTagQuestions([], [], "expense", true), {});
  assertEquals(Object.keys(buildTagQuestions([], categories, "expense", true)).sort(), ["anomaly", "category"]);
});

Deno.test("the store reads income lines with the customer, income categories, and flags", async () => {
  const urls: string[] = [];
  const bodies = new Map<string, unknown>();
  const income = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
    urls.push(url);
    if (init?.body) bodies.set(url, JSON.parse(String(init.body)));
    if (url.includes("/company_integrations")) {
      return Promise.resolve(Response.json([{ company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 }]));
    }
    if (url.includes("/categories") && url.includes("kind=eq.income")) {
      return Promise.resolve(Response.json(incomeCategories));
    }
    if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
    if (url.includes("/rpc/jev_supplier_history")) {
      return Promise.resolve(Response.json([
        { supplier_id: CUSTOMER, direction: "income", doc_date: "2026-03-01", description: "חשבונית", amount_net: 5000, project_id: PROJECT, category_id: INCOME_CATEGORY, pnl_role: null, split: false },
        { supplier_id: CUSTOMER, direction: "expense", doc_date: "2026-02-01", description: "החזר", amount_net: -100, project_id: null, category_id: null, pnl_role: null, split: false },
      ]));
    }
    if (url.includes("/rpc/jev_line_flags")) {
      return Promise.resolve(Response.json([
        { transaction_id: income, kind: "duplicate", other_transaction_id: EXPENSE, other_doc_date: "2026-04-10" },
      ]));
    }
    if (url.includes("/transactions")) {
      return Promise.resolve(Response.json([
        txnRow(),
        txnRow({
          id: income,
          direction: "income",
          doc_date: "2026-04-11",
          supplier_id: null,
          customer_id: CUSTOMER,
          suppliers: null,
          customers: { name: "לקוח" },
          pnl_role: null,
          allocations: [],
        }),
      ]));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const work = await createTagStore(fetch, "http://db.test/", "service-role-test").listWork(20);
  const transactions = urls.find((url) => url.includes("/transactions"));
  assert(transactions && !transactions.includes("direction=eq."));
  assert(transactions.includes("customers(name)"));
  assertEquals(work[0].incomeCategories, incomeCategories);
  const line = work[0].expenses.find((item) => item.id === income);
  assert(line);
  assertEquals(line.direction, "income");
  assertEquals(line.supplierName, "לקוח");
  assertEquals(line.supplierId, CUSTOMER);
  assertEquals(line.history?.map((filing) => filing.description), ["חשבונית"]);
  assertEquals(line.flags, [{ kind: "duplicate", detail: { other_doc_date: "2026-04-10" } }]);
  assertEquals(work[0].expenses.find((item) => item.id === EXPENSE)?.flags, undefined);
  const flagsUrl = urls.find((url) => url.includes("/rpc/jev_line_flags"));
  assert(flagsUrl);
  assertEquals((bodies.get(flagsUrl) as { p_ids: string[] }).p_ids.sort(), [EXPENSE, income].sort());
});

Deno.test("expense-only runs do not read income categories, and a failed flag read still tags", async () => {
  const urls: string[] = [];
  const fetch: typeof globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
    urls.push(url);
    if (url.includes("/company_integrations")) {
      return Promise.resolve(Response.json([{ company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 }]));
    }
    if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
    if (url.includes("/rpc/jev_line_flags")) return Promise.resolve(new Response(null, { status: 500 }));
    if (url.includes("/transactions")) return Promise.resolve(Response.json([txnRow()]));
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const work = await createTagStore(fetch, "http://db.test/", "service-role-test").listWork(20);
  assertEquals(work[0].expenses.length, 1);
  assertEquals(work[0].expenses[0].flags, undefined);
  assertEquals(work[0].incomeCategories, []);
  assert(urls.every((url) => !url.includes("kind=eq.income")));
});

// FLOW-703, decision 0139.

const FINISHED = "66666666-6666-4666-8666-66666666666f";
const OVERHEAD = "77777777-7777-4777-8777-77777777777e";

function noProjectAnswers(confidence = 0.95) {
  return {
    ...answers(),
    project: { type: "choice", choice: JEV_NO_PROJECT, confidence, probabilities: null },
  };
}

Deno.test("the project question offers no project, and marks the overhead and finished projects", () => {
  const questions = buildTagQuestions([
    { id: PROJECT, name: "שיפוץ" },
    { id: OVERHEAD, name: "כללי", overhead: true },
    { id: FINISHED, name: "בניין ישן", finished: true, lastDocDate: "2026-03-31" },
  ], categories);
  assert(questions.project.type === "choice");
  assertEquals(questions.project.criteria[PROJECT], "שיפוץ");
  assertEquals(questions.project.criteria[OVERHEAD], "כללי (company overhead)");
  assertEquals(questions.project.criteria[FINISHED], "בניין ישן (finished)");
  assert(typeof questions.project.criteria[JEV_NO_PROJECT] === "string");
  // No project question at all: no lone none option either.
  assertEquals("project" in buildTagQuestions([], categories), false);
});

Deno.test("a finished project is offered only on lines dated on or before its last line", () => {
  const work = company({
    projects: [
      ...projects,
      { id: FINISHED, name: "בניין ישן", finished: true, lastDocDate: "2026-03-31" },
    ],
  });
  const older = expense({ docDate: "2026-03-31" });
  const newer = expense({ docDate: "2026-04-01" });
  assertEquals(lineProjects(older, work).map((row) => row.id), [PROJECT, OTHER, FINISHED]);
  assertEquals(lineProjects(newer, work).map((row) => row.id), [PROJECT, OTHER]);
  const olderQuestions = lineQuestions(older, work);
  const newerQuestions = lineQuestions(newer, work);
  assert(olderQuestions.project.type === "choice" && newerQuestions.project.type === "choice");
  assert(FINISHED in olderQuestions.project.criteria);
  assertEquals(FINISHED in newerQuestions.project.criteria, false);
});

Deno.test("auto never pre-fills a no-project answer, and still fills the category", () => {
  const plan = planTag(expense(), "auto", 0.9, projects, categories, noProjectAnswers());
  assertEquals(plan.confidence, 0.95);
  assertEquals((plan.answers.project as { choice: string }).choice, JEV_NO_PROJECT);
  assert(plan.write);
  assertEquals(plan.write.projectId, undefined);
  assertEquals(plan.write.categoryId, CATEGORY);
});

Deno.test("a past filing carries Jev's earlier guess and whether the owner corrected it", () => {
  const filings: TagFiling[] = [
    {
      docDate: "2026-03-01",
      description: "מלט",
      amountNet: -9000,
      projectId: PROJECT,
      categoryId: CATEGORY,
      pnlRole: "project",
      split: false,
      jevProjectId: OTHER,
      jevCategoryId: CATEGORY,
      jevCorrected: true,
    },
    {
      docDate: "2026-02-01",
      description: "חול",
      amountNet: -500,
      projectId: PROJECT,
      categoryId: CATEGORY,
      pnlRole: "project",
      split: false,
    },
  ];
  const state = buildTagState(expense({ history: filings }), projects, categories);
  assert(typeof state === "object" && state !== null && !Array.isArray(state));
  const past = state.past_filings as Record<string, unknown>[];
  assertEquals(past[0].jev_suggested_project_id, OTHER);
  assertEquals(past[0].jev_suggested_category_id, CATEGORY);
  assertEquals(past[0].owner_corrected_jev, true);
  // A line Jev never suggested on says nothing about Jev.
  assertEquals("owner_corrected_jev" in past[1], false);
});

Deno.test("the store reads Jev's guess from the history, and finished projects with a last line", async () => {
  const fetch: typeof globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("/rpc/jev_projects")) {
      return Promise.resolve(Response.json([
        { id: PROJECT, name: "שיפוץ", status: "active", last_doc_date: null, overhead: false },
        { id: OVERHEAD, name: "כללי", status: "active", last_doc_date: null, overhead: true },
        { id: FINISHED, name: "בניין ישן", status: "finished", last_doc_date: "2026-03-31", overhead: false },
        { id: OTHER, name: "ריק", status: "finished", last_doc_date: null, overhead: false },
      ]));
    }
    if (url.includes("/rpc/jev_supplier_history")) {
      return Promise.resolve(Response.json([{
        supplier_id: "88888888-8888-4888-8888-888888888888",
        direction: "expense",
        doc_date: "2026-03-01",
        description: "מלט",
        amount_net: -9000,
        project_id: PROJECT,
        category_id: CATEGORY,
        pnl_role: "project",
        split: false,
        jev_project_id: OTHER,
        jev_category_id: null,
        jev_corrected: true,
      }]));
    }
    if (url.includes("/company_integrations")) {
      return Promise.resolve(Response.json([{ company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 }]));
    }
    if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
    if (url.includes("/transactions")) {
      return Promise.resolve(Response.json([txnRow({ supplier_id: "88888888-8888-4888-8888-888888888888" })]));
    }
    return Promise.resolve(Response.json([]));
  };
  const work = await createTagStore(fetch, "http://db.test", "service-role-test").listWork(20);
  assertEquals(work[0].projects, [
    { id: PROJECT, name: "שיפוץ" },
    { id: OVERHEAD, name: "כללי", overhead: true },
    { id: FINISHED, name: "בניין ישן", finished: true, lastDocDate: "2026-03-31" },
  ]);
  const history = work[0].expenses[0].history ?? [];
  assertEquals(history[0].jevProjectId, OTHER);
  assertEquals(history[0].jevCategoryId, null);
  assertEquals(history[0].jevCorrected, true);
});

Deno.test("a prefill SQL skipped because the line closed is tagged, not counted as pre-filled", async () => {
  const store = memoryStore();
  store.prefill = (write: PrefillWrite) => {
    store.writes.push(write);
    return Promise.resolve(false);
  };
  const report = await tagWork([company()], store, () => Promise.resolve({
    model: JEV_MODEL,
    answers: answers(),
    usage: null,
  }), "jev-test-key");
  assertEquals(store.writes.length, 1);
  assertEquals(report.tagged, 1);
  assertEquals(report.prefilled, 0);
  assertEquals(store.suggestions.length, 1);
});

Deno.test("the none option fits in Jev's 255 choices", () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `p${i}`,
    }));
  const at = buildTagQuestions(many(254), categories);
  assert(at.project.type === "choice");
  assertEquals(Object.keys(at.project.criteria).length, 255);
  assertEquals("project" in buildTagQuestions(many(255), categories), false);
});
