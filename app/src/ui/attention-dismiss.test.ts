import { afterEach, describe, expect, it, vi } from "vitest";
import { hideRow, isRowHidden, readHidden, restoreAll } from "./attention-dismiss";

describe("attention-dismiss (FLOW-1043)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("keeps each hidden row's dismissKey under flow.attention.<storageKey>", () => {
    expect(readHidden("home")).toEqual({});
    const once = hideRow("home", "changes", "changes:4");
    hideRow("home", "unpaid", "unpaid:3:2130000", once);
    expect(JSON.parse(window.localStorage.getItem("flow.attention.home") ?? "null")).toEqual({
      changes: "changes:4",
      unpaid: "unpaid:3:2130000",
    });
    expect(readHidden("home")).toEqual({ changes: "changes:4", unpaid: "unpaid:3:2130000" });
    expect(readHidden("projects")).toEqual({});
  });

  it("hides a row only while its stored key equals its current one", () => {
    const hidden = hideRow("home", "changes", "changes:4");
    expect(isRowHidden(hidden, { id: "changes", dismissKey: "changes:4" })).toBe(true);
    expect(isRowHidden(hidden, { id: "changes", dismissKey: "changes:5" })).toBe(false);
    expect(isRowHidden(hidden, { id: "changes" })).toBe(false);
    expect(isRowHidden(hidden, { id: "gym", dismissKey: "changes:4" })).toBe(false);
  });

  it("restores every row of one screen and leaves the others", () => {
    hideRow("home", "changes", "changes:4");
    hideRow("projects", "late", "late:1");
    restoreAll("home");
    expect(readHidden("home")).toEqual({});
    expect(readHidden("projects")).toEqual({ late: "late:1" });
  });

  it("reads a broken or foreign value as nothing hidden", () => {
    window.localStorage.setItem("flow.attention.home", "{not json");
    expect(readHidden("home")).toEqual({});
    window.localStorage.setItem("flow.attention.home", JSON.stringify(["changes"]));
    expect(readHidden("home")).toEqual({});
    window.localStorage.setItem("flow.attention.home", JSON.stringify({ changes: 4, gym: "gym:1" }));
    expect(readHidden("home")).toEqual({ gym: "gym:1" });
  });

  it("works without storage: a read is empty and a write still returns the new set", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);
    expect(readHidden("home")).toEqual({});
    expect(hideRow("home", "changes", "changes:4", { gym: "gym:1" })).toEqual({ gym: "gym:1", changes: "changes:4" });
    expect(() => {
      restoreAll("home");
    }).not.toThrow();
  });
});
