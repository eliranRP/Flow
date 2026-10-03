import { describe, expect, it } from "vitest";
import { parseJevSuggestion, withJev, type JevPrefill, type JevReviewState } from "./jev-review";

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
