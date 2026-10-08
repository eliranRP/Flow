/** Unsaved split drafts live in sessionStorage under this prefix, one key per line. */
const SPLIT_DRAFT_PREFIX = "flow-split:";
/** The user the tab's drafts belong to. */
const SPLIT_DRAFT_OWNER_KEY = "flow-split-owner";

export function splitDraftKey(id: string): string {
  return `${SPLIT_DRAFT_PREFIX}${id}`;
}

/**
 * Keeps the tab's split drafts only while they belong to `userId`. Sign-out,
 * an expired session and a user switch drop them, and so does a reload that
 * finds a different (or no) user than the one who wrote them.
 */
export function keepSplitDraftsFor(userId: string | null): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    const owner = sessionStorage.getItem(SPLIT_DRAFT_OWNER_KEY);
    if (owner !== userId) {
      const drafts: string[] = [];
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(SPLIT_DRAFT_PREFIX)) drafts.push(key);
      }
      for (const key of drafts) sessionStorage.removeItem(key);
    }
    if (userId == null) sessionStorage.removeItem(SPLIT_DRAFT_OWNER_KEY);
    else sessionStorage.setItem(SPLIT_DRAFT_OWNER_KEY, userId);
  } catch {
    // Storage blocked: there are no drafts to keep either.
  }
}
