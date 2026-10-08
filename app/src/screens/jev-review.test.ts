import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JEV_READ_MS,
  JEV_REVIEW_OFF,
  beginJevScopeLookup,
  bindJevConnectorScope,
  boundJevConnectorScope,
  clearJevConnectorFlag,
  companyIdFromReviewPayload,
  completeJevScopeLookup,
  JEV_SUGGESTION_CHUNK,
  fetchJevConnector,
  jevFilledOnCard,
  jevShown,
  jevConnectorStorageKey,
  jevScopePhase,
  loadJevSuggestions,
  noteJevAuthUser,
  parseJevSuggestion,
  readJevConnectorFlag,
  resetJevScopeMemory,
  withJev,
  withJevDeadline,
  writeJevConnectorFlag,
  type JevConnectorScope,
  type JevPrefill,
  type JevReviewState,
} from "./jev-review";

const scope: JevConnectorScope = { userId: "user-1", companyId: "company-1" };

const connectorDb = vi.hoisted(() => ({
  integration: null as { enabled: boolean; mode: string } | null,
  error: null as { message: string } | null,
  hang: false,
  suggestionReads: [] as string[][],
  suggestions: [] as Array<{ id: string; transaction_id: string; answers: unknown }>,
  fills: [] as Array<{ transaction_id: string; project_id: string | null; category_id: string | null; undone_at: string | null }>,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: (name: string) => {
      let linked: AbortSignal | undefined;
      let wanted: string[] | null = null;
      const rows = () => {
        if (name === "tag_suggestions") {
          return connectorDb.suggestions.filter((row) => wanted?.includes(row.transaction_id));
        }
        if (name === "projects") return [{ id: "p1", name: "וילה רעננה", status: "active" }];
        if (name === "categories") return [{ id: "c1", name: "חומרים", hidden: false }];
        if (name === "jev_prefills") return connectorDb.fills.filter((row) => wanted?.includes(row.transaction_id));
        return [];
      };
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: (_column: string, values: string[]) => {
          wanted = values;
          if (name === "tag_suggestions") connectorDb.suggestionReads.push(values);
          return builder;
        },
        order: () => builder,
        then: (onFulfilled: (value: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(onFulfilled),
        abortSignal: (next: AbortSignal) => {
          linked = next;
          return builder;
        },
        maybeSingle: () => {
          if (connectorDb.hang) {
            return new Promise((_resolve, reject) => {
              const fail = () => {
                reject(new DOMException("The operation was aborted.", "AbortError"));
              };
              if (linked?.aborted) fail();
              else linked?.addEventListener("abort", fail, { once: true });
            });
          }
          return Promise.resolve({
            data: connectorDb.error ? null : connectorDb.integration,
            error: connectorDb.error,
          });
        },
      };
      return builder;
    },
  }),
}));

const prefill: JevPrefill = {
  suggestionId: "s1",
  transactionId: "t1",
  project: { id: "p1", name: "וילה רעננה" },
  category: { id: "c1", name: "חומרים" },
};

const on: JevReviewState = { connectorOn: true, prefill };
const off: JevReviewState = { connectorOn: false, prefill };

const empty = {
  transaction_id: "t1",
  direction: "expense" as const,
  project_id: null,
  category_id: null,
  project_name: null,
  category_name: null,
  reason: null,
  project_suggested: false,
  category_suggested: false,
};

const projects = new Map([["p1", "וילה רעננה"]]);
const categories = new Map([["c1", "חומרים"]]);

