import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type TransactionDetail } from "@flow/shared";
import { useMemo, useSyncExternalStore } from "react";
import { useParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { getSupabase } from "../lib/supabase";
import { draftFromRead, parseLineSplit, parsePreview, readLineDraft, shareOfLine, type LineSplitRead, type PartDraft, type RestDraft } from "../line-split";
import { LINE_HAS_CATEGORY_SPLIT, LINE_SPLIT_PARTS_CHANGED, lineSplitCopy, lineSplitPartsLabel, type LineSplitRefusal } from "../line-split-copy";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { isReversal, type KindedCategory } from "../reversal";
import { useCategoriesQuery, useDashboardQuery, useTransactionQuery } from "../use-books";
import { useWriteGate } from "../use-is-viewer";
import { assertNoError } from "../use-write";
import { waitForAccessToken } from "../wait-for-session";
import { type ChangeChoice } from "../ui/change-sheet";
import { SplitIcon, TagIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ScreenState } from "../ui/screen-state";
import { ReversalTag } from "../ui/suggest-tag";
import { Amount, type LineInfo, type LineSplitApi, money, partProjectLabel, Percent } from "./line-split-parts";
import { LineSplitEditor } from "./line-split-editor";

// Moved to their own files (FLOW-807). Import from those files in new code.
export { LINE_SPLIT_KEYS, LINE_SPLIT_MAX_PARTS, type LineInfo, type LineSplitApi } from "./line-split-parts";

export function lineSplitQueryKey(transactionId: string) {
  return ["line-split", transactionId] as const;
}

/** `get_line_split` for one line. A viewer reads it too. No read in preview or sample. */
export function useLineSplitQuery(transactionId: string, enabled = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: lineSplitQueryKey(transactionId),
    enabled: enabled && preview === "off" && transactionId !== "",
    retry: 1,
    queryFn: async (): Promise<LineSplitRead | null> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_line_split", { p_transaction_id: transactionId });
      if (error) throw error;
      return parseLineSplit(data);
    },
  });
}

export function lineInfo(txn: NonNullable<TransactionDetail>, loanSplit = false): LineInfo {
  return {
    id: txn.id,
    amountNet: txn.amount_net,
    direction: txn.direction === "income" ? "income" : "expense",
    currency: txn.currency ?? "ILS",
    categoryId: txn.category_id ?? null,
    categoryName: txn.category_name,
    projectId: txn.project_id ?? null,
    projectName: txn.project_name,
    supplier: txn.supplier_name ?? txn.customer_name ?? txn.description,
    docDate: txn.doc_date,
    reviewBlocked: txn.review_status === "open" && txn.review_reason !== "split_mismatch",
    reviewId: txn.review_status === "open" ? txn.review_id ?? null : null,
    loanSplit,
    inPnl: txn.in_pnl_override === true,
  };
}

export function liveLineSplitApi(transactionId: string): LineSplitApi {
  return {
    preview: async (parts) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const result = await supabase.rpc("save_line_split", { p_transaction_id: transactionId, p_parts: parts, p_preview: true });
      assertNoError(result);
      return parsePreview(result.data);
    },
    save: async (parts) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      // A real save returns parts without percent or rest; the screen re-reads get_line_split.
      assertNoError(await supabase.rpc("save_line_split", { p_transaction_id: transactionId, p_parts: parts }));
    },
  };
}

export { lineSplitPartsLabel };

/** "מפוצל · N חלקים · לא נספר כאן" on the detail's category and project rows (plan Q9). */
export function lineSplitRowHint(read: LineSplitRead | null | undefined): string | undefined {
  if (!read || read.parts.length === 0 || !read.partsMatch) return undefined;
  return `${lineSplitPartsLabel(read.parts.length)} · לא נספר כאן`;
}

/**
 * The detail's "פיצול" section (plan §1): a saved split by category as static rows with a
 * סה״כ row, then the two entry rows. A viewer sees the rows only.
 */
