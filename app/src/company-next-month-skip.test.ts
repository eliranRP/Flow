import { describe, expect, it } from "vitest";
import { skipEdits } from "./company-next-month";

// FLOW-1079: a month's skips become one-month removals of the part's recurring rows.
describe("skipEdits", () => {
  const keys = ["party:expense:power:USD", "party:income:rent:USD:p2", "party:expense:hoa:USD:none", "invoice:abc"];

  it("takes a party's row out of every part, and a project's only out of its own", () => {
    expect(skipEdits(keys, "p1", "oh", "2027-01").map((edit) => edit.row_key)).toEqual(["rec:expense:power"]);
    expect(skipEdits(keys, "p2", "oh", "2027-01").map((edit) => edit.row_key)).toEqual(["rec:expense:power", "rec:income:rent"]);
  });

  it("gives the general costs the charges with no project or the overhead project's", () => {
    expect(skipEdits(keys, null, "oh", "2027-01").map((edit) => edit.row_key)).toEqual(["rec:expense:power", "rec:expense:hoa"]);
    expect(skipEdits(["party:expense:tax:USD:oh"], null, "oh", "2027-01")).toHaveLength(1);
  });

  it("holds for its month only", () => {
    expect(skipEdits(keys, "p1", null, "2027-01")[0]).toMatchObject({ kind: "remove", pace: "once", start_month: "2027-01", id: "skip:party:expense:power:USD" });
    expect(skipEdits(undefined, "p1", null, "2027-01")).toEqual([]);
  });
});
