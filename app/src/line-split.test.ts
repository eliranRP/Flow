import { describe, expect, it } from "vitest";
import { samplePreview } from "./dev/line-split-sample";
import {
  amountOf,
  amountText,
  amountsPayload,
  buildPayload,
  checkParts,
  draftFromRead,
  parseLineSplit,
  parsePreview,
  percentOf,
  resolvePreview,
  shareOfLine,
  type LineContext,
  type PartDraft,
} from "./line-split";

const ctx: LineContext = {
  lineMinor: 480_000n,
  lineCategoryId: "c-build",
  lineProjectId: "p-givat",
  isReversal: (id) => id === "c-refund",
};

const part = (key: string, change: Partial<PartDraft>): PartDraft => ({ key, categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "100", ...change });

describe("line split editor logic (FLOW-325)", () => {
  it("reads typed values", () => {
    expect(percentOf("30")).toBe(30);
    expect(percentOf("33.33")).toBe(33.33);
    expect(percentOf("0")).toBeNull();
    expect(percentOf("100.01")).toBeNull();
    expect(percentOf("")).toBeNull();
    expect(amountOf("500")).toBe(50_000n);
    expect(amountOf("1,440.5")).toBe(144_050n);
    expect(amountOf("0")).toBeNull();
    expect(amountText(144_050n)).toBe("1440.50");
    expect(amountText(50_000n)).toBe("500");
    expect(shareOfLine(50_000n, 480_000n)).toBeCloseTo(10.4166, 3);
  });

  it("sends percent, amount_minor and rest exactly once each, in order", () => {
    const payload = buildPayload([
      part("a", { unit: "percent", value: "30" }),
      part("b", { categoryId: "c-ins", projectId: null, value: "500" }),
    ], { categoryId: null, projectId: null });
    expect(payload).toEqual([
      { category_id: "c-elec", project_id: "p-herz", percent: 30 },
      { category_id: "c-ins", project_id: null, amount_minor: 50_000 },
      { rest: true },
    ]);
    expect(buildPayload([part("a", { value: "" })], { categoryId: null, projectId: null })).toBeNull();
    expect(buildPayload([], { categoryId: "c-ins", projectId: "p-raan" })).toEqual([{ rest: true, category_id: "c-ins", project_id: "p-raan" }]);
  });

  it("catches what the server would refuse, before the save", () => {
    expect(checkParts([], { categoryId: null, projectId: null }, ctx).form).toBe("too few parts");
    const reversal = checkParts([part("a", { categoryId: "c-refund", projectId: null })], { categoryId: null, projectId: null }, ctx);
    expect(reversal.parts.a).toBe("a reversal part needs a project");
    // The line's own category is exempt, as on the server.
    expect(checkParts([part("a", { categoryId: "c-build", projectId: "p-herz" })], { categoryId: null, projectId: null }, ctx).form).toBeNull();
    // No project means the line's project, so it repeats a part naming that project.
    const twice = checkParts([part("a", { projectId: null }), part("b", { projectId: "p-givat" })], { categoryId: null, projectId: null }, ctx);
    expect(twice.parts.a).toBe("same category and project twice");
    expect(twice.parts.b).toBe("same category and project twice");
    const restTwice = checkParts([part("a", { categoryId: "c-build", projectId: null })], { categoryId: null, projectId: null }, ctx);
    expect(restTwice.restDuplicate).toBe(true);
    const over = checkParts([part("a", { unit: "percent", value: "70" }), part("b", { categoryId: "c-ins", value: "2000" })], { categoryId: null, projectId: null }, ctx);
    expect(over.form).toBe("parts exceed the line");
    expect(over.overMinor).toBe(56_000n);
    expect(checkParts([part("a", { unit: "percent", value: "120" })], { categoryId: null, projectId: null }, ctx).parts.a).toBe("percent over");
    expect(checkParts([part("a", { value: "" })], { categoryId: null, projectId: null }, ctx).form).toBe("incomplete");
  });

  it("reopens a saved split: percent in %, amount in ₪, the rest as the rest row", () => {
    const read = parseLineSplit({
      transaction_id: "t1",
      currency: "ILS",
      line_minor: 480000,
      parts: [
        { category_id: "c-elec", category_name: "חשמל", project_id: "p-herz", project_name: "x", amount_minor: 144000, percent: 30.0, rest: false },
        { category_id: "c-ins", category_name: "ביטוח", project_id: null, project_name: null, amount_minor: 50050, percent: null, rest: false },
        { category_id: "c-subs", category_name: "קבלני משנה", project_id: "p-raan", project_name: "y", amount_minor: 285950, percent: null, rest: true },
      ],
      parts_match: true,
    });
    const draft = draftFromRead(read, "c-build");
    expect(draft.parts.map((row) => [row.categoryId, row.unit, row.value])).toEqual([["c-elec", "percent", "30"], ["c-ins", "amount", "500.50"]]);
    expect(draft.rest).toEqual({ categoryId: "c-subs", projectId: "p-raan" });
    expect(amountsPayload(read)).toEqual([
      { category_id: "c-elec", project_id: "p-herz", amount_minor: 144000 },
      { category_id: "c-ins", project_id: null, amount_minor: 50050 },
      { category_id: "c-subs", project_id: "p-raan", amount_minor: 285950 },
    ]);
  });

  it("a split restored by undo has no markers: the line's own category with no project becomes the rest", () => {
    const read = parseLineSplit({
      transaction_id: "t1",
      line_minor: "480000",
      parts: [
        { category_id: "c-elec", project_id: "p-herz", amount_minor: 144000 },
        { category_id: "c-build", project_id: null, amount_minor: 336000 },
      ],
    });
    expect(read?.partsMatch).toBe(true);
    const draft = draftFromRead(read, "c-build");
    expect(draft.parts).toHaveLength(1);
    expect(draft.parts[0]?.unit).toBe("amount");
    expect(draft.rest).toEqual({ categoryId: null, projectId: null });
  });

  it("matches the preview to the rows by pair, and the rest by its marker", () => {
    const parts = [part("a", { unit: "percent", value: "30" }), part("b", { categoryId: "c-ins", projectId: "p-raan", value: "500" })];
    const preview = parsePreview([
      { category_id: "c-elec", project_id: "p-herz", amount_minor: 144000, percent: 30, rest: false },
      { category_id: "c-ins", project_id: "p-raan", amount_minor: 50000, percent: null, rest: false },
      { category_id: "c-build", project_id: null, amount_minor: 286000, percent: null, rest: true },
    ]);
    expect(resolvePreview(preview, parts)).toEqual({ parts: { a: 144_000n, b: 50_000n }, rest: 286_000n });
    // A rest the server dropped (nothing left) takes 0.
    expect(resolvePreview(preview.slice(0, 2), parts).rest).toBe(0n);
  });
});

describe("the sample preview used by stories and tests matches decision 0123", () => {
  it("rounds percents together, the first part first on a tie", () => {
    const parts = [33.33, 33.33, 33.34].map((percent, index) => ({ category_id: `c${String(index)}`, project_id: null, percent }));
    expect(samplePreview(10_001n, "c9", parts).map((row) => row.amount_minor)).toEqual([3333n, 3333n, 3335n]);
    const halves = [50, 50].map((percent, index) => ({ category_id: `c${String(index)}`, project_id: null, percent }));
    expect(samplePreview(10_001n, "c9", halves).map((row) => row.amount_minor)).toEqual([5001n, 5000n]);
    expect(() => samplePreview(10_001n, "c9", [{ category_id: "c1", project_id: null, amount_minor: 10_001 }, { rest: true }])).toThrow("nothing is left for the rest");
  });
});
