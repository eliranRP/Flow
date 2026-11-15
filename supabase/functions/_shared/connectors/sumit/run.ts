import { listWindow, planRun, type RunPlan, SUMIT_PAGE_CAP } from "./pull.ts";
import { hasPullKey, readPull } from "./pull_state.ts";

export type StorePlan = Extract<RunPlan, { kind: "store" }>;

/** What the database said to a write: `missing` is "no such function", the database before the FLOW-1163 migration. */
export type WriteResult = { saved: true; reads: number } | { saved: false; reason: "missing"; reads: number };

export interface PullRunInput {
  /** The connection's `settings` (a missing row reads as `{}`). */
  settings: Record<string, unknown>;
  sumitCompanyId: number;
  companyRateBp: number;
  now: string;
  fetchPage: (start: number) => Promise<Record<string, unknown>>;
  /** Stores the plan's batch (and, for `window`, the continuation with it, in one transaction). */
  write: (plan: StorePlan) => Promise<WriteResult>;
  cap?: number;
  invoicesCap?: number;
}

export interface PullRunResult {
  documents: number;
  /** SUMIT reads: the pages, and whatever the write read. */
  reads: number;
  /** The window ended in this run: the caller stamps the sync. */
  finished: boolean;
  /** This run was the third in a row that left the continuation where it was: the caller ends in sync_page_cap. */
  stuck: boolean;
  plan: StorePlan;
}

/**
 * One run of the pull (FLOW-1163): list from where the last run stopped, plan, write. The rules that
 * keep the owner's lines safe live in planRun; this orders the steps:
 * - nothing is written before every page of the run was listed, so a run killed while listing leaves
 *   the stored state as it was and the next run continues from the same continuation;
 * - a partial run's documents and its continuation are one write, so a continuation never points past
 *   documents that were not stored;
 * - on a database without the window function a run that would need it fails with `sync_page_cap`, as
 *   every run did before, and writes nothing.
 */
export async function pullRun(input: PullRunInput): Promise<PullRunResult> {
  const pull = readPull(input.settings, input.sumitCompanyId);
  const list = await listWindow(input.fetchPage, pull == null ? null : { start: pull.start, anchor: pull.anchor }, input.cap ?? SUMIT_PAGE_CAP);
  const plan = planRun({
    pull,
    hasPullKey: hasPullKey(input.settings),
    list,
    companyRateBp: input.companyRateBp,
    sumitCompanyId: input.sumitCompanyId,
    now: input.now,
    invoicesCap: input.invoicesCap,
  });
  if (plan.kind === "fail") throw new Error(plan.code);
  const written = await input.write(plan);
  if (!written.saved) throw new Error("sync_page_cap");
  return {
    documents: plan.batch.length,
    reads: list.reads + written.reads,
    finished: plan.event === "finished",
    stuck: plan.after === "stuck",
    plan,
  };
}
