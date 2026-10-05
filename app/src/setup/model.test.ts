import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORY_NAMES, categoryTitle, nameHint, projectTitle } from "./copy";
import {
  allDone,
  backPath,
  cardRows,
  cardVisible,
  continuePath,
  decideEntry,
  doneCount,
  emptyFacts,
  firstNotDone,
  firstResumable,
  isDone,
  resumeStamp,
  settingsEntryVisible,
  skipPatch,
  type SetupFacts,
} from "./model";
import { emptySetupStore, type SetupStore } from "./storage";

const at = "2026-10-04T00:00:00.000Z";

function facts(patch: Partial<SetupFacts> = {}): SetupFacts {
  return { ...emptyFacts(true), companyId: "company-1", ...patch };
}

function started(patch: Partial<SetupStore> = {}): SetupStore {
  return { ...emptySetupStore(), run_started_at: at, ...patch };
}

describe("setup step model", () => {
  it("does not count step 0 and keeps the counter at 5", () => {
    const store = emptySetupStore();
    const open = facts();
    expect(doneCount(store, open)).toBe(0);
    expect(firstNotDone(store, open)).toBe(1);
    expect(isDone(1, store, facts({ sumitConnected: true }))).toBe(true);
    expect(doneCount(started(), facts({ sumitConnected: true, jevSaved: true, hasResolvedReview: true, standalone: true }))).toBe(4);
  });

  it("treats a skip as not done and leaves it on the card", () => {
    const store = skipPatch(started(), 2, at);
    const state = facts({ sumitConnected: true, hasResolvedReview: true });
    expect(isDone(2, store, state)).toBe(false);
    expect(doneCount(store, state)).toBe(2);
    expect(cardRows(store, state, false)).toEqual([2, 3, 5]);
    expect(firstResumable(store, state)).toBe(3);
  });

  it("hides the SUMIT row whenever Home is empty", () => {
    const state = facts();
    expect(cardRows(started(), state, true)).toEqual([2, 3, 4, 5]);
    expect(cardRows(started(), state, false)).toEqual([1, 2, 3, 4, 5]);
    expect(cardRows(skipPatch(started(), 1, at), state, true)).not.toContain(1);
  });

  it("opens step 0 until a company exists, and does not start a finished account", () => {
    expect(decideEntry(emptySetupStore(), emptyFacts(true), false, at)).toEqual({
      kind: "redirect",
      to: "/setup/0",
      patch: null,
      markSession: false,
    });
    const done = facts({ sumitConnected: true, jevSaved: true, hasResolvedReview: true, standalone: true });
    const confirmed = { ...emptySetupStore(), confirmed_lists_at: at, sample_review_at: at };
    expect(allDone(confirmed, done)).toBe(true);
    expect(decideEntry(confirmed, done, false, at)).toEqual({ kind: "stay" });
    expect(cardVisible(confirmed, done, false)).toBe(false);
  });

  it("starts at the first not-done step, then resumes once past skipped steps", () => {
    const open = facts({ sumitConnected: true });
    expect(decideEntry(emptySetupStore(), open, false, at)).toEqual({
      kind: "redirect",
      to: "/setup/2",
      patch: { run_started_at: at },
      markSession: true,
    });
    const skipped = skipPatch(started(), 2, at);
    expect(decideEntry(skipped, open, false, at)).toEqual({
      kind: "redirect",
      to: "/setup/3",
      patch: { run_resumed_at: at },
      markSession: true,
    });
    expect(decideEntry(skipped, open, true, at)).toEqual({ kind: "stay" });
    expect(resumeStamp({ ...skipped, run_resumed_at: at }, open, false, at)).toBeNull();
  });

  it("sends card and finish actions home, and step 1 back only after this run created the company", () => {
    expect(backPath(0, false, true)).toBeNull();
    expect(backPath(1, false, false)).toBeNull();
    expect(backPath(1, false, true)).toBe("/setup/0");
    expect(backPath(2, true, false)).toBe("/");
    expect(continuePath(2, true)).toBe("/");
    expect(continuePath(2, false)).toBe("/setup/3");
    expect(continuePath(5, false)).toBe("/");
  });

  it("keeps settings closed until the run starts and hides it at 5 of 5", () => {
    const open = facts();
    expect(settingsEntryVisible(emptySetupStore(), open)).toBe(false);
    expect(settingsEntryVisible(started(), open)).toBe(true);
    expect(firstNotDone(started(), facts({ sumitConnected: true }))).toBe(2);
  });

  it("names nine default categories when SUMIT has not sent a list", () => {
    expect(DEFAULT_CATEGORY_NAMES).toHaveLength(9);
    expect(categoryTitle(9)).toBe("9 קטגוריות");
    expect(categoryTitle(1)).toBe("קטגוריה אחת");
    expect(projectTitle(0)).toBe("אין פרויקטים");
    expect(nameHint([...DEFAULT_CATEGORY_NAMES], 3)).toEqual({
      head: "חומרים, קבלני משנה, עבודה",
      rest: 6,
    });
  });
});
