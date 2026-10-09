import type { ReviewRow } from "@flow/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type ReviewMotion = "still" | "out" | "in";

/** How long the leaving card fades before the next one lands (`--dur-base`). */
export const REVIEW_SWAP_MS = 200;

/** Every field of a review row is a primitive, so a shallow compare says whether the card changed. */
export function sameReviewRow(a: ReviewRow, b: ReviewRow): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ReviewRow>;
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

/**
 * FLOW-309: the card on screen and its motion. The head's id is the swap: a fresh array for the same
 * line doesn't restart a card already on its way in. A card that comes back while it was leaving
 * settles where it is (it used to stay "out", with אישור disabled). A change to the card on screen
 * shows at once, whichever field changed. The latest head is kept in a ref written after render, so
 * the timer lands whatever is the head when it fires.
 */
export function useReviewSwap(next: ReviewRow | null): { shown: ReviewRow | null; motion: ReviewMotion } {
  const [shown, setShown] = useState<ReviewRow | null>(next);
  const [motion, setMotion] = useState<ReviewMotion>("still");
  const nextRef = useRef(next);
  useLayoutEffect(() => {
    nextRef.current = next;
  });
  const nextId = next?.id ?? null;
  useEffect(() => {
    if (shown == null) {
      setShown(nextRef.current);
      setMotion("still");
      return;
    }
    if (nextId === shown.id) {
      // The card came back (or never left): stop leaving. "in" plays on.
      setMotion((current) => (current === "out" ? "still" : current));
      return;
    }
    setMotion("out");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      const landed = nextRef.current;
      setShown(landed);
      setMotion(landed ? "in" : "still");
    }, reduce ? 0 : REVIEW_SWAP_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [nextId, shown]);
  useEffect(() => {
    if (next != null && shown != null && next.id === shown.id && !sameReviewRow(next, shown)) setShown(next);
  }, [next, shown]);
  return { shown, motion };
}