describe("Jev review prefill", () => {
  it("leaves the row unchanged when the connector is off or there is no suggestion", () => {
    expect(withJev(empty, off)).toBe(empty);
    expect(withJev(empty, { connectorOn: true, prefill: null })).toBe(empty);
    expect(withJev({ ...empty, project_id: "owned", project_name: "הרצל", project_suggested: false, category_id: "c9", category_name: "הובלה", category_suggested: false }, on)).toEqual({
      ...empty,
      project_id: "owned",
      project_name: "הרצל",
      project_suggested: false,
      category_id: "c9",
      category_name: "הובלה",
      category_suggested: false,
    });
  });

  it("prefills an open expense and marks both lines as suggestions", () => {
    expect(withJev(empty, on)).toEqual({
      ...empty,
      project_id: "p1",
      project_name: "וילה רעננה",
      project_suggested: true,
      category_id: "c1",
      category_name: "חומרים",
      category_suggested: true,
    });
  });

  it("suggests a project on an income line, which needs one in review", () => {
    const income = { ...empty, direction: "income" as const };
    expect(withJev(income, on).project_id).toBe("p1");
    expect(jevShown(income, on)).toEqual({ project: true, category: true });
  });

  it("fills an empty category when list_review reports category_suggested false", () => {
    expect(empty.category_suggested).toBe(false);
    expect(empty.category_id).toBeNull();
    expect(withJev(empty, on).category_id).toBe("c1");
  });

  it("leaves a field the user assigned", () => {
    const owned = {
      ...empty,
      project_id: "owned",
      project_name: "הרצל",
      project_suggested: true,
      project_assigned: true,
      category_id: "c9",
      category_name: "הובלה",
      category_suggested: false,
      category_assigned: true,
      user_assigned: false,
    };
    expect(withJev(owned, on)).toBe(owned);
  });

  it("leaves a supplier rule when both assignment flags are false", () => {
    const rule = {
      ...empty,
      project_id: "p9",
      project_name: "הרצל",
      project_suggested: false,
      project_assigned: false,
      user_assigned: false,
      category_id: "c9",
      category_name: "הובלה",
      category_suggested: false,
      category_assigned: false,
    };
    expect(withJev(rule, on)).toBe(rule);
  });

  it("replaces an existing suggested project", () => {
    const guess = {
      ...empty,
      project_id: "p-old",
      project_name: "פרויקט ישן",
      project_suggested: true,
      category_id: "c-old",
      category_name: "קטגוריה ישנה",
      category_suggested: true,
    };
    expect(withJev(guess, on)).toMatchObject({
      project_id: "p1",
      project_name: "וילה רעננה",
      project_suggested: true,
      category_id: "c1",
      category_name: "חומרים",
      category_suggested: true,
    });
  });

  it("does not put a project on a split", () => {
    const split = { ...empty, pnl_role: "shared" as const, share_count: 2 };
    expect(withJev(split, on)).toMatchObject({
      project_id: null,
      category_id: "c1",
      category_suggested: true,
    });
  });

  it("treats enabled with mode off as no prefill", () => {
    expect(withJev(empty, { connectorOn: false, prefill })).toBe(empty);
  });

  it("reads a choice only when the id is one of ours and the confidence is in range", () => {
    const answers = {
      project: { choice: "p1", confidence: 0.91 },
      category: { choice: "missing", confidence: 0.9 },
    };
    expect(parseJevSuggestion(answers, "s1", "t1", projects, categories)).toEqual({
      suggestionId: "s1",
      transactionId: "t1",
      project: { id: "p1", name: "וילה רעננה" },
      category: null,
    });
    expect(parseJevSuggestion({ project: { choice: "p1", confidence: 2 } }, "s1", "t1", projects, categories)).toBeNull();
  });

  it("returns the off fallback when the read misses the deadline", async () => {
    vi.useFakeTimers();
    const pending = withJevDeadline(undefined, () => new Promise<typeof JEV_REVIEW_OFF>(() => undefined), JEV_REVIEW_OFF);
    await vi.advanceTimersByTimeAsync(JEV_READ_MS);
    await expect(pending).resolves.toBe(JEV_REVIEW_OFF);
  });

  it("reads a company id from the review payload and ignores the old shared key", () => {
    expect(companyIdFromReviewPayload([{ company_id: "company-1" }])).toBe("company-1");
    expect(companyIdFromReviewPayload({ company_id: "company-1" })).toBe("company-1");
    expect(companyIdFromReviewPayload([{ company_id: "" }, { id: "r1" }])).toBeNull();
    localStorage.setItem("flow.jev-connector", "1");
    expect(readJevConnectorFlag(scope)).toBeUndefined();
    expect(localStorage.getItem("flow.jev-connector")).toBeNull();
  });

  it("remembers the connector flag for that user and company", () => {
    expect(readJevConnectorFlag(scope)).toBeUndefined();
    writeJevConnectorFlag(true, scope);
    expect(readJevConnectorFlag(scope)).toBe(true);
    expect(localStorage.getItem("flow.jev-connector")).toBeNull();
    expect(readJevConnectorFlag({ userId: "user-1", companyId: "other" })).toBeUndefined();
    writeJevConnectorFlag(false, scope);
    expect(readJevConnectorFlag(scope)).toBe(false);
    localStorage.setItem("flow.jev-connector", "1");
    clearJevConnectorFlag(scope.userId);
    expect(readJevConnectorFlag(scope)).toBeUndefined();
    expect(localStorage.getItem("flow.jev-connector")).toBeNull();
  });

  it("stores the flag when the connector read completes", async () => {
    bindJevConnectorScope(scope);
    connectorDb.integration = { enabled: true, mode: "shadow" };
    await expect(fetchJevConnector()).resolves.toBe(true);
    expect(localStorage.getItem(jevConnectorStorageKey(scope))).toBe("1");
  });

  it("leaves a stored on in place when the connector read misses the deadline", async () => {
    vi.useFakeTimers();
    bindJevConnectorScope(scope);
    writeJevConnectorFlag(true, scope);
    connectorDb.hang = true;
    const pending = fetchJevConnector();
    await vi.advanceTimersByTimeAsync(JEV_READ_MS);
    await expect(pending).resolves.toBe(false);
    expect(readJevConnectorFlag(scope)).toBe(true);
  });
});

