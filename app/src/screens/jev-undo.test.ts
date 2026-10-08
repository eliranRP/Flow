import { describe, expect, it } from "vitest";
import { JEV_UNDO_CHANGED, JEV_UNDO_CLOSED, JEV_UNDO_FAILED, JEV_UNDO_NOTHING, jevUndoFailure } from "./jev-undo";

describe("jevUndoFailure (FLOW-702, decision 0145)", () => {
  it("names each refusal and does not offer a retry", () => {
    expect(jevUndoFailure(new Error("nothing to undo"))).toEqual({ message: JEV_UNDO_NOTHING, tone: "info", retry: false });
    expect(jevUndoFailure(new Error("line changed since"))).toEqual({ message: JEV_UNDO_CHANGED, tone: "info", retry: false });
    expect(jevUndoFailure(new Error("review item not found"))).toEqual({ message: JEV_UNDO_CLOSED, tone: "info", retry: false });
  });

  it("retries a dropped connection and not a refusal it does not know", () => {
    expect(jevUndoFailure(new Error("Failed to fetch"))).toEqual({ message: JEV_UNDO_FAILED, retry: true });
    expect(jevUndoFailure(new Error("forbidden"))).toEqual({ message: JEV_UNDO_FAILED, retry: false });
  });
});
