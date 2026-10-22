import { describe, expect, it } from "vitest";
import { samplePreview } from "./line-split-preview";
import { amountOf, amountsPayload, amountText, buildPayload, checkParts, draftFromRead, type LineContext, newPartKey, parseLineSplit, parsePreview, type PartDraft, percentMinorOf, percentOf, readLineDraft, resolvePreview, reversalNeedsProject, shareOfLine, writeLineDraft } from "./line-split";
import { LINE_SPLIT_PLACE, LINE_SPLIT_REFUSALS, lineSplitCopy, lineSplitRefusal, localIssueCopy } from "./line-split-copy";

// --- line-split.test.ts

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

  it("lets a reversal part in a kept-out category go without a project unless the line is in the P&L (0138)", () => {
    const keptOutCtx: LineContext = { ...ctx, isReversal: (id) => id === "c-refund" || id === "c-owner", keptOut: (id) => id === "c-owner" };
    const noProject = (categoryId: string, context: LineContext) =>
      checkParts([part("a", { categoryId, projectId: null })], { categoryId: null, projectId: null }, context).parts.a;
    // Kept out and the line not forced in: it counts in no P&L, so no project is asked for.
    expect(noProject("c-owner", keptOutCtx)).toBeUndefined();
    expect(reversalNeedsProject("c-owner", keptOutCtx)).toBe(false);
    // A reversal part in a category that counts still needs one.
    expect(noProject("c-refund", keptOutCtx)).toBe("a reversal part needs a project");
    // The owner put the line in the P&L: its kept-out parts count, so the project is needed again.
    const inPnl = { ...keptOutCtx, lineInPnl: true };
    expect(noProject("c-owner", inPnl)).toBe("a reversal part needs a project");
    expect(reversalNeedsProject("c-owner", inPnl)).toBe(true);
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

describe("line split review fixes (FLOW-325)", () => {
  it("a part added after a reload never repeats a key the restored draft holds", () => {
    // A draft saved before the reload, when keys were handed out from 1 again.
    writeLineDraft("t-reload", {
      parts: [part("part-1", {}), part("part-2", { categoryId: "c-ins" })],
      rest: { categoryId: null, projectId: null },
    });
    const restored = readLineDraft("t-reload");
    expect(restored?.parts.map((row) => row.key)).toEqual(["part-1", "part-2"]);
    const keys = [...(restored?.parts ?? []).map((row) => row.key), newPartKey(), newPartKey()];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a saved percent with more than two decimals reopens in ₪ with its saved cents", () => {
    const read = parseLineSplit({
      transaction_id: "t1",
      line_minor: 480000,
      parts: [
        { category_id: "c-elec", project_id: "p-herz", amount_minor: 160000, percent: "33.3333", rest: false },
        { category_id: "c-ins", project_id: null, amount_minor: 120000, percent: 25, rest: false },
        { category_id: "c-build", project_id: null, amount_minor: 200000, percent: null, rest: true },
      ],
    });
    const draft = draftFromRead(read, "c-build");
    expect(draft.parts.map((row) => [row.unit, row.value])).toEqual([["amount", "1600"], ["percent", "25"]]);
    // Re-sent as the cents the server stored, not a percent rounded to 33.33.
    expect(buildPayload(draft.parts, draft.rest)?.[0]).toEqual({ category_id: "c-elec", project_id: "p-herz", amount_minor: 160_000 });
  });

  it("a percent's cents before any preview: the line × percent, rounded", () => {
    expect(percentMinorOf(30, 480_000n)).toBe(144_000n);
    expect(percentMinorOf(33.33, 10_001n)).toBe(3333n);
    expect(percentMinorOf(100, 10_001n)).toBe(10_001n);
  });
});
// --- line-split-copy.test.ts

const migrations = import.meta.glob<string>("../../supabase/migrations/*.sql", { query: "?raw", import: "default", eager: true });

/** The body of the newest `create ... function public.save_line_split`. */
function latestSaveLineSplit(): string {
  const names = Object.keys(migrations).sort();
  for (const name of names.reverse()) {
    const sql = migrations[name] ?? "";
    const start = sql.search(/create (or replace )?function public\.save_line_split\(/);
    if (start < 0) continue;
    const body = sql.slice(start);
    const open = body.indexOf("$$");
    const close = body.indexOf("$$", open + 2);
    return body.slice(open, close);
  }
  throw new Error("save_line_split not found");
}

describe("line split refusal copy (FLOW-325)", () => {
  it("has Hebrew for every reason save_line_split raises", () => {
    const body = latestSaveLineSplit();
    const raised = [...new Set([...body.matchAll(/raise exception '([^']+)'/g)].map((match) => match[1] ?? ""))];
    expect(raised.length).toBeGreaterThan(10);
    const known: readonly string[] = LINE_SPLIT_REFUSALS;
    const missing = raised.filter((reason) => !known.includes(reason));
    expect(missing, `no Hebrew copy for: ${missing.join(", ")}`).toEqual([]);
    for (const reason of LINE_SPLIT_REFUSALS) {
      const copy = lineSplitCopy(reason);
      expect(copy).toMatch(/[֐-׿]/);
      expect(copy).not.toContain(reason);
      expect(LINE_SPLIT_PLACE[reason]).toBeDefined();
    }
  });

  it("names the amounts when it knows them", () => {
    expect(lineSplitCopy("parts exceed the line", { overMinor: 56_000n })).toBe("החלקים עוברים את השורה ב־₪560. הקטינו חלק.");
    expect(lineSplitCopy("parts exceed the line")).toBe("החלקים עוברים את השורה. הקטינו חלק.");
    expect(lineSplitCopy("parts must sum to the line", { lineMinor: 480_000n, missingMinor: 1_050n })).toBe("החלקים צריכים להסתכם ב־₪4,800. חסרים ₪10.50.");
    expect(lineSplitCopy("a reversal part needs a project")).toBe("חלק החזר צריך פרויקט.");
    expect(lineSplitCopy("same category and project twice")).toBe("הפרויקט והקטגוריה האלה כבר בפיצול");
    expect(lineSplitCopy("transaction not found")).toBe(lineSplitCopy("project not found"));
    expect(localIssueCopy("too few parts")).toBe("פיצול צריך לפחות שני חלקים.");
  });

  it("reads the reason out of a PostgREST error", () => {
    expect(lineSplitRefusal(new Error("line has an open review"))).toBe("line has an open review");
    expect(lineSplitRefusal(new Error("validation"))).toBe("validation");
    expect(lineSplitRefusal(new Error("Failed to fetch"))).toBeNull();
  });
});
describe("gross-up split parts (FLOW-946, decision 0206)", () => {
  // A deposit: gross proceeds (+income) minus a real closing cost paid at closing. The signed
  // sum of the parts (a gross-up part negated) is the net that hit the bank, 970.00.
  const depCtx: LineContext = {
    lineMinor: 97_000n,
    lineCategoryId: "c-rent",
    lineProjectId: "p-a",
    isReversal: (id) => id === "c-cost",
  };

  it("buildPayload emits gross_up on the amount part", () => {
    const payload = buildPayload([
      { key: "a", categoryId: "c-proceeds", projectId: null, unit: "amount", value: "1000" },
      { key: "b", categoryId: "c-cost", projectId: "p-a", unit: "amount", value: "30", grossUp: true },
    ], { categoryId: null, projectId: null });
    expect(payload).toEqual([
      { category_id: "c-proceeds", project_id: null, amount_minor: 100_000 },
      { category_id: "c-cost", project_id: "p-a", amount_minor: 3_000, gross_up: true },
      { rest: true },
    ]);
  });

  it("the remaining to allocate reaches 0 only with signed math", () => {
    const parts: PartDraft[] = [
      { key: "a", categoryId: "c-proceeds", projectId: null, unit: "amount", value: "1000" },
      { key: "b", categoryId: "c-cost", projectId: "p-a", unit: "amount", value: "30", grossUp: true },
    ];
    const check = checkParts(parts, { categoryId: null, projectId: null }, depCtx);
    // 97000 - (100000 - 3000) = 0. If the gross-up were added, used would be 103000 and over.
    expect(check.restMinor).toBe(0n);
    expect(check.overMinor).toBe(0n);
    expect(check.form).toBeNull();
    // The same amounts with the cost as a plain (added) part overshoot the line.
    const added = checkParts(
      parts.map((p) => (p.key === "b" ? { ...p, grossUp: false } : p)),
      { categoryId: null, projectId: null },
      depCtx,
    );
    expect(added.restMinor).toBe(-6_000n);
    expect(added.form).toBe("parts exceed the line");
  });

  it("still needs a project but now allows either kind (contra, FLOW-947)", () => {
    const noProject = checkParts([
      { key: "a", categoryId: "c-proceeds", projectId: null, unit: "amount", value: "1000" },
      { key: "b", categoryId: "c-cost", projectId: null, unit: "amount", value: "30", grossUp: true },
    ], { categoryId: null, projectId: null }, depCtx);
    expect(noProject.parts.b).toBe("a gross-up part needs a project");
    // A same-kind gross-up part (contra: an income category on an income line) is accepted now;
    // the old "gross-up wrong side" issue is gone, and the signed sum still nets to the line.
    const contra = checkParts([
      { key: "a", categoryId: "c-proceeds", projectId: null, unit: "amount", value: "1000" },
      { key: "b", categoryId: "c-rent", projectId: "p-b", unit: "amount", value: "30", grossUp: true },
    ], { categoryId: null, projectId: null }, depCtx);
    expect(contra.parts.b).toBeUndefined();
    expect(contra.form).toBeNull();
    expect(contra.restMinor).toBe(0n);
  });

  it("reopens a saved gross-up part in the editor", () => {
    const read = parseLineSplit({
      transaction_id: "t", currency: "USD", line_minor: 97_000,
      parts: [
        { category_id: "c-proceeds", project_id: null, amount_minor: 100_000, gross_up: false },
        { category_id: "c-cost", project_id: "p-a", amount_minor: 3_000, gross_up: true },
      ],
      parts_match: true,
    });
    const draft = draftFromRead(read, "c-rent");
    expect(draft.parts.find((p) => p.categoryId === "c-cost")?.grossUp).toBe(true);
    expect(amountsPayload(read)).toEqual([
      { category_id: "c-proceeds", project_id: null, amount_minor: 100_000 },
      { category_id: "c-cost", project_id: "p-a", amount_minor: 3_000, gross_up: true },
    ]);
  });

  // Payment-side symmetry: an expense line with a positive income credit part.
  const payCtx: LineContext = {
    lineMinor: 5_000n,
    lineCategoryId: "c-build",
    lineProjectId: "p-b",
    isReversal: (id) => id === "c-credit",
  };

  it("handles the payment side: an income credit nets against an expense line", () => {
    // The real cost is on a non-line expense category (c-labor), so the implicit rest on the
    // line's own category does not collide with it, and the two parts sum to the line exactly.
    const parts: PartDraft[] = [
      { key: "a", categoryId: "c-labor", projectId: "p-b", unit: "amount", value: "60" },
      { key: "b", categoryId: "c-credit", projectId: "p-b", unit: "amount", value: "10", grossUp: true },
    ];
    expect(buildPayload(parts, { categoryId: null, projectId: null })).toEqual([
      { category_id: "c-labor", project_id: "p-b", amount_minor: 6_000 },
      { category_id: "c-credit", project_id: "p-b", amount_minor: 1_000, gross_up: true },
      { rest: true },
    ]);
    // 5000 - (6000 - 1000) = 0.
    const check = checkParts(parts, { categoryId: null, projectId: null }, payCtx);
    expect(check.restMinor).toBe(0n);
    expect(check.overMinor).toBe(0n);
    expect(check.form).toBeNull();
    // The no-project issue fires on the payment side too.
    const noProject = checkParts([
      { key: "a", categoryId: "c-labor", projectId: "p-b", unit: "amount", value: "60" },
      { key: "b", categoryId: "c-credit", projectId: null, unit: "amount", value: "10", grossUp: true },
    ], { categoryId: null, projectId: null }, payCtx);
    expect(noProject.parts.b).toBe("a gross-up part needs a project");
    // A same-kind gross-up part (contra-expense: an expense category on an expense line) is now
    // accepted; the signed sum still nets (6000 - 1000 = 5000) and there is no wrong-side issue.
    const contra = checkParts([
      { key: "a", categoryId: "c-labor", projectId: "p-b", unit: "amount", value: "60" },
      { key: "b", categoryId: "c-build", projectId: "p-c", unit: "amount", value: "10", grossUp: true },
    ], { categoryId: null, projectId: null }, payCtx);
    expect(contra.parts.b).toBeUndefined();
    expect(contra.form).toBeNull();
    expect(contra.restMinor).toBe(0n);
  });

  it("a split that overshoots even after a gross-up part is flagged over the line", () => {
    // proceeds 1100.00 added, cost 30.00 subtracted => 1070.00 used against a 970.00 line.
    const check = checkParts([
      { key: "a", categoryId: "c-proceeds", projectId: null, unit: "amount", value: "1100" },
      { key: "b", categoryId: "c-cost", projectId: "p-a", unit: "amount", value: "30", grossUp: true },
    ], { categoryId: null, projectId: null }, depCtx);
    expect(check.overMinor).toBe(10_000n);
    expect(check.form).toBe("parts exceed the line");
    expect(check.restMinor).toBe(-10_000n);
  });

  it("the sample preview nets a gross-up part on either kind (FLOW-947)", () => {
    const preview = samplePreview(97_000n, "c-rent", [
      { category_id: "c-proceeds", project_id: null, amount_minor: 100_000 },
      { category_id: "c-cost", project_id: "p-a", amount_minor: 3_000, gross_up: true },
    ], (id) => id === "c-cost");
    expect(preview.map((r) => [r.category_id, r.amount_minor, r.grossUp])).toEqual([
      ["c-proceeds", 100_000n, false],
      ["c-cost", 3_000n, true],
    ]);
    // A same-kind gross-up part (contra) is accepted; the preview nets it the same way.
    const contra = samplePreview(97_000n, "c-rent", [
      { category_id: "c-proceeds", project_id: null, amount_minor: 100_000 },
      { category_id: "c-rent", project_id: "p-a", amount_minor: 3_000, gross_up: true },
    ], (id) => id === "c-cost");
    expect(contra.map((r) => [r.category_id, r.amount_minor, r.grossUp])).toEqual([
      ["c-proceeds", 100_000n, false],
      ["c-rent", 3_000n, true],
    ]);
    // Only the project is still required on a gross-up part.
    expect(() =>
      samplePreview(97_000n, "c-rent", [
        { category_id: "c-proceeds", project_id: null, amount_minor: 100_000 },
        { category_id: "c-rent", project_id: null, amount_minor: 3_000, gross_up: true },
      ], (id) => id === "c-cost")
    ).toThrow("a gross-up part needs a project");
  });

  it("buildPayload emits gross_up and an explicit effect when the draft carries it (FLOW-947)", () => {
    const payload = buildPayload([
      { key: "a", categoryId: "c-proceeds", projectId: null, unit: "amount", value: "1000" },
      { key: "b", categoryId: "c-rent", projectId: "p-a", unit: "amount", value: "30", grossUp: true, effect: "contra" },
    ], { categoryId: null, projectId: null });
    expect(payload).toEqual([
      { category_id: "c-proceeds", project_id: null, amount_minor: 100_000 },
      { category_id: "c-rent", project_id: "p-a", amount_minor: 3_000, gross_up: true, effect: "contra" },
      { rest: true },
    ]);
    // effect rides only on a gross-up amount part: a plain part never carries it.
    const plain = buildPayload([
      { key: "a", categoryId: "c-proceeds", projectId: null, unit: "amount", value: "1000", effect: "normal" },
      { key: "b", categoryId: "c-rent", projectId: "p-a", unit: "amount", value: "30", grossUp: true },
    ], { categoryId: null, projectId: null });
    expect(plain?.[0]).toEqual({ category_id: "c-proceeds", project_id: null, amount_minor: 100_000 });
    expect(plain?.[1]).toEqual({ category_id: "c-rent", project_id: "p-a", amount_minor: 3_000, gross_up: true });
  });
});
