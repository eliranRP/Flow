// @vitest-environment node
import { describe, expect, it } from "vitest";
import { emptyVisit, noteHandled, notePresence, visitPlace } from "./visit-meter";

describe("visit meter", () => {
  it("starts at 1 of the open cards", () => {
    expect(visitPlace(emptyVisit(), ["a", "b", "c"])).toEqual({ index: 1, total: 3 });
  });

  it("hides the counter when nothing is open", () => {
    expect(visitPlace(emptyVisit(), [])).toEqual({ index: 0, total: 0 });
  });

  it("does not count a just-handled card twice", () => {
    const handled = noteHandled(emptyVisit(), "a");
    expect(visitPlace(handled, ["a", "b"])).toEqual({ index: 2, total: 2 });
  });

  it("keeps n when the handled card leaves", () => {
    const handled = noteHandled(emptyVisit(), "a");
    const left = notePresence(handled, ["b"]);
    expect(visitPlace(left, ["b"])).toEqual({ index: 2, total: 2 });
  });

  it("grows n by one when that card comes back", () => {
    const handled = noteHandled(emptyVisit(), "a");
    const left = notePresence(handled, ["b"]);
    expect(visitPlace(left, ["a", "b"])).toEqual({ index: 2, total: 3 });
  });

  it("keeps i when a card closes remotely", () => {
    expect(visitPlace(emptyVisit(), ["b", "c"])).toEqual({ index: 1, total: 2 });
  });

  it("keeps i when a new card arrives", () => {
    const handled = noteHandled(emptyVisit(), "a");
    const left = notePresence(handled, ["b"]);
    expect(visitPlace(left, ["b", "c"])).toEqual({ index: 2, total: 3 });
  });

  it("does not decrease h when the same card is handled again", () => {
    const once = noteHandled(emptyVisit(), "a");
    expect(noteHandled(once, "a")).toBe(once);
  });

  it("counts the server's open items when only some pages are loaded (FLOW-984)", () => {
    expect(visitPlace(emptyVisit(), ["a", "b"], 1287)).toEqual({ index: 1, total: 1287 });
    const handled = noteHandled(emptyVisit(), "a");
    const left = notePresence(handled, ["b"]);
    // One card is done and 1,286 are open: the visit has 1,287.
    expect(visitPlace(left, ["b"], 1286)).toEqual({ index: 2, total: 1287 });
    // A skipped card is still open: it is not counted twice.
    expect(visitPlace(handled, ["a", "b"], 1287)).toEqual({ index: 2, total: 1287 });
  });
});
