import { defineMachine } from "@flow/shared";
import type { SetupStore } from "./storage";
import { emptySetupStore } from "./storage";

/** The number of setup steps. It lives here, not in copy.ts, so Home's first load doesn't carry the setup screens' copy (FLOW-1109). */
export const SETUP_TOTAL = 7;

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
  /** The Jev row is on (enabled and not mode off). create_company stores it on (decision 0204). */
  jevOn: boolean;
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
    jevOn: false,
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
 * The run, one table (decision 0266, FLOW-1161). Its state is read from the store's stamps
 * (`runState`), and a patch's run stamp is a move: a move the state does not allow keeps the
 * stored stamp (`withPatch`). `start` is step 1's company, `resume` the one automatic resume,
 * `skipAll` the skip sheet, `finish` the done screen's Home.
 */
export const setupRun = defineMachine({
  name: "setupRun",
  initial: "fresh",
  final: ["finished"],
  states: {
    fresh: { start: "started", skipAll: "skippedAll", finish: "finished" },
    started: { resume: "resumed", skipAll: "skippedAll", finish: "finished" },
    resumed: { skipAll: "skippedAll", finish: "finished" },
    skippedAll: { finish: "finished" },
    finished: {},
  },
});

export type SetupRunState = keyof typeof setupRun.states;
type SetupRunEvent = Parameters<typeof setupRun.next>[1];

/** Each move's stamp, in the table's order. */
const RUN_STAMPS = [
  ["start", "run_started_at"],
  ["resume", "run_resumed_at"],
  ["skipAll", "skipped_all_at"],
  ["finish", "finished_at"],
] as const satisfies readonly (readonly [SetupRunEvent, keyof SetupStore])[];

/** The furthest stamp the run carries. */
export function runState(store: SetupStore): SetupRunState {
  if (store.finished_at != null) return "finished";
  if (store.skipped_all_at != null) return "skippedAll";
  if (store.run_resumed_at != null) return "resumed";
  return store.run_started_at != null ? "started" : "fresh";
}

/**
 * One step, one table. `done` comes from the done rules (a stamp or a fact) and wins over a stored
 * skip, so a step reads as one state only. A skip is written only from `open`; a done step whose
 * fact goes away (a bank disconnected) is `lost`.
 */
export const setupStep = defineMachine({
  name: "setupStep",
  initial: "open",
  states: {
    open: { skip: "skipped", finish: "done" },
    skipped: { finish: "done" },
    done: { lost: "open" },
  },
});

export type SetupStepState = keyof typeof setupStep.states;

export function stepStatus(step: StepNumber, store: SetupStore, facts: SetupFacts): SetupStepState {
  if (isDone(step, store, facts)) return "done";
  return isSkipped(store, step) ? "skipped" : "open";
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

/** The steps not done yet, out of SETUP_TOTAL (Settings' "N להשלמה"). */
export function stepsLeft(done: number): number {
  return Math.max(0, SETUP_TOTAL - done);
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
  return STEP_NUMBERS.find((step) => stepStatus(step, store, facts) === "open") ?? null;
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
  if (!runMayResume(store, sessionAlreadyEntered)) return { kind: "stay" };
  const step = firstResumable(store, facts);
  if (step == null) return { kind: "stay" };
  return { kind: "redirect", to: stepPath(step), patch: { run_resumed_at: at }, markSession: true };
}

/** A run that started and has not finished, skipped everything or resumed already: only it needs the step facts. */
export function runMayResume(store: SetupStore, sessionAlreadyEntered: boolean): boolean {
  return store.flow_at != null && setupRun.can(runState(store), "resume") && !sessionAlreadyEntered;
}

/** The index (/setup) opens where the owner left off: the first step not done, skipped ones included. */
export function indexTarget(store: SetupStore, facts: SetupFacts): string {
  if (facts.companyId == null) return "/setup/welcome";
  const run = runState(store);
  if (run === "finished" || run === "skippedAll") return "/";
  const step = firstNotDone(store, facts);
  return step == null ? "/setup/done" : stepPath(step);
}

/** Settings' הגדרה ראשונה after skip all: the first step not done, skipped ones included (FLOW-1161). Home once every step is done. */
export function settingsEntryTarget(store: SetupStore, facts: SetupFacts): string {
  const step = firstNotDone(store, facts);
  return step == null ? "/" : stepPath(step);
}

/** The next screen after a step: the next step, or done after step 7. */
export function nextPath(step: StepNumber): string {
  return step === 7 ? "/setup/done" : stepPath((step + 1) as StepNumber);
}

export function previousPath(step: StepNumber): string | null {
  return step === 1 ? null : stepPath((step - 1) as StepNumber);
}

/** דילוג on a step: stamped only on an open step (a done or skipped one stays as it is). */
export function skipPatch(store: SetupStore, facts: SetupFacts, step: StepNumber, at: string): SetupStore {
  if (!setupStep.can(stepStatus(step, store, facts), "skip")) return store;
  return { ...store, skipped: { ...store.skipped, [skipKey(step)]: at } };
}

/**
 * Skip all (the sheet, from any step): every step not done is skipped, the stamp is set, and the
 * run has started (the business is created as "העסק שלי" by the caller when there is none).
 */
export function skipAllPatch(store: SetupStore, facts: SetupFacts, at: string): SetupStore {
  if (!setupRun.can(runState(store), "skipAll")) return store;
  const skipped = { ...store.skipped };
  for (const step of STEP_NUMBERS) {
    if (setupStep.can(stepStatus(step, store, facts), "skip")) skipped[skipKey(step)] = at;
  }
  return {
    ...store,
    run_started_at: store.run_started_at ?? at,
    flow_at: store.flow_at ?? at,
    skipped,
    skipped_all_at: at,
  };
}

/** Settings › הגדרה ראשונה: visible once a run started, until every step is done. */
export function settingsEntryVisible(store: SetupStore, facts: SetupFacts): boolean {
  if (!facts.ready || store.run_started_at == null) return false;
  if (runState(store) === "finished") return false;
  return !allDone(store, facts);
}

/**
 * The patch over the store. Its run stamps go through `setupRun` in order: a move the run's state
 * refuses (a second start, a resume after skip all, a second finish) keeps the stored stamp.
 */
export function withPatch(store: SetupStore, patch: Partial<SetupStore> | null): SetupStore {
  if (!patch) return store;
  const next = { ...emptySetupStore(), ...store, ...patch, skipped: patch.skipped ?? store.skipped };
  let state = runState(store);
  for (const [event, key] of RUN_STAMPS) {
    if (patch[key] == null) continue;
    if (setupRun.can(state, event)) {
      state = setupRun.next(state, event);
      continue;
    }
    next[key] = store[key];
    // A refused start keeps a stored `flow_at`, but a run from before FLOW-514 (started, no
    // `flow_at`) still takes it, as before the table: that is how such a run upgrades.
    if (event === "start" && store.flow_at != null) next.flow_at = store.flow_at;
  }
  return next;
}

/** Step 6's approve (the sample card): done, its skip gone. On a step already done it changes nothing. */
export function approveSample(store: SetupStore, at: string): SetupStore {
  const status: SetupStepState = store.sample_review_at != null ? "done" : isSkipped(store, 6) ? "skipped" : "open";
  if (!setupStep.can(status, "finish")) return store;
  const skipped = { ...store.skipped };
  delete skipped["6"];
  return { ...store, sample_review_at: at, skipped };
}

/* -- Legacy: the completed toast stays gated off until #622 removes the Home slot. */

export function shouldShowCompletedToast(_store: SetupStore, _facts: SetupFacts): boolean {
  return false;
}
