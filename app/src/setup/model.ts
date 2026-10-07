import { SETUP_TOTAL } from "./copy";
import type { SetupStore } from "./storage";
import { emptySetupStore } from "./storage";

/** Steps 1–5 are counted. Step 0 is the company pre-step. Notifications stay outside this five. */
export const COUNTED_STEPS = [1, 2, 3, 4, 5] as const;

export type CountedStep = (typeof COUNTED_STEPS)[number];
export type SetupStepId = 0 | CountedStep;

export type SetupFacts = {
  ready: boolean;
  companyId: string | null;
  sumitConnected: boolean;
  /** A Jev row exists, on or off. A missing row is not saved. */
  jevSaved: boolean;
  hasResolvedReview: boolean;
  standalone: boolean;
};

export function emptyFacts(ready = false): SetupFacts {
  return {
    ready,
    companyId: null,
    sumitConnected: false,
    jevSaved: false,
    hasResolvedReview: false,
    standalone: false,
  };
}

export function parseStep(value: string | undefined): SetupStepId | null {
  if (value == null || !/^[0-5]$/.test(value)) return null;
  return Number(value) as SetupStepId;
}

export function isCounted(step: SetupStepId): step is CountedStep {
  return step >= 1 && step <= 5;
}

function skipKey(step: CountedStep): "1" | "2" | "3" | "4" | "5" {
  return String(step) as "1" | "2" | "3" | "4" | "5";
}

export function isSkipped(store: SetupStore, step: CountedStep): boolean {
  return store.skipped[skipKey(step)] != null;
}

export function isDone(step: CountedStep, store: SetupStore, facts: SetupFacts): boolean {
  if (step === 1) return facts.sumitConnected;
  if (step === 2) return facts.jevSaved;
  if (step === 3) return store.confirmed_lists_at != null;
  if (step === 4) return facts.hasResolvedReview || store.sample_review_at != null;
  return store.installed_at != null || store.ios_steps_seen_at != null || facts.standalone;
}

export function doneCount(store: SetupStore, facts: SetupFacts): number {
  return COUNTED_STEPS.filter((step) => isDone(step, store, facts)).length;
}

export function allDone(store: SetupStore, facts: SetupFacts): boolean {
  return doneCount(store, facts) === SETUP_TOTAL;
}

/** Skipped and pending, in order. A done step is gone. */
export function remainingSteps(store: SetupStore, facts: SetupFacts): CountedStep[] {
  return COUNTED_STEPS.filter((step) => !isDone(step, store, facts));
}

/** es-01 already offers חיבור SUMIT, so the card drops that row whenever Home is empty. */
export function cardRows(store: SetupStore, facts: SetupFacts, emptyHome: boolean): CountedStep[] {
  const rows = remainingSteps(store, facts);
  if (emptyHome) return rows.filter((step) => step !== 1);
  return rows;
}

/** First not-done counted step, including a skipped one. */
export function firstNotDone(store: SetupStore, facts: SetupFacts): CountedStep | null {
  return remainingSteps(store, facts)[0] ?? null;
}

/** The one automatic resume skips steps the user already skipped. */
export function firstResumable(store: SetupStore, facts: SetupFacts): CountedStep | null {
  return COUNTED_STEPS.find((step) => !isDone(step, store, facts) && !isSkipped(store, step)) ?? null;
}

export type EntryDecision =
  | { kind: "wait" }
  | { kind: "stay" }
  | { kind: "redirect"; to: string; patch: Partial<SetupStore> | null; markSession: boolean };

/**
 * No company always opens step 0, and that does not consume the one resume.
 * A company with every counted step already done does not start a run.
 * Otherwise the first visit opens the first not-done step. The next visit resumes once,
 * unless the user closed the Home card: that opts out of setup, resume included.
 */