export function LineSplitSection({
  txn,
  split,
  readOnly,
  categories,
  loanSplit = false,
  projectSplitTo,
  onProjectSplit,
  categorySplitTo,
}: {
  txn: NonNullable<TransactionDetail>;
  split: LineSplitRead | null | undefined;
  readOnly: boolean;
  categories: readonly KindedCategory[];
  loanSplit?: boolean;
  /** The project split route. */
  projectSplitTo: string;
  /** The reviewer preview opens its own project split. */
  onProjectSplit?: () => void;
  /** The editor route. Omitted where there is none (the reviewer preview). */
  categorySplitTo?: string;
}) {
  const parts = split?.parts ?? [];
  const currency = split?.currency ?? txn.currency ?? "ILS";
  const lineMinor = absAgorot(txn.amount_net);
  const direction = txn.direction === "income" ? "income" : "expense";
  const reviewBlocked = txn.review_status === "open" && txn.review_reason !== "split_mismatch";
  const zero = txn.amount_net === 0n;
  const total = parts.reduce((sum, part) => sum + part.amount_minor, 0n);
  if (readOnly && parts.length === 0) return null;
  const blockedHint = loanSplit
    ? lineSplitCopy("line has a loan split")
    : reviewBlocked ? lineSplitCopy("line has an open review") : undefined;
  return (
    <>
      <div className="ui-section-head">
        <h2 className="t-title-3">פיצול</h2>
      </div>
      {parts.length > 0 ? (
        <>
          {split?.partsMatch === false ? <p className="ui-page-pad t-hint ui-lsplit-caution">{LINE_SPLIT_PARTS_CHANGED}</p> : null}
          <List className="ui-lsplit-read">
            {parts.map((part, index) => {
              const reversal = part.category_id !== txn.category_id && isReversal(categories, part.category_id, direction);
              const share = part.percent ?? shareOfLine(part.amount_minor, split?.lineMinor ?? lineMinor);
              const title = part.rest ? `השאר · ${part.category_name ?? ""}` : (part.category_name ?? "קטגוריה");
              const meta = (
                <span className="ui-lsplit-read-end">
                  <Amount minor={part.amount_minor} currency={currency} className="t-amount" />
                  <span className="t-hint"><Percent value={share} /></span>
                </span>
              );
              const hint = part.rest && part.project_id == null ? (txn.project_name ?? "בלי פרויקט") : partProjectLabel(part.project_name, txn.project_name);
              const tag = reversal ? <ReversalTag /> : undefined;
              const key = `${part.category_id}-${part.project_id ?? ""}-${String(index)}`;
              return readOnly || reviewBlocked || loanSplit || categorySplitTo == null ? (
                <ListRow key={key} variant="static" icon={<TagIcon />} title={title} tag={tag} hint={hint} meta={meta} />
              ) : (
                <ListRow key={key} variant="item" href={categorySplitTo} icon={<TagIcon />} title={title} tag={tag} hint={hint} meta={meta} label={`${title}${reversal ? ", החזר" : ""}, ${hint}, ${money(part.amount_minor, currency)}, עריכת הפיצול`} />
              );
            })}
            <ListRow
              variant="static"
              className="ui-loan-total"
              icon={<span className="ui-loan-spacer" aria-hidden="true" />}
              title="סה״כ"
              meta={<Amount minor={total} currency={currency} className="t-amount" />}
            />
          </List>
        </>
      ) : null}
      {readOnly ? null : (
        <List>
          {parts.length > 0 ? (
            // The two kinds exclude each other (plan §1): the row stays, off, with the reason.
            <ListRow
              variant="button"
              ariaDisabled
              icon={<SplitIcon />}
              title="בין פרויקטים"
              label="פיצול בין פרויקטים"
              hint={LINE_HAS_CATEGORY_SPLIT}
              wrapHint
              describeHint
            />
          ) : onProjectSplit ? (
            <ListRow variant="button" icon={<SplitIcon />} title="בין פרויקטים" label="פיצול בין פרויקטים" chevron onClick={onProjectSplit} />
          ) : (
            <ListRow variant="item" href={projectSplitTo} icon={<SplitIcon />} title="בין פרויקטים" label="פיצול בין פרויקטים" chevron />
          )}
          {zero || parts.length > 0 || categorySplitTo == null ? null : blockedHint ? (
            <ListRow
              variant="button"
              ariaDisabled
              icon={<TagIcon />}
              title="לפי קטגוריות"
              label="פיצול לפי קטגוריות"
              hint={blockedHint}
              wrapHint
              describeHint
            />
          ) : (
            <ListRow variant="item" href={categorySplitTo} icon={<TagIcon />} title="לפי קטגוריות" label="פיצול לפי קטגוריות" chevron />
          )}
        </List>
      )}
    </>
  );
}

