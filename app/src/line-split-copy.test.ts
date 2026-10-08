import { describe, expect, it } from "vitest";
import { LINE_HAS_CATEGORY_SPLIT, LINE_SPLIT_PLACE, LINE_SPLIT_REFUSALS, lineSplitCopy, lineSplitRefusal, localIssueCopy, projectSplitFailure } from "./line-split-copy";

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
    expect(lineSplitCopy("same category and project twice")).toBe("הקטגוריה והפרויקט האלה כבר בחלק אחר.");
    expect(lineSplitCopy("transaction not found")).toBe(lineSplitCopy("project not found"));
    expect(localIssueCopy("too few parts")).toBe("פיצול צריך לפחות שני חלקים.");
  });

  it("reads the reason out of a PostgREST error", () => {
    expect(lineSplitRefusal(new Error("line has an open review"))).toBe("line has an open review");
    expect(lineSplitRefusal(new Error("validation"))).toBe("validation");
    expect(lineSplitRefusal(new Error("Failed to fetch"))).toBeNull();
  });

  it("the project split names a line split by category instead of offering a retry", () => {
    expect(projectSplitFailure(new Error("line has a split by category"))).toEqual({ message: LINE_HAS_CATEGORY_SPLIT, retry: false });
    expect(projectSplitFailure(new Error("Failed to fetch"))).toBe("הפיצול לא נשמר");
  });
});
