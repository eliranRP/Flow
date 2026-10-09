import { describe, expect, it } from "vitest";
import { checkProjectSplit, percentPartsMinor, projectDraftFrom, sharesKey, type ProjectPart } from "./project-split";

const part = (key: string, projectId: string, value: string, unit: ProjectPart["unit"] = "amount"): ProjectPart => ({ key, projectId, unit, value });

describe("percentPartsMinor (FLOW-346)", () => {
  it("rounds like save_line_split: floor, then the largest remainders", () => {
    expect(percentPartsMinor([33.33, 33.33, 33.34], 10_001n)).toEqual([3_333n, 3_333n, 3_335n]);
    expect(percentPartsMinor([50, 50], 10_001n)).toEqual([5_001n, 5_000n]);
    expect(percentPartsMinor([25], 10_000n)).toEqual([2_500n]);
  });
});

describe("checkProjectSplit (FLOW-346)", () => {
  it("leaves the rest on its project to the cent", () => {
    const check = checkProjectSplit([part("x", "b", "8000")], "a", 2_866_316n);
    expect(check.restMinor).toBe(2_066_316n);
    expect(check.shares).toEqual([
      { project_id: "b", amount_minor: 800_000 },
      { project_id: "a", amount_minor: 2_066_316 },
    ]);
  });

  it("drops a rest with nothing left", () => {
    const check = checkProjectSplit([part("x", "b", "60"), part("y", "c", "40")], "a", 10_000n);
    expect(check.restMinor).toBe(0n);
    expect(check.shares).toEqual([
      { project_id: "b", amount_minor: 6_000 },
      { project_id: "c", amount_minor: 4_000 },
    ]);
  });

  it("refuses parts past the line, a missing value, a repeated project and a rest with no project", () => {
    expect(checkProjectSplit([part("x", "b", "120")], "a", 10_000n).overMinor).toBe(2_000n);
    expect(checkProjectSplit([part("x", "b", "")], "a", 10_000n).issues.x).toBe("missing");
    expect(checkProjectSplit([part("x", "a", "10")], "a", 10_000n).issues.x).toBe("same project twice");
    const noRest = checkProjectSplit([part("x", "b", "10")], null, 10_000n);
    expect(noRest.restIssue).toBe("no project");
    expect(noRest.shares).toBeNull();
  });

  it("mixes percent and amount parts", () => {
    const check = checkProjectSplit([part("x", "b", "25", "percent"), part("y", "c", "10.5")], "a", 10_001n);
    expect(check.minor).toEqual({ x: 2_500n, y: 1_050n });
    expect(check.restMinor).toBe(6_451n);
  });
});

describe("projectDraftFrom (FLOW-346)", () => {
  it("opens a one-project line with no parts", () => {
    expect(projectDraftFrom("a", [{ project_id: "a", amount_net: -10_000n }])).toEqual({ parts: [], restProjectId: "a" });
    expect(projectDraftFrom(null, [])).toEqual({ parts: [], restProjectId: null });
  });

  it("opens a saved split with the largest project as the rest and the others in exact amounts", () => {
    const draft = projectDraftFrom(null, [
      { project_id: "b", amount_net: -800_000n },
      { project_id: "a", amount_net: -2_066_316n },
    ]);
    expect(draft.restProjectId).toBe("a");
    expect(draft.parts.map((item) => [item.projectId, item.unit, item.value])).toEqual([["b", "amount", "8000"]]);
    const check = checkProjectSplit(draft.parts, draft.restProjectId, 2_866_316n);
    expect(sharesKey(check.shares)).toBe("a:2066316|b:800000");
  });
});
