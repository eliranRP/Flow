// @vitest-environment node
import { describe, expect, it } from "vitest";
import { REASSIGN_UNDO_CHANGED, REASSIGN_UNDO_FAILED, reassignUndoFailure } from "./review-copy";

// FLOW-1166 part 4: undo_reassign refuses a late undo once the line changed since the filing.
describe("reassignUndoFailure", () => {
  it("says the line changed since, with no retry, for the server's refusal", () => {
    expect(REASSIGN_UNDO_CHANGED).toBe("השורה שונתה מאז. הביטול לא בוצע.");
    expect(reassignUndoFailure(new Error("line changed since"))).toEqual({ message: REASSIGN_UNDO_CHANGED, tone: "info", retry: false });
  });

  it("keeps the write's own failure for anything else", () => {
    expect(reassignUndoFailure(new Error("undo not found"))).toBe(REASSIGN_UNDO_FAILED);
    expect(reassignUndoFailure(new Error("Failed to fetch"))).toBe(REASSIGN_UNDO_FAILED);
  });
});
