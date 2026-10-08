import { afterEach, describe, expect, it } from "vitest";
import { keepSplitDraftsFor, splitDraftKey } from "./split-drafts";
import { lineSplitDraftKey } from "./line-split";

afterEach(() => {
  sessionStorage.clear();
});

describe("keepSplitDraftsFor", () => {
  it("drops both kinds of split draft when the user changes (FLOW-325)", () => {
    keepSplitDraftsFor("user-a");
    sessionStorage.setItem(splitDraftKey("t1"), "{}");
    sessionStorage.setItem(lineSplitDraftKey("t1"), "{}");
    sessionStorage.setItem("flow-other", "kept");
    keepSplitDraftsFor("user-a");
    expect(sessionStorage.getItem(lineSplitDraftKey("t1"))).toBe("{}");
    keepSplitDraftsFor("user-b");
    expect(sessionStorage.getItem(splitDraftKey("t1"))).toBeNull();
    expect(sessionStorage.getItem(lineSplitDraftKey("t1"))).toBeNull();
    expect(sessionStorage.getItem("flow-other")).toBe("kept");
  });
});