describe("review scope finish guards", () => {
  afterEach(() => {
    resetJevScopeMemory();
  });

  it("drops a stale generation even when the user is unchanged", () => {
    noteJevAuthUser(scope.userId);
    const first = beginJevScopeLookup();
    const second = beginJevScopeLookup();
    expect(completeJevScopeLookup(first, { userId: scope.userId, companyId: "stale" })).toBe(false);
    expect(boundJevConnectorScope()).toBeNull();
    expect(completeJevScopeLookup(second, scope)).toBe(true);
    expect(boundJevConnectorScope()).toEqual(scope);
  });

  it("drops a lookup whose user changed without a new generation", () => {
    noteJevAuthUser(scope.userId);
    const lookup = beginJevScopeLookup();
    noteJevAuthUser("user-2");
    expect(completeJevScopeLookup(lookup, { userId: "user-2", companyId: scope.companyId })).toBe(false);
    expect(boundJevConnectorScope()).toBeNull();
    expect(jevScopePhase()).toBe("pending");
  });

  it("drops a scope that finishes after the user is signed out", () => {
    noteJevAuthUser(null);
    const lookup = beginJevScopeLookup();
    expect(completeJevScopeLookup(lookup, scope)).toBe(false);
    expect(boundJevConnectorScope()).toBeNull();
    expect(jevScopePhase()).toBe("off");
  });
});

afterEach(() => {
  vi.useRealTimers();
  connectorDb.integration = null;
  connectorDb.error = null;
  connectorDb.hang = false;
  resetJevScopeMemory();
  localStorage.removeItem("flow.jev-connector");
  localStorage.removeItem(jevConnectorStorageKey(scope));
});

describe("Jev shown fields (הצעת Jev)", () => {
  it("marks both fields Jev fills on an open line", () => {
    expect(jevShown(empty, on)).toEqual({ project: true, category: true });
  });

  it("marks nothing when the connector is off, there is no answer, or it is another line", () => {
    expect(jevShown(empty, off)).toEqual({ project: false, category: false });
    expect(jevShown(empty, JEV_REVIEW_OFF)).toEqual({ project: false, category: false });
    expect(jevShown(empty, { connectorOn: true, prefill: null })).toEqual({ project: false, category: false });
    expect(jevShown({ ...empty, transaction_id: "t2" }, on)).toEqual({ project: false, category: false });
  });

  it("marks only the field Jev answered", () => {
    expect(jevShown(empty, { connectorOn: true, prefill: { ...prefill, category: null } })).toEqual({ project: true, category: false });
    expect(jevShown(empty, { connectorOn: true, prefill: { ...prefill, project: null } })).toEqual({ project: false, category: true });
  });

  it("does not mark a supplier rule or a field the user set", () => {
    const rule = {
      ...empty,
      project_id: "p-rule",
      project_name: "פרויקט שמור",
      project_suggested: false,
      category_id: "c-rule",
      category_name: "קטגוריה שמורה",
      category_suggested: false,
    };
    expect(jevShown(rule, on)).toEqual({ project: false, category: false });
    expect(jevShown({ ...empty, user_assigned: true }, on)).toEqual({ project: false, category: false });
    expect(jevShown({ ...empty, category_assigned: true }, on)).toEqual({ project: true, category: false });
  });

  it("does not mark a project on a shared cost, where Jev gives no project", () => {
    expect(jevShown({ ...empty, reason: "unallocated_shared" }, on)).toEqual({ project: false, category: true });
  });

  it("marks a replaced suggestion and an auto pre-fill with the same answer", () => {
    const guessed = { ...empty, project_id: "p-old", project_name: "ישן", project_suggested: true };
    expect(jevShown(guessed, on).project).toBe(true);
    const prefilled = withJev(empty, on);
    expect(jevShown(prefilled, on)).toEqual({ project: true, category: true });
  });
});

