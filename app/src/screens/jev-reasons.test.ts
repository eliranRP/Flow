import { afterEach, describe, expect, it, vi } from "vitest";
import { loadJevReasons, loadJevSuggestions, loadReviewFlags, parseJevReason, parseReviewFlag } from "./jev-review";

type Result = { data: unknown; error: { message: string } | null };

const db = vi.hoisted(() => ({
  suggestions: [] as Array<{ id: string; transaction_id: string; answers: unknown }>,
  rpc: null as null | ((name: string, args: { p_transaction_ids: string[] }) => Promise<Result>),
  calls: [] as Array<{ name: string; ids: string[] }>,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: (name: string) => {
      let wanted: string[] = [];
      const rows = () => {
        if (name === "tag_suggestions") return db.suggestions.filter((row) => wanted.includes(row.transaction_id));
        if (name === "projects") return [{ id: "p1", name: "וילה רעננה", status: "active" }];
        if (name === "categories") return [{ id: "c1", name: "חומרים", hidden: false }];
        return [];
      };
      const builder = {
        select: () => builder,
        in: (_column: string, values: string[]) => {
          wanted = values;
          return builder;
        },
        order: () => builder,
        then: (resolve: (value: Result) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return builder;
    },
    rpc: (name: string, args: { p_transaction_ids: string[] }) => {
      db.calls.push({ name, ids: args.p_transaction_ids });
      if (db.rpc == null) return Promise.reject(new Error("no rpc"));
      return db.rpc(name, args);
    },
  }),
}));

afterEach(() => {
  db.suggestions = [];
  db.rpc = null;
  db.calls.length = 0;
});

const answers = {
  project: { choice: "p1", confidence: 0.9 },
  category: { choice: "c1", confidence: 0.9 },
};

function reasonRow(extra: Record<string, unknown> = {}) {
  return {
    transaction_id: "t1",
    direction: "expense",
    project_id: "p1",
    category_id: "c1",
    reason: "usual_for_party",
    party_filings: 5,
    matching_filings: 3,
    anomaly_score: null,
    ...extra,
  };
}

describe("Jev reasons on the card (FLOW-327, rpc jev_suggestions)", () => {
  it("parses a reason row and refuses an unknown reason or a bad count", () => {
    expect(parseJevReason(reasonRow())).toEqual({
      transactionId: "t1",
      reason: "usual_for_party",
      partyFilings: 5,
      matchingFilings: 3,
      projectId: "p1",
      categoryId: "c1",
      noProject: false,
    });
    expect(parseJevReason(reasonRow({ reason: "because" }))).toBeNull();
    expect(parseJevReason(reasonRow({ party_filings: -1 }))).toBeNull();
    expect(parseJevReason(reasonRow({ matching_filings: "3" }))).toBeNull();
    expect(parseJevReason(null)).toBeNull();
    expect(parseJevReason(reasonRow({ no_project: true }))?.noProject).toBe(true);
  });

  it("puts the reason on the suggestion that names the same project and category", async () => {
    db.suggestions = [{ id: "s1", transaction_id: "t1", answers }];
    db.rpc = () => Promise.resolve({ data: [reasonRow()], error: null });
    const queue = await loadJevSuggestions(["t1"]);
    expect(queue.byId.t1?.why).toEqual({ reason: "usual_for_party", partyFilings: 5, matchingFilings: 3 });
    expect(db.calls).toEqual([{ name: "jev_suggestions", ids: ["t1"] }]);
  });

  it("drops a reason for another suggestion", async () => {
    db.suggestions = [{ id: "s1", transaction_id: "t1", answers }];
    db.rpc = () => Promise.resolve({ data: [reasonRow({ category_id: "c-other" })], error: null });
    const queue = await loadJevSuggestions(["t1"]);
    expect(queue.byId.t1?.project?.id).toBe("p1");
    expect(queue.byId.t1?.why).toBeUndefined();
  });

  it("keeps the suggestion with no reason when the rpc fails, errors, or is missing", async () => {
    db.suggestions = [{ id: "s1", transaction_id: "t1", answers }];
    db.rpc = null;
    expect((await loadJevSuggestions(["t1"])).byId.t1?.why).toBeUndefined();
    db.rpc = () => Promise.resolve({ data: null, error: { message: "function jev_suggestions does not exist" } });
    const queue = await loadJevSuggestions(["t1"]);
    expect(queue.byId.t1?.project?.name).toBe("וילה רעננה");
    expect(queue.byId.t1?.why).toBeUndefined();
    expect((await loadJevReasons(["t1"])).size).toBe(0);
  });

  it("marks Jev's no-project answer, before and after the server sends it (FLOW-703)", async () => {
    db.suggestions = [{ id: "s1", transaction_id: "t1", answers: { category: answers.category } }];
    db.rpc = () => Promise.resolve({ data: [reasonRow({ project_id: null, no_project: true })], error: null });
    expect((await loadJevSuggestions(["t1"])).byId.t1?.noProject).toBe(true);
    db.rpc = () => Promise.resolve({ data: [reasonRow({ project_id: null })], error: null });
    expect((await loadJevSuggestions(["t1"])).byId.t1?.noProject).toBeUndefined();
    // Only "no project": no field to fill, still a suggestion to show.
    db.suggestions = [{ id: "s2", transaction_id: "t1", answers: { project: { choice: null, confidence: 0.8 } } }];
    db.rpc = () => Promise.resolve({ data: [reasonRow({ project_id: null, category_id: null, no_project: true })], error: null });
    const only = (await loadJevSuggestions(["t1"])).byId.t1;
    expect(only).toMatchObject({ suggestionId: "s2", project: null, category: null, noProject: true });
  });

  it("asks at most 500 ids per call", async () => {
    db.rpc = () => Promise.resolve({ data: [], error: null });
    const ids = Array.from({ length: 501 }, (_value, index) => `t${String(index)}`);
    await loadJevReasons(ids);
    expect(db.calls.map((call) => call.ids.length)).toEqual([500, 1]);
  });
});