export function decideEntry(store: SetupStore, facts: SetupFacts, sessionAlreadyEntered: boolean, at: string): EntryDecision {
  if (!facts.ready) return { kind: "wait" };
  if (facts.companyId == null) return { kind: "redirect", to: "/setup/0", patch: null, markSession: false };
  if (store.run_started_at == null) {
    if (allDone(store, facts)) return { kind: "stay" };
    const step = firstNotDone(store, facts);
    if (step == null) return { kind: "stay" };
    return {
      kind: "redirect",
      to: `/setup/${String(step)}`,
      patch: { run_started_at: at },
      markSession: true,
    };
  }
  if (store.card_dismissed_at != null) return { kind: "stay" };
  if (store.run_resumed_at != null || sessionAlreadyEntered) return { kind: "stay" };
  const step = firstResumable(store, facts);
  if (step == null) return { kind: "stay" };
  return {
    kind: "redirect",
    to: `/setup/${String(step)}`,
    patch: { run_resumed_at: at },
    markSession: true,
  };
}

/** When the run has started and nothing is left to resume, still record the one attempt. */
export function resumeStamp(store: SetupStore, facts: SetupFacts, sessionAlreadyEntered: boolean, at: string): Partial<SetupStore> | null {
  if (!facts.ready || facts.companyId == null || store.run_started_at == null) return null;
  if (store.run_resumed_at != null || sessionAlreadyEntered) return null;
  if (firstResumable(store, facts) != null) return null;
  return { run_resumed_at: at };
}

export function indexTarget(store: SetupStore, facts: SetupFacts): string {
  if (facts.companyId == null) return "/setup/0";
  if (allDone(store, facts)) return "/";
  const step = firstNotDone(store, facts);
  return step == null ? "/" : `/setup/${String(step)}`;
}

export function backPath(step: SetupStepId, fromCard: boolean, companyCreated: boolean): string | null {
  if (fromCard) return "/";
  if (step === 0) return null;
  if (step === 1) return companyCreated ? "/setup/0" : null;
  return `/setup/${String(step - 1)}`;
}

export function continuePath(step: SetupStepId, fromCard: boolean): string {
  if (fromCard || step >= 5) return "/";
  if (step === 0) return "/setup/1";
  return `/setup/${String(step + 1)}`;
}

export function skipPatch(store: SetupStore, step: CountedStep, at: string): SetupStore {
  if (isSkipped(store, step)) return store;
  return { ...store, skipped: { ...store.skipped, [skipKey(step)]: at } };
}

export function confirmLists(store: SetupStore, at: string): SetupStore {
  const skipped = { ...store.skipped };
  delete skipped["3"];
  return { ...store, confirmed_lists_at: store.confirmed_lists_at ?? at, skipped };
}

export function approveSample(store: SetupStore, at: string): SetupStore {
  const skipped = { ...store.skipped };
  delete skipped["4"];
  return { ...store, sample_review_at: store.sample_review_at ?? at, skipped };
}

export function finishIos(store: SetupStore, at: string): SetupStore {
  const skipped = { ...store.skipped };
  delete skipped["5"];
  return { ...store, ios_steps_seen_at: store.ios_steps_seen_at ?? at, skipped };
}

export function finishInstall(store: SetupStore, at: string): SetupStore {
  const skipped = { ...store.skipped };
  delete skipped["5"];
  return { ...store, installed_at: store.installed_at ?? at, skipped };
}

export function shouldShowCompletedToast(store: SetupStore, facts: SetupFacts): boolean {
  return facts.ready && store.run_started_at != null && allDone(store, facts) && store.completed_toast_at == null;
}

export function cardVisible(store: SetupStore, facts: SetupFacts, viewer: boolean): boolean {
  if (!facts.ready || viewer) return false;
  if (store.run_started_at == null || store.card_dismissed_at != null) return false;
  return !allDone(store, facts);
}

export function settingsEntryVisible(store: SetupStore, facts: SetupFacts): boolean {
  if (!facts.ready || store.run_started_at == null) return false;
  return !allDone(store, facts);
}

export function withPatch(store: SetupStore, patch: Partial<SetupStore> | null): SetupStore {
  if (!patch) return store;
  return { ...emptySetupStore(), ...store, ...patch, skipped: patch.skipped ?? store.skipped };
}
