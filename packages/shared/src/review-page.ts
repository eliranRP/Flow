import { z } from "zod";
import { reviewRowSchema } from "./dashboard.ts";

/** FLOW-984: where the next page of the review queue starts: the last item's doc date, created-at and id. */
export const reviewCursorSchema = z.object({
  doc_date: z.string(),
  created_at: z.string(),
  id: z.string(),
});

/** FLOW-984: one page of list_review_page. `total` counts every open item; `next` is null on the last page. */
export const reviewPageSchema = z.object({
  items: z.array(reviewRowSchema),
  total: z.number().int().nonnegative(),
  next: reviewCursorSchema.nullable(),
});

export type ReviewCursor = z.infer<typeof reviewCursorSchema>;