/** Reads the loan split cache the detail already fills, so the entry row can say why it is off. */
export function useLoanSplitFlag(transactionId: string): boolean {
  // Watches the loan panel's cached read without adding an observer that could fetch it.
  const client = useQueryClient();
  const count = useSyncExternalStore(
    (onChange) => client.getQueryCache().subscribe(onChange),
    () => client.getQueryData<{ splits?: unknown[] }>(["loan-split", transactionId])?.splits?.length ?? 0,
  );
  return count > 0;
}

export type LineSplitSample = {
  line: LineInfo;
  categories: KindedCategory[];
  projects: ChangeChoice[];
  split?: LineSplitRead | null;
  /** Rows to open on, in place of the saved split. Stories set the state here, not in a play. */
  parts?: PartDraft[];
  rest?: RestDraft;
  /** The saving story: fields, links and ✕ stay disabled. */
  saving?: boolean;
  /** A reason the server already gave, as after a refused save. */
  serverError?: LineSplitRefusal;
  /** The hold line is already showing, as after a first ✕. */
  warned?: boolean;
  api?: LineSplitApi;
};

/** `/transactions/:id/split-category`: the full-screen parts editor (plan option A). */
export function LineSplitScreen({ sample, backTo }: { sample?: LineSplitSample; backTo?: string } = {}) {
  const { transactionId = "" } = useParams();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const live = sample == null;
  const writeGate = useWriteGate(`/transactions/${transactionId}`);
  const txn = useTransactionQuery(live ? transactionId : "");
  const categories = useCategoriesQuery(live);
  const dashboard = useDashboardQuery(live);
  const split = useLineSplitQuery(transactionId, live);
  const loan = useQuery({
    queryKey: ["line-split-loan", transactionId],
    enabled: live && preview === "off" && transactionId !== "",
    retry: 1,
    queryFn: async (): Promise<boolean> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { count, error } = await supabase.from("loan_splits").select("id", { count: "exact", head: true }).eq("transaction_id", transactionId);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
  const api = useMemo(() => sample?.api ?? liveLineSplitApi(transactionId), [sample?.api, transactionId]);
  const fallback = backTo ?? `/transactions/${transactionId}${search}`;
  if (live) {
    if (writeGate === "wait") return null;
    if (writeGate !== "show") return writeGate;
  }
  if (sample) {
    return (
      <LineSplitEditor
        line={sample.line}
        categories={sample.categories}
        projects={sample.projects}
        split={sample.split ?? null}
        initial={sample.parts != null || sample.rest != null
          ? { parts: sample.parts ?? [], rest: sample.rest ?? { categoryId: null, projectId: null } }
          : draftFromRead(sample.split, sample.line.categoryId)}
        api={api}
        draftId=""
        fallback={fallback}
        sampleSaving={sample.saving === true}
        initialError={sample.serverError}
        initialWarned={sample.warned === true}
      />
    );
  }
  const queries = [txn, categories, dashboard, split];
  const phases = [...queries.map((query) => screenPhase(preview, query)), loan.isPending ? ({ kind: "loading" } as const) : ({ kind: "ready" } as const)];
  const phase: ScreenPhase = phases.find((item) => item.kind === "error")
    ?? phases.find((item) => item.kind !== "ready")
    ?? (txn.data ? { kind: "ready" } : { kind: "empty" });
  if (phase.kind !== "ready" || !txn.data) {
    return (
      <ScreenState
        title="פיצול לפי קטגוריות"
        backTo={fallback}
        phase={phase.kind === "ready" ? { kind: "empty" } : phase}
        onRetry={() => { for (const query of queries) void query.refetch(); }}
        empty={<p className="ui-page-pad t-hint">אין תנועה להצגה.</p>}
      />
    );
  }
  const line = lineInfo(txn.data, loan.data === true);
  const projects: ChangeChoice[] = (dashboard.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name, status: project.status }));
  const initial = readLineDraft(transactionId) ?? draftFromRead(split.data, line.categoryId);
  return (
    <LineSplitEditor
      key={transactionId}
      line={line}
      categories={categories.data ?? []}
      projects={projects}
      split={split.data ?? null}
      initial={initial}
      api={api}
      draftId={transactionId}
      fallback={fallback}
    />
  );
}
