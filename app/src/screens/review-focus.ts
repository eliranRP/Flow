/**
 * FLOW-309: focus that was in the queue's action bar when the queue went away (the last card left)
 * or when ביטול was pressed on the toast. Module state, because the screen swaps the queue for the
 * empty state and back, which unmounts it. The empty state's action or the returning card's first
 * button takes it, once, within a few seconds (a ביטול on a slow network still lands); after that it lapses, so a later visit never steals focus.
 * A tap that never focused the bar (iPhone) hands nothing over.
 */
let handedAt = 0;

/** How long a hand-off waits for the screen that takes it. */
export const REVIEW_FOCUS_HANDOFF_MS = 4000;

export function handReviewFocus(): void {
  handedAt = Date.now();
}

/** True once if focus was handed over a moment ago. */
export function takeReviewFocus(): boolean {
  const handed = handedAt !== 0 && Date.now() - handedAt < REVIEW_FOCUS_HANDOFF_MS;
  handedAt = 0;
  return handed;
}

/** The empty queue's first action (לדף הבית, or the project's Back). */
export function focusReviewEmptyAction(): void {
  document.querySelector<HTMLElement>(".ui-empty-action a[href], .ui-empty-action button")?.focus({ preventScroll: true });
}
