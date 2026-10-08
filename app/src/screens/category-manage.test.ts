import { describe, expect, it } from "vitest";
import { readDeleted, readMoved } from "./category-manage";

describe("category delete and move helpers (FLOW-405)", () => {
  it("reads delete_category and move_category_lines results", () => {
    expect(readDeleted({ deletion_id: "x", name: "ציוד", lines: 3 }, "אחר")).toEqual({ name: "ציוד", lines: 3 });
    expect(readDeleted(null, "אחר")).toEqual({ name: "אחר", lines: 0 });
    expect(readMoved({ move_id: "m1", lines: 2 })).toEqual({ moveId: "m1", lines: 2 });
    expect(readMoved({ lines: 2 })).toBeNull();
  });
});
