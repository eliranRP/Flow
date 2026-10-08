import { describe, expect, it } from "vitest";
import { reviewerBooks, reviewerBooksAddUp, reviewerFiled, reviewerFiledCount, reviewerFiledView, reviewerSharesFor } from "./reviewer-sample";

describe("reviewer sample books", () => {
  it("adds the category lines, the waiting line, and the shared split", () => {
    const books = reviewerBooks();
    expect(reviewerBooksAddUp()).toBe(true);
    expect(books.approved).toBe(40_000n);
    expect(books.projectExpenses).toBe(85_000n);
    expect(books.profit).toBe(95_000n);
    expect(books.queueTotal).toBe(145_000n);
    expect(books.split.map((part) => part.agorot)).toEqual([60_000n, 40_000n]);
  });

  it("keeps שויכו היום automatic only: no approval of this visit joins it (FLOW-309)", () => {
    expect(reviewerFiledCount()).toBe(reviewerFiled.length);
    expect(reviewerFiledView().map((row) => row.id)).toEqual(reviewerFiled.map((row) => row.id));
    expect(reviewerFiledView().some((row) => row.id === "t-bolts")).toBe(false);
    expect(reviewerSharesFor("t-bolts")).toBeNull();
    expect(reviewerBooks().bannerCount).toBe(reviewerFiled.length);
    expect(reviewerBooks().filedCount).toBe(reviewerFiled.length);
  });
});
