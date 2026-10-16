import { describe, expect, it } from "vitest";
import {
  allDone,
  decideEntry,
  doneCount,
  emptyFacts,
  firstNotDone,
  firstResumable,
  indexTarget,
  isDone,
  nextPath,
  parseStep,
  previousPath,
  settingsEntryVisible,
  skipAllPatch,
  skipPatch,
  withPatch,
  type SetupFacts,
} from "./model";
import { emptySetupStore, type SetupStore } from "./storage";

const at = "2026-10-16T00:00:00.000Z";

function facts(patch: Partial<SetupFacts> = {}): SetupFacts {
  return { ...emptyFacts(true), companyId: "company-1", ...patch };
}

function started(patch: Partial<SetupStore> = {}): SetupStore {
  return { ...emptySetupStore(), run_started_at: at, flow_at: at, ...patch };
}

describe("setup step model (FLOW-514)", () => {
  it("parses the seven steps and the two full screens, and rejects the rest", () => {
    expect(parseStep("1")).toBe(1);
    expect(parseStep("7")).toBe(7);
    expect(parseStep("welcome")).toBe("welcome");
    expect(parseStep("done")).toBe("done");
    expect(parseStep("0")).toBeNull();
    expect(parseStep("8")).toBeNull();
    expect(parseStep(undefined)).toBeNull();
  });

  it("walks forward to done after step 7 and back to null before step 1", () => {
    expect(nextPath(1)).toBe("/setup/2");
    expect(nextPath(7)).toBe("/setup/done");
    expect(previousPath(1)).toBeNull();
    expect(previousPath(4)).toBe("/setup/3");
  });

  it("applies the done rules of each step", () => {
    const store = emptySetupStore();
    expect(isDone(1, store, facts({ companyId: null }))).toBe(false);
    expect(isDone(1, store, facts())).toBe(true);
    expect(isDone(2, store, facts({ mercuryConnected: true }))).toBe(true);
    expect(isDone(3, store, facts({ projectCount: 2 }))).toBe(true);
    expect(isDone(3, { ...store, projects_at: at }, facts())).toBe(true);
    expect(isDone(4, store, facts({ loanCount: 1 }))).toBe(true);
    expect(isDone(5, store, facts({ jevSaved: true }))).toBe(true);
    expect(isDone(6, store, facts({ hasResolvedReview: true }))).toBe(true);
    expect(isDone(7, store, facts({ standalone: true }))).toBe(true);
  });

  it("counts done steps and finds the first one not done, skipped or not", () => {
    const store = emptySetupStore();
    expect(doneCount(store, facts())).toBe(1);
    expect(firstNotDone(store, facts())).toBe(2);
    expect(allDone(store, facts({ mercuryConnected: true, projectCount: 1, loanCount: 1, jevSaved: true, hasResolvedReview: true, standalone: true }))).toBe(true);
  });

  it("resumes at the first step that is neither done nor skipped", () => {
    const skipped = skipPatch(emptySetupStore(), 2, at);
    expect(firstResumable(skipped, facts())).toBe(3);
    expect(firstNotDone(skipped, facts())).toBe(2);
  });

  it("sends a user with no company to the welcome screen, and never resumes them", () => {
    const decision = decideEntry(started(), facts({ companyId: null }), false, at);
    expect(decision).toEqual({ kind: "redirect", to: "/setup/welcome", patch: null, markSession: false });
  });

  it("waits until the facts are ready", () => {
    expect(decideEntry(started(), emptyFacts(false), false, at)).toEqual({ kind: "wait" });
  });

  it("resumes a flow run once, to the first resumable step, and stamps the resume", () => {
    const decision = decideEntry(started(), facts(), false, at);
    expect(decision).toEqual({ kind: "redirect", to: "/setup/2", patch: { run_resumed_at: at }, markSession: true });
  });

  it("does not resume a run that was already resumed, entered this session, finished or skipped all", () => {
    expect(decideEntry(started({ run_resumed_at: at }), facts(), false, at).kind).toBe("stay");
    expect(decideEntry(started(), facts(), true, at).kind).toBe("stay");
    expect(decideEntry(started({ finished_at: at }), facts(), false, at).kind).toBe("stay");
    expect(decideEntry(started({ skipped_all_at: at }), facts(), false, at).kind).toBe("stay");
  });

  it("gives an older run (no flow_at) only the Settings entry, with no auto resume (FLOW-514 Q5)", () => {
    const older: SetupStore = { ...emptySetupStore(), run_started_at: at };
    expect(decideEntry(older, facts(), false, at).kind).toBe("stay");
    expect(settingsEntryVisible(older, facts())).toBe(true);
  });

  it("index target: welcome without a company, the first step not done, then done or Home", () => {
    expect(indexTarget(emptySetupStore(), facts({ companyId: null }))).toBe("/setup/welcome");
    expect(indexTarget(emptySetupStore(), facts())).toBe("/setup/2");
    expect(indexTarget(emptySetupStore(), facts({ mercuryConnected: true, projectCount: 1, loanCount: 1, jevSaved: true, hasResolvedReview: true, standalone: true }))).toBe("/setup/done");
    expect(indexTarget(started({ skipped_all_at: at }), facts())).toBe("/");
  });

  it("skip all skips every step not done, stamps the run, and keeps earlier skips", () => {
    const earlier = skipPatch(emptySetupStore(), 3, "2026-10-01T00:00:00.000Z");
    const next = skipAllPatch(earlier, facts({ mercuryConnected: true }), at);
    expect(next.skipped["3"]).toBe("2026-10-01T00:00:00.000Z");
    expect(next.skipped["2"]).toBeUndefined();
    expect(next.skipped["4"]).toBe(at);
    expect(next.skipped["7"]).toBe(at);
    expect(next.skipped_all_at).toBe(at);
    expect(next.run_started_at).toBe(at);
    expect(next.flow_at).toBe(at);
  });

  it("settings entry is visible while the flow is open, and hidden when finished or without a run", () => {
    expect(settingsEntryVisible(started(), facts())).toBe(true);
    expect(settingsEntryVisible(started({ finished_at: at }), facts())).toBe(false);
    expect(settingsEntryVisible(emptySetupStore(), facts())).toBe(false);
  });

  it("withPatch keeps the stored skips unless the patch brings its own", () => {
    const base = skipPatch(emptySetupStore(), 1, at);
    expect(withPatch(base, { finished_at: at }).skipped["1"]).toBe(at);
    expect(withPatch(base, null)).toBe(base);
  });
});