describe("loadJevSuggestions", () => {
  it("reads a long queue in chunks, so the URL stays short, and keeps every line's suggestion", async () => {
    const ids = Array.from({ length: 2 * JEV_SUGGESTION_CHUNK + 50 }, (_, index) => `t${String(index)}`);
    const lastId = `t${String(ids.length - 1)}`;
    connectorDb.suggestionReads = [];
    connectorDb.suggestions = [
      { id: "s-first", transaction_id: "t0", answers: { project: { choice: "p1", confidence: 0.9 } } },
      { id: "s-last", transaction_id: lastId, answers: { category: { choice: "c1", confidence: 0.9 } } },
    ];
    const queue = await loadJevSuggestions([...ids, "t0", ""]);
    expect(connectorDb.suggestionReads.map((chunk) => chunk.length)).toEqual([JEV_SUGGESTION_CHUNK, JEV_SUGGESTION_CHUNK, 50]);
    expect(new Set(connectorDb.suggestionReads.flat()).size).toBe(ids.length);
    expect(Object.keys(queue.byId)).toHaveLength(ids.length);
    expect(queue.byId.t0?.suggestionId).toBe("s-first");
    expect(queue.byId[lastId]?.category?.name).toBe("חומרים");
    expect(queue.byId.t1).toBeNull();
  });
});

describe("Jev auto fills (FLOW-702)", () => {
  const filledRow = {
    transaction_id: "t1",
    project_id: "p1",
    project_name: "וילה רעננה",
    project_suggested: true,
    category_id: "c1",
    category_name: "חומרים",
    category_suggested: true,
  };

  it("reads the newest fill per line and marks an undone one", async () => {
    connectorDb.suggestions = [
      { id: "s1", transaction_id: "t1", answers: { project: { choice: "p1", confidence: 0.95 }, category: { choice: "c1", confidence: 0.95 } } },
      { id: "s2", transaction_id: "t2", answers: { category: { choice: "c1", confidence: 0.95 } } },
    ];
    connectorDb.fills = [
      { transaction_id: "t1", project_id: "p1", category_id: "c1", undone_at: null },
      { transaction_id: "t2", project_id: null, category_id: "c1", undone_at: "2026-10-08T10:00:00Z" },
      { transaction_id: "t2", project_id: null, category_id: "c1", undone_at: null },
    ];
    const queue = await loadJevSuggestions(["t1", "t2"]);
    expect(queue.byId.t1?.auto).toEqual({ state: "filled", projectId: "p1", categoryId: "c1" });
    expect(queue.byId.t2?.auto?.state).toBe("undone");
    connectorDb.fills = [];
  });

  it("labels a standing fill only while the stored row holds Jev's value", () => {
    const state: JevReviewState = {
      connectorOn: true,
      prefill: { ...prefill, auto: { state: "filled", projectId: "p1", categoryId: "c1" } },
    };
    expect(jevFilledOnCard(filledRow, state)).toBe(true);
    expect(jevFilledOnCard({ ...filledRow, project_id: null, category_id: null }, state)).toBe(false);
    expect(jevFilledOnCard({ ...filledRow, project_assigned: true, category_assigned: true }, state)).toBe(false);
    expect(jevFilledOnCard(filledRow, { ...state, connectorOn: false })).toBe(false);
    expect(jevFilledOnCard(filledRow, { connectorOn: true, prefill })).toBe(false);
  });

  it("fills nothing on a line whose fill was undone", () => {
    const state: JevReviewState = {
      connectorOn: true,
      prefill: { ...prefill, auto: { state: "undone", projectId: "p1", categoryId: "c1" } },
    };
    const empty = { transaction_id: "t1", project_id: null, category_id: null };
    expect(withJev(empty, state)).toBe(empty);
    expect(jevShown(empty, state)).toEqual({ project: false, category: false });
    expect(jevFilledOnCard(empty, state)).toBe(false);
  });
});