describe("Anomaly flags on the card (FLOW-327, rpc review_anomalies)", () => {
  it("parses the three kinds with their details and a score between 0 and 1", () => {
    expect(parseReviewFlag({ transaction_id: "t1", kind: "duplicate", other_transaction_id: "t2", other_doc_date: "2026-10-03", jev_score: 0.81 }))
      .toEqual({ transaction_id: "t1", kind: "duplicate", jev_score: 0.81, other_doc_date: "2026-10-03", typical_amount_minor: null, ratio: null });
    expect(parseReviewFlag({ transaction_id: "t1", kind: "amount_spike", typical_amount_minor: 120000, ratio: "4.2", jev_score: null }))
      .toMatchObject({ kind: "amount_spike", ratio: 4.2, typical_amount_minor: 120000, jev_score: null });
    expect(parseReviewFlag({ transaction_id: "t1", kind: "new_party_large", jev_score: 3 })?.jev_score).toBeNull();
    expect(parseReviewFlag({ transaction_id: "t1", kind: "weird" })).toBeNull();
    expect(parseReviewFlag("x")).toBeNull();
  });

  it("groups the flags by line and throws on a failed read", async () => {
    db.rpc = () => Promise.resolve({
      data: [
        { transaction_id: "t1", kind: "duplicate", jev_score: null },
        { transaction_id: "t1", kind: "amount_spike", ratio: 3, jev_score: 0.9 },
        { transaction_id: "t2", kind: "new_party_large", jev_score: null },
      ],
      error: null,
    });
    const flags = await loadReviewFlags(["t1", "t2", "t1", ""]);
    expect(Object.keys(flags).sort()).toEqual(["t1", "t2"]);
    expect(flags.t1?.map((flag) => flag.kind)).toEqual(["duplicate", "amount_spike"]);
    expect(db.calls).toEqual([{ name: "review_anomalies", ids: ["t1", "t2"] }]);
    db.rpc = () => Promise.resolve({ data: null, error: { message: "forbidden" } });
    await expect(loadReviewFlags(["t1"])).rejects.toThrow("forbidden");
  });

  it("reads nothing for no ids", async () => {
    expect(await loadReviewFlags([])).toEqual({});
    expect(db.calls).toEqual([]);
  });
});
