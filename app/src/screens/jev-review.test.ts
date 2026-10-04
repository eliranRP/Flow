import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JEV_READ_MS,
  JEV_REVIEW_OFF,
  parseJevSuggestion,
  readJevConnectorFlag,
  withJev,
  withJevDeadline,
  writeJevConnectorFlag,
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

  it("remembers the connector flag for the next launch", () => {
    expect(readJevConnectorFlag()).toBeUndefined();
    writeJevConnectorFlag(true);
    expect(readJevConnectorFlag()).toBe(true);
    writeJevConnectorFlag(false);
    expect(readJevConnectorFlag()).toBe(false);
  });
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.removeItem("flow.jev-connector");
});
