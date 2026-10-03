import { describe, expect, it, vi } from "vitest";
import {
  jevCorrectionFor,
  parseJevSuggestion,
  saveJevCorrection,
  withJev,
  type JevPrefill,
  type JevReviewState,
} from "./jev-review";

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

  it("writes a confirm when the chosen ids match, and a fix when one changes", () => {
    expect(jevCorrectionFor(empty, on, { projectId: "p1", categoryId: "c1" })).toMatchObject({
      action: "confirm",
      suggestedProjectId: "p1",
      suggestedCategoryId: "c1",
      chosenProjectId: "p1",
      chosenCategoryId: "c1",
    });
    expect(jevCorrectionFor(empty, on, { projectId: "p1", categoryId: "c2" })).toMatchObject({
      action: "fix",
      chosenCategoryId: "c2",
    });
    expect(jevCorrectionFor(empty, off, { projectId: "p2", categoryId: "c2" })).toBeNull();
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
});

describe("saveJevCorrection", () => {
  it("sends the confirm payload", async () => {
    const writes: Array<Record<string, unknown>> = [];
    vi.spyOn(await import("../lib/supabase"), "getSupabase").mockReturnValue({
      rpc: (_name: string, args: Record<string, unknown>) => {
        writes.push(args);
        return Promise.resolve({ error: null });
      },
    } as never);
    const correction = jevCorrectionFor(empty, on, { projectId: "p1", categoryId: "c1" });
    if (!correction) throw new Error("missing");
    await saveJevCorrection(correction);
    expect(writes).toEqual([{
      p_transaction_id: "t1",
      p_suggestion_id: "s1",
      p_action: "confirm",
      p_suggested_project_id: "p1",
      p_suggested_category_id: "c1",
      p_chosen_project_id: "p1",
      p_chosen_category_id: "c1",
    }]);
    vi.restoreAllMocks();
  });

  it("continues when the correction function is not deployed yet", async () => {
    vi.spyOn(await import("../lib/supabase"), "getSupabase").mockReturnValue({
      rpc: () => Promise.resolve({ error: { code: "PGRST202", message: "Could not find the function record_jev_correction" } }),
    } as never);
    const correction = jevCorrectionFor(empty, on, { projectId: "p1", categoryId: "c1" });
    if (!correction) throw new Error("missing");
    await expect(saveJevCorrection(correction)).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});
