import { SETUP_TOTAL } from "./copy";
import type { SetupStore } from "./storage";
import { emptySetupStore } from "./storage";

/** FLOW-514: the seven steps, in order. Welcome and done are not steps. */
export const STEP_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;

export type StepNumber = (typeof STEP_NUMBERS)[number];
export type SetupStepId = "welcome" | StepNumber | "done";

export type SetupFacts = {
  ready: boolean;
  companyId: string | null;
  sumitConnected: boolean;
  mercuryConnected: boolean;
  /** A Jev row exists, on or off. */
  jevSaved: boolean;
  hasResolvedReview: boolean;
  standalone: boolean;
  /** Projects and loans the company already has in the books (step 3 and 4 done rules). */
  projectCount: number;
  loanCount: number;
};

export function emptyFacts(ready = false): SetupFacts {
  return {
    ready,
    companyId: null,
    sumitConnected: false,
    mercuryConnected: false,
    jevSaved: false,
    hasResolvedReview: false,
    standalone: false,
    projectCount: 0,
    loanCount: 0,
  };
}

/** Route segment to step id. "1".."7" are steps; "welcome" and "done" are the two full screens. */
export function parseStep(value: string | undefined): SetupStepId | null {
  if (value === "welcome" || value === "done") return value;
  if (value == null || !/^[1-7]$/.test(value)) return null;
  return Number(value) as StepNumber;
}

export function stepPath(step: StepNumber | "done" | "welcome"): string {
  return `/setup/${String(step)}`;
}

function skipKey(step: StepNumber): "1" | "2" | "3" | "4" | "5" | "6" | "7" {
  return String(step) as "1" | "2" | "3" | "4" | "5" | "6" | "7";
}

export function isSkipped(store: SetupStore, step: StepNumber): boolean {
  return store.skipped[skipKey(step)] != null;
}

/**
 * The done rules (FLOW-514): 1 a company exists; 2 Mercury or SUMIT connected; 3 projects_at or a
 * project exists; 4 loans_at or a loan exists; 5 the Jev row is saved; 6 the sample is approved (or a
 * review is resolved); 7 installed, or the app runs standalone.
 */
export function isDone(step: StepNumber, store: SetupStore, facts: SetupFacts): boolean {
  if (step === 1) return facts.companyId != null;
  if (step === 2) return facts.sumitConnected || facts.mercuryConnected;
  if (step === 3) return store.projects_at != null || facts.projectCount > 0;
  if (step === 4) return store.loans_at != null || facts.loanCount > 0;
  if (step === 5) return facts.jevSaved;
  if (step === 6) return store.sample_review_at != null || facts.hasResolvedReview;
  return store.installed_at != null || facts.standalone;
}

export function doneCount(store: SetupStore, facts: SetupFacts): number {
  return STEP_NUMBERS.filter((step) => isDone(step, store, facts)).length;
}

export function allDone(store: SetupStore, facts: SetupFacts): boolean {
  return doneCount(store, facts) === SETUP_TOTAL;
}

/** First step that is not done, skipped or not. */
export function firstNotDone(store: SetupStore, facts: SetupFacts): StepNumber | null {
  return STEP_NUMBERS.find((step) => !isDone(step, store, facts)) ?? null;
}

/** The one automatic resume skips steps the user already skipped. */
export function firstResumable(store: SetupStore, facts: SetupFacts): StepNumber | null {
  return STEP_NUMBERS.find((step) => !isDone(step, store, facts) && !isSkipped(store, step)) ?? null;
}

export type EntryDecision =
  | { kind: "wait" }
  | { kind: "stay" }
  | { kind: "redirect"; to: string; patch: Partial<SetupStore> | null; markSession: boolean };

/**
 * No company: the welcome screen (once per sign-in; a pending invite lands on the invitation first).
 * A run of the seven-step flow that has not finished or skipped everything resumes once, to the first
 * step not done and not skipped. An older run (no flow_at) gets only the Settings entry (FLOW-514 Q5).
 */
export function decideEntry(store: SetupStore, facts: SetupFacts, sessionAlreadyEntered: boolean, at: string): EntryDecision {
  if (!facts.ready) return { kind: "wait" };
  if (facts.companyId == null) return { kind: "redirect", to: "/setup/welcome", patch: null, markSession: false };
  if (store.flow_at == null || store.run_started_at == null) return { kind: "stay" };
  if (store.finished_at != null || store.skipped_all_at != null) return { kind: "stay" };
  if (store.run_resumed_at != null || sessionAlreadyEntered) return { kind: "stay" };
  const step = firstResumable(store, facts);
  if (step == null) return { kind: "stay" };
  return { kind: "redirect", to: stepPath(step), patch: { run_resumed_at: at }, markSession: true };
}

/** The index (/setup) opens where the owner left off: the first step not done, skipped ones included. */
export function indexTarget(store: SetupStore, facts: SetupFacts): string {
  if (facts.companyId == null) return "/setup/welcome";
  if (store.finished_at != null || store.skipped_all_at != null) return "/";
  const step = firstNotDone(store, facts);
  return step == null ? "/setup/done" : stepPath(step);
}

/** The next screen after a step: the next step, or done after step 7. */
export function nextPath(step: StepNumber): string {
  return step === 7 ? "/setup/done" : stepPath((step + 1) as StepNumber);
}

export function previousPath(step: StepNumber): string | null {
  return step === 1 ? null : stepPath((step - 1) as StepNumber);
}

export function skipPatch(store: SetupStore, step: StepNumber, at: string): SetupStore {
  if (isSkipped(store, step)) return store;
  return { ...store, skipped: { ...store.skipped, [skipKey(step)]: at } };
}

/**
 * Skip all (the sheet, from any step): every step not done is skipped, the stamp is set, and the
 * run has started (the business is created as "העסק שלי" by the caller when there is none).
 */
export function skipAllPatch(store: SetupStore, facts: SetupFacts, at: string): SetupStore {
  const skipped = { ...store.skipped };
  for (const step of STEP_NUMBERS) {
    if (!isDone(step, store, facts)) skipped[skipKey(step)] = skipped[skipKey(step)] ?? at;
  }
  return {
    ...store,
    run_started_at: store.run_started_at ?? at,
    flow_at: store.flow_at ?? at,
    skipped,
    skipped_all_at: store.skipped_all_at ?? at,
  };
}

/** Settings › הגדרה ראשונה: visible once a run started, until every step is done. */
export function settingsEntryVisible(store: SetupStore, facts: SetupFacts): boolean {
  if (!facts.ready || store.run_started_at == null) return false;
  if (store.finished_at != null) return false;
  return !allDone(store, facts);
}

export function withPatch(store: SetupStore, patch: Partial<SetupStore> | null): SetupStore {
  if (!patch) return store;
  return { ...emptySetupStore(), ...store, ...patch, skipped: patch.skipped ?? store.skipped };
}

export function approveSample(store: SetupStore, at: string): SetupStore {
  const skipped = { ...store.skipped };
  delete skipped["6"];
  return { ...store, sample_review_at: store.sample_review_at ?? at, skipped };
}

/* -- Legacy: the completed toast stays gated off until #622 removes the Home slot. */

export function shouldShowCompletedToast(_store: SetupStore, _facts: SetupFacts): boolean {
  return false;
}
