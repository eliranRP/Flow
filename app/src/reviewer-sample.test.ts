import { describe, expect, it } from "vitest";
import { fileReviewerApproval, reviewerBooks, reviewerBooksAddUp, reviewerFiled, reviewerFiledCount, unfileReviewerApproval } from "./reviewer-sample";

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

  it("counts an approved split in the banner and the filed list", () => {
    expect(reviewerFiledCount()).toBe(reviewerFiled.length);
    fileReviewerApproval("q-bolts");
    try {
      expect(reviewerFiledCount()).toBe(reviewerFiled.length + 1);
      expect(reviewerBooks().bannerCount).toBe(reviewerFiledCount());
      expect(reviewerBooks().filedCount).toBe(reviewerFiledCount());
    } finally {
      unfileReviewerApproval("q-bolts");
    }
  });
});
