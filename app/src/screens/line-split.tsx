import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatAmountText, type TransactionDetail } from "@flow/shared";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { getSupabase } from "../lib/supabase";
import {
  amountOf,
  amountText,
  amountsPayload,
  buildPayload,
  checkParts,
  clearLineDraft,
  draftFromRead,
  newPartKey,
  parseLineSplit,
  percentMinorOf,
  parsePreview,
  percentOf,
  percentText,
  readLineDraft,
  resolvePreview,
  shareOfLine,
  writeLineDraft,
  type LineSplitRead,
  type PartDraft,
  type PayloadPart,
  type RestDraft,
  type ServerPart,
} from "../line-split";
import {
  LINE_HAS_CATEGORY_SPLIT,
  LINE_SPLIT_PARTS_CHANGED,
  LINE_SPLIT_PLACE,
  LINE_SPLIT_SAVE_FAILURE,
  lineSplitCopy,
  lineSplitPartsLabel,
  lineSplitRefusal,
  localIssueCopy,
  type LineSplitRefusal,
} from "../line-split-copy";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { isReversal, reversalChoices, type KindedCategory } from "../reversal";
import { useCategoriesQuery, useDashboardQuery, useInvalidateBooks, useTransactionQuery } from "../use-books";
import { useWriteGate } from "../use-is-viewer";
import { assertNoError } from "../use-write";
import { waitForAccessToken } from "../wait-for-session";
import { useGoBack } from "../ui/back";
import { Banner } from "../ui/banner";
import { BigNumber } from "../ui/big-number";
import { ChangeAssignment, type ChangeChoice } from "../ui/change-sheet";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { formatDisplay } from "../ui/date-math";
import { HoldLine } from "../ui/hold-line";
import { IconButton } from "../ui/icon-button";
import { AlertIcon, CloseIcon, PlusIcon, SplitIcon, TagIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { MoneyField, PercentField } from "../ui/money-field";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { SegmentedControl } from "../ui/segmented-control";
import { ReversalTag } from "../ui/suggest-tag";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";

/** What every split write refreshes: the parts, the line, and every P&L figure. */
export const LINE_SPLIT_KEYS = ["line-split", "txn", "dashboard", "project", "project-category", "home", "breakdown", "breakdown-lines", "review"];

/** 49 parts plus the rest: the server takes 50 (plan §2). */
export const LINE_SPLIT_MAX_PARTS = 49;

const PICK_LINE_PROJECT = "פרויקט השורה";

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

/** The line as the editor needs it. */
export type LineInfo = {
  id: string;
  /** Signed, as stored. */
  amountNet: bigint;
  direction: "income" | "expense";
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  projectId: string | null;
  projectName: string | null;
  supplier: string;
  docDate: string;
  /** An open review other than `split_mismatch` refuses the save (0125). */
  reviewBlocked: boolean;
  /** A loan split refuses a split by category (0104). */
  loanSplit: boolean;
};

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
    loanSplit,
  };
}

/** The server calls the editor makes. Stories and tests pass their own. */
export type LineSplitApi = {
  preview: (parts: PayloadPart[]) => Promise<ServerPart[]>;
  save: (parts: PayloadPart[]) => Promise<void>;
};

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

function money(minor: bigint, currency: string): string {
  return formatAmountText(minor, currency, { detail: true });
}

function Amount({ minor, currency, className }: { minor: bigint; currency: string; className?: string }) {
  return <bdi className={className ? `ui-num ${className}` : "ui-num"} dir="ltr">{money(minor, currency)}</bdi>;
}

function Percent({ value }: { value: number }) {
  return <bdi className="ui-num" dir="ltr">{`${percentText(value)}%`}</bdi>;
}

export { lineSplitPartsLabel };

/** "מפוצל · N חלקים · לא נספר כאן" on the detail's category and project rows (plan Q9). */
export function lineSplitRowHint(read: LineSplitRead | null | undefined): string | undefined {
  if (!read || read.parts.length === 0 || !read.partsMatch) return undefined;
  return `${lineSplitPartsLabel(read.parts.length)} · לא נספר כאן`;
}

function partProjectLabel(projectName: string | null | undefined, lineProject: string | null): string {
  if (projectName) return projectName;
  return lineProject ? `${lineProject} · ${PICK_LINE_PROJECT}` : "בלי פרויקט";
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

type PickTarget = { kind: "new" } | { kind: "part"; key: string } | { kind: "rest" };

type PreviewState = { key: string; parts: ServerPart[] } | { key: string; error: unknown };

function sameDraft(left: { parts: PartDraft[]; rest: RestDraft }, right: { parts: PartDraft[]; rest: RestDraft }): boolean {
  const shape = (draft: { parts: PartDraft[]; rest: RestDraft }) => JSON.stringify({
    parts: draft.parts.map((part) => [part.categoryId, part.projectId, part.unit, part.value.trim()]),
    rest: draft.rest,
  });
  return shape(left) === shape(right);
}

function LineSplitEditor({
  line,
  categories,
  projects: givenProjects,
  split,
  initial,
  api,
  draftId,
  fallback,
  sampleSaving = false,
  initialError,
  initialWarned = false,
}: {
  line: LineInfo;
  categories: readonly KindedCategory[];
  projects: ChangeChoice[];
  split: LineSplitRead | null;
  initial: { parts: PartDraft[]; rest: RestDraft };
  api: LineSplitApi;
  draftId: string;
  fallback: string;
  sampleSaving?: boolean;
  initialError?: LineSplitRefusal;
  initialWarned?: boolean;
}) {
  const toast = useToast();
  const goBack = useGoBack();
  const invalidate = useInvalidateBooks();
  const location = useLocation();
  const search = usePreviewSearch();
  const [parts, setParts] = useState<PartDraft[]>(initial.parts);
  const [rest, setRest] = useState<RestDraft>(initial.rest);
  const [baseline] = useState(() => draftFromRead(split, line.categoryId));
  const [target, setTarget] = useState<PickTarget | null>(null);
  const [pickerStart, setPickerStart] = useState<"category" | "project">("category");
  const [warned, setWarned] = useState(initialWarned);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const [lastEdited, setLastEdited] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [serverError, setServerError] = useState<{ reason: LineSplitRefusal; key: string | null } | null>(
    initialError ? { reason: initialError, key: null } : null,
  );
  const addRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes when the picker closes: the control that opened it. */
  const pickerOpener = useRef<HTMLElement | null>(null);
  /** Set once the screen goes back itself, so its own pop is not held. */
  const leaving = useRef(false);
  const lineMinor = absAgorot(line.amountNet);
  const currency = line.currency;
  const busy = sampleSaving || saving;
  const blocked = line.loanSplit || line.reviewBlocked || line.amountNet === 0n;
  const projects = useMemo(() => [...givenProjects, ...extraProjects.filter((extra) => !givenProjects.some((project) => project.id === extra.id))], [givenProjects, extraProjects]);
  const reversalIds = useMemo(() => new Set(reversalChoices(categories, line.direction, line.categoryId).map((choice) => choice.id)), [categories, line.direction, line.categoryId]);
  const partIsReversal = (categoryId: string) => categoryId !== line.categoryId && (reversalIds.has(categoryId) || isReversal(categories, categoryId, line.direction));
  const ctx = { lineMinor, lineCategoryId: line.categoryId, lineProjectId: line.projectId, isReversal: partIsReversal };
  const check = checkParts(parts, rest, ctx);
  const restNoCategory = rest.categoryId == null && line.categoryId == null;
  const formIssue = check.form;
  const payload = buildPayload(parts, rest);
  const payloadKey = payload ? JSON.stringify(payload) : null;
  const canPreview = payloadKey != null && formIssue == null && !restNoCategory && !blocked;
  const edited = !sameDraft({ parts, rest }, baseline);
  // A split the bank re-sync left unmatched (split_mismatch) is saved again as it stands, so
  // leaving with valid parts writes even with no edit (0125).
  const dirty = edited || (split?.partsMatch === false && payload != null);

  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    if (!canPreview) return;
    let live = true;
    const request = JSON.parse(payloadKey) as PayloadPart[];
    // A short pause, so typing "30" asks once (plan Q2: the server preview, debounced).
    const timer = setTimeout(() => {
      apiRef.current.preview(request).then(
        (result) => { if (live) setPreviewState({ key: payloadKey, parts: result }); },
        (error: unknown) => { if (live) setPreviewState({ key: payloadKey, error }); },
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [canPreview, payloadKey]);

  // Keep what was typed for a reload or a pop (plan §7); an untouched editor keeps nothing.
  useEffect(() => {
    if (draftId === "") return;
    if (edited) writeLineDraft(draftId, { parts, rest });
    else clearLineDraft(draftId);
  }, [draftId, edited, parts, rest]);

  const current = previewState != null && previewState.key === payloadKey ? previewState : null;
  const previewReason = current != null && "error" in current ? lineSplitRefusal(current.error) : null;
  const resolved = current != null && "parts" in current ? resolvePreview(current.parts, parts) : null;
  const shownServer = serverError != null && (serverError.key == null || serverError.key === payloadKey) ? serverError.reason : null;
  const reason: LineSplitRefusal | null = shownServer ?? previewReason;
  const invalid = formIssue != null || restNoCategory || reason != null;
  const pending = canPreview && current == null;

  const restMinor = resolved?.rest ?? check.restMinor;
  const splitMinor = restMinor != null && restMinor >= 0n ? lineMinor - restMinor : null;

  function update(key: string, change: Partial<PartDraft>) {
    setParts((list) => list.map((part) => (part.key === key ? { ...part, ...change } : part)));
    setLastEdited(key);
  }

  function discard() {
    clearLineDraft(draftId);
    leaving.current = true;
    goBack(fallback);
  }

  async function undoTo(previous: PayloadPart[], message: string) {
    try {
      await api.save(previous);
      await invalidate(LINE_SPLIT_KEYS);
      toast.show({ message });
    } catch {
      toast.show({ tone: "bad", message: "לא הצלחנו לבטל." });
    }
  }

  async function write(next: PayloadPart[], kind: "save" | "clear"): Promise<boolean> {
    if (busy) return false;
    setSaving(true);
    try {
      await api.save(next);
    } catch (error) {
      setSaving(false);
      const named = lineSplitRefusal(error);
      if (named != null) {
        setServerError({ reason: named, key: kind === "clear" ? null : payloadKey });
        setWarned(true);
        if (LINE_SPLIT_PLACE[named] === "banner") void invalidate(["line-split", "txn"]);
        return false;
      }
      toast.show({
        tone: "bad",
        message: LINE_SPLIT_SAVE_FAILURE,
        action: "ניסיון חוזר",
        onAction: () => { void write(next, kind); },
      });
      return false;
    }
    setSaving(false);
    clearLineDraft(draftId);
    const previous = amountsPayload(split);
    await invalidate(LINE_SPLIT_KEYS);
    // Parts that no longer sum to the line, or a line the server will not split (a clear on a
    // loan split or an open review), cannot be sent back, so there is no ביטול for them.
    const undoable = split?.partsMatch !== false && !blocked;
    toast.show({
      message: kind === "clear" ? "הפיצול הוסר" : "החלוקה נשמרה",
      ...(undoable ? {
        action: "ביטול",
        onAction: () => { void undoTo(previous, kind === "clear" ? "הפיצול חזר" : "החלוקה הקודמת חזרה"); },
      } : {}),
    });
    leaving.current = true;
    goBack(fallback);
    return true;
  }

  async function leave() {
    if (busy) return;
    if (!dirty) {
      discard();
      return;
    }
    if (invalid || payload == null) {
      if (!warned) {
        setWarned(true);
        return;
      }
      discard();
      return;
    }
    await write(payload, "save");
  }

  // Browser back saves like ✕ (0075): the first pop of an invalid split is held.
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  const here = `${location.pathname}${location.search}${location.hash}`;
  const hereRef = useRef(here);
  hereRef.current = here;
  const gateRef = useRef({ dirty, busy });
  gateRef.current = { dirty, busy };
  useEffect(() => {
    function onPop(event: PopStateEvent) {
      if (leaving.current) return;
      const gate = gateRef.current;
      if (!gate.dirty && !gate.busy) return;
      event.stopImmediatePropagation();
      window.history.pushState(window.history.state, "", hereRef.current);
      void leaveRef.current();
    }
    window.addEventListener("popstate", onPop, true);
    return () => {
      window.removeEventListener("popstate", onPop, true);
    };
  }, []);

  const categoryName = (id: string | null) => (id == null ? line.categoryName : categories.find((category) => category.id === id)?.name ?? null);
  const projectName = (id: string | null) => (id == null ? null : projects.find((project) => project.id === id)?.name ?? null);

  const targetPart = target?.kind === "part" ? parts.find((part) => part.key === target.key) : undefined;
  const pickerCategory = target?.kind === "rest" ? (rest.categoryId ?? line.categoryId ?? "") : (targetPart?.categoryId ?? "");
  const pickerProject = target?.kind === "rest" ? (rest.projectId ?? "") : (targetPart?.projectId ?? "");
  const pickerReversal = target?.kind === "part" && targetPart != null && targetPart.categoryId !== "" && partIsReversal(targetPart.categoryId);
  const ownCategories: ChangeChoice[] = categories
    .filter((category) => category.kind != null && (line.direction === "income" ? category.kind === "income" : category.kind !== "income"))
    .filter((category) => category.hidden !== true || category.id === line.categoryId)
    .map((category) => ({ id: category.id, name: category.name }));
  const reversals: ChangeChoice[] = target?.kind === "rest" ? [] : reversalChoices(categories, line.direction, line.categoryId);

  function openPicker(next: PickTarget, start: "category" | "project", opener: HTMLElement | null) {
    if (busy || blocked) return;
    pickerOpener.current = next.kind === "new" ? addRef.current : opener;
    setPickerStart(start);
    setTarget(next);
  }

  function pickCategory(id: string) {
    if (target?.kind === "new") {
      const key = newPartKey();
      setParts((list) => [...list, { key, categoryId: id, projectId: null, unit: "amount", value: "" }]);
      setLastEdited(key);
      setTarget({ kind: "part", key });
      return;
    }
    if (target?.kind === "rest") {
      setRest((value) => ({ ...value, categoryId: id === line.categoryId ? null : id }));
      return;
    }
    if (target?.kind === "part") update(target.key, { categoryId: id });
  }

  function pickProject(id: string) {
    const projectId = id === "" ? null : id;
    if (target?.kind === "rest") {
      setRest((value) => ({ ...value, projectId }));
      return;
    }
    if (target?.kind === "part") update(target.key, { projectId });
  }

  const holdText: ReactNode = (() => {
    if (reason != null && LINE_SPLIT_PLACE[reason] !== "banner") {
      return lineSplitCopy(reason, { currency, overMinor: check.overMinor, lineMinor });
    }
    if (check.overMinor > 0n) return lineSplitCopy("parts exceed the line", { currency, overMinor: check.overMinor });
    if (restNoCategory) return lineSplitCopy("line has no category for the rest");
    if (formIssue != null) return localIssueCopy(formIssue, { currency, overMinor: check.overMinor });
    return null;
  })();
  const showHold = holdText != null && (warned || (dirty && formIssue !== "incomplete" && formIssue !== "too few parts"));
  const bannerReason = reason != null && LINE_SPLIT_PLACE[reason] === "banner" ? reason
    : line.amountNet === 0n ? "line amount is zero"
      : line.loanSplit ? "line has a loan split"
        : line.reviewBlocked ? "line has an open review" : null;

  const meta = [line.direction === "income" && line.categoryId != null && isReversal(categories, line.categoryId, "income") ? "החזר" : null, line.supplier, line.docDate ? formatDisplay(line.docDate) : ""].filter(Boolean);
  const restCategory = categoryName(rest.categoryId);
  const restProject = rest.projectId == null ? (line.projectName ?? "בלי פרויקט") : (projectName(rest.projectId) ?? "פרויקט");
  const restDuplicate = check.restDuplicate;
  const restReason = reason != null && LINE_SPLIT_PLACE[reason] === "rest" ? reason : restNoCategory ? "line has no category for the rest" : null;
  const restMessage = restReason != null ? lineSplitCopy(restReason) : restDuplicate ? lineSplitCopy("same category and project twice") : null;
  const restMessageId = "lsplit-rest-msg";

  return (
    <>
      <form
        className="ui-split ui-lsplit"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void leave();
        }}
      >
        <ScreenHeader
          layout="stacked"
          title="פיצול לפי קטגוריות"
          leading={<IconButton label="סגירה" disabled={sampleSaving} onClick={() => { void leave(); }}><CloseIcon /></IconButton>}
        />
        <div className="ui-lsplit-head">
          <p className="t-display">
            {line.direction === "income" ? <span className="sr-only">הכנסה </span> : null}
            <BigNumber agorot={lineMinor} presentation="detail" currency={currency} income={line.direction === "income"} size="display" />
          </p>
          {meta.length > 0 ? (
            <p className="t-label ui-lsplit-meta">
              {meta.map((item, index) => (
                <span key={item}>
                  {index > 0 ? " · " : null}
                  {index === meta.length - 1 && line.docDate ? <bdi dir="ltr">{item}</bdi> : item}
                </span>
              ))}
            </p>
          ) : null}
        </div>
        {bannerReason ? (
          <div className="ui-lsplit-banner">
            <Banner
              icon={<AlertIcon />}
              title={lineSplitCopy(bannerReason)}
              hint={bannerReason === "line has an open review" ? <TextLink to={`/review${search}`}>לתור</TextLink> : undefined}
            />
          </div>
        ) : split?.partsMatch === false ? (
          <div className="ui-lsplit-banner">
            <Banner icon={<AlertIcon />} title={LINE_SPLIT_PARTS_CHANGED} />
          </div>
        ) : null}
        <fieldset className="ui-split-body" disabled={busy || blocked}>
          <div className="ui-split-card ui-lsplit-card">
            {parts.map((part, index) => {
              const name = categoryName(part.categoryId) ?? "בחירת קטגוריה";
              const reversal = part.categoryId !== "" && partIsReversal(part.categoryId);
              const issue = check.parts[part.key];
              const needsProject = issue === "a reversal part needs a project";
              const project = part.projectId == null ? (reversal ? "פרויקט · חובה בהחזר" : partProjectLabel(null, line.projectName)) : (projectName(part.projectId) ?? "פרויקט");
              const percent = part.unit === "percent" ? percentOf(part.value) : null;
              const amount = part.unit === "amount" ? amountOf(part.value) : null;
              const cents = resolved?.parts[part.key];
              const fieldError = issue === "percent over" ? localIssueCopy("percent over") : undefined;
              const over = check.overMinor > 0n && (lastEdited === part.key || (lastEdited == null && index === parts.length - 1));
              const messageId = `lsplit-msg-${part.key}`;
              const message = issue === "same category and project twice"
                ? lineSplitCopy(issue)
                : needsProject && warned ? lineSplitCopy("a reversal part needs a project")
                  : over ? lineSplitCopy("parts exceed the line", { currency, overMinor: check.overMinor })
                    : undefined;
              return (
                <div key={part.key} className="ui-lsplit-part" data-invalid={message != null || fieldError != null ? "" : undefined}>
                  <div className="ui-lsplit-text">
                    <button
                      type="button"
                      className="ui-lsplit-pick ui-hit"
                      aria-label={`${name}${reversal ? ", החזר" : ""}, ${project}, שינוי`}
                      aria-describedby={message ? messageId : undefined}
                      onClick={(event) => { openPicker({ kind: "part", key: part.key }, needsProject ? "project" : "category", event.currentTarget); }}
                    >
                      <span className="ui-lsplit-title">
                        {/* The full name is in the button's label. */}
                        <span className="ui-lsplit-name" data-clip-ok="">{name}</span>
                        {reversal ? <ReversalTag /> : null}
                      </span>
                      <span className={needsProject ? "ui-lsplit-project ui-lsplit-project-error" : "ui-lsplit-project"}>{project}</span>
                    </button>
                    <IconButton className="ui-lsplit-remove" label={`הסרת החלק ${name}`} onClick={() => {
                      setParts((list) => list.filter((item) => item.key !== part.key));
                      setLastEdited(null);
                    }}>
                      <CloseIcon size={18} />
                    </IconButton>
                  </div>
                  <div className="ui-lsplit-end">
                    <div className="ui-lsplit-entry">
                      <SegmentedControl
                        label={`יחידה, ${name}`}
                        showLabel={false}
                        radius="input"
                        value={part.unit}
                        options={[{ value: "percent", label: "%" }, { value: "amount", label: "₪" }]}
                        disabled={busy || blocked}
                        onChange={(unit) => {
                          if (unit === part.unit) return;
                          // Keep the same money: the resolved cents become the amount (the percent of
                          // the line, rounded, before a preview), or the share the percent.
                          const value = unit === "amount"
                            ? (cents != null ? amountText(cents) : percent != null ? amountText(percentMinorOf(percent, lineMinor)) : "")
                            : (amount != null ? percentText(shareOfLine(amount, lineMinor)) : "");
                          update(part.key, { unit, value });
                        }}
                      />
                      {part.unit === "percent" ? (
                        <PercentField
                          hideLabel
                          id={`lsplit-pct-${part.key}`}
                          label={`אחוז, ${name}`}
                          value={part.value}
                          decimals={2}
                          disabled={busy || blocked}
                          error={fieldError}
                          describedBy={message ? messageId : undefined}
                          enterKeyHint={index === parts.length - 1 ? "done" : "next"}
                          onValueChange={(value) => { update(part.key, { value }); }}
                        />
                      ) : (
                        <MoneyField
                          hideLabel
                          id={`lsplit-amt-${part.key}`}
                          label={`סכום, ${name}`}
                          prefix={currency === "USD" ? "$" : "₪"}
                          value={part.value}
                          disabled={busy || blocked}
                          describedBy={message ? messageId : undefined}
                          enterKeyHint={index === parts.length - 1 ? "done" : "next"}
                          onValueChange={(value) => { update(part.key, { value }); }}
                        />
                      )}
                    </div>
                    <span className="ui-lsplit-resolved t-label" aria-live="polite">
                      {part.unit === "percent"
                        ? (cents != null ? <Amount minor={cents} currency={currency} /> : percent != null && pending ? "…" : null)
                        : (amount != null ? <Percent value={shareOfLine(amount, lineMinor)} /> : null)}
                    </span>
                  </div>
                  {message ? <p id={messageId} className="ui-lsplit-msg" role="status">{message}</p> : null}
                </div>
              );
            })}
            <button
              type="button"
              className="ui-lsplit-part ui-lsplit-rest ui-hit"
              aria-label={`השאר, ${restCategory ?? "בלי קטגוריה"}, ${restProject}, שינוי`}
              aria-describedby={restMessage != null ? restMessageId : undefined}
              onClick={(event) => { openPicker({ kind: "rest" }, "category", event.currentTarget); }}
            >
              <span className="ui-lsplit-text">
                <span className="ui-lsplit-pick">
                  <span className="ui-lsplit-title"><span className="ui-lsplit-name" data-clip-ok="">{`השאר · ${restCategory ?? "בחירת קטגוריה"}`}</span></span>
                  <span className="ui-lsplit-project">{`${restProject} · נשאר בשורה`}</span>
                </span>
              </span>
              <span className="ui-lsplit-end">
                {restMinor == null ? (
                  <span className="ui-lsplit-amount t-body">{pending ? "…" : <Amount minor={lineMinor} currency={currency} />}</span>
                ) : restMinor < 0n ? (
                  <>
                    <span className="ui-lsplit-amount t-body ui-split-bad"><Amount minor={restMinor} currency={currency} /></span>
                    <span className="ui-lsplit-resolved t-label">לא נשאר</span>
                  </>
                ) : (
                  <>
                    <span className="ui-lsplit-amount t-body"><Amount minor={restMinor} currency={currency} /></span>
                    <span className="ui-lsplit-resolved t-label">{restMinor === 0n ? "יורד" : <Percent value={shareOfLine(restMinor, lineMinor)} />}</span>
                  </>
                )}
              </span>
            </button>
            {/* Outside the button, whose label would hide it; tied back by aria-describedby. */}
            {restMessage != null ? <p id={restMessageId} className="ui-lsplit-msg ui-lsplit-rest-msg" role="status">{restMessage}</p> : null}
            {parts.length === 0 ? <p className="t-hint ui-lsplit-empty">הוסיפו חלק כדי לפצל. מה שלא חולק נשאר בשורה.</p> : null}
            <p className="ui-lsplit-add">
              <TextLink
                buttonRef={addRef}
                chevron={false}
                icon={<PlusIcon size={18} />}
                disabled={busy || blocked || parts.length >= LINE_SPLIT_MAX_PARTS}
                onClick={() => { openPicker({ kind: "new" }, "category", null); }}
              >
                הוספת חלק
              </TextLink>
            </p>
          </div>
        </fieldset>
        {/* Outside the fieldset: the server clears a line it would not split (a loan split, an open review). */}
        {split != null && split.parts.length > 0 ? (
          <p className="ui-lsplit-clear">
            <TextLink chevron={false} className="ui-lsplit-clear-link" disabled={busy} onClick={() => { setConfirmClear(true); }}>הסרת הפיצול</TextLink>
          </p>
        ) : null}
        <div className="ui-split-cta ui-lsplit-foot" aria-busy={busy || undefined}>
          <div className="ui-lsplit-totals">
            <span className="ui-lsplit-total">
              <span className="t-hint">חולקו</span>
              <span className="t-body">
                {busy ? <span className="ui-spinner" aria-hidden="true" /> : null}
                {check.overMinor > 0n
                  ? <Amount minor={lineMinor + check.overMinor} currency={currency} />
                  : splitMinor != null ? <Amount minor={splitMinor} currency={currency} /> : parts.length === 0 ? <Amount minor={0n} currency={currency} /> : "…"}
              </span>
            </span>
            <span className="ui-lsplit-total ui-lsplit-total-end">
              <span className="t-hint">{check.overMinor > 0n ? "עוברים את השורה" : "נשאר לשורה"}</span>
              <span className={check.overMinor > 0n ? "t-body ui-split-bad" : "t-body"}>
                {check.overMinor > 0n
                  ? <Amount minor={-check.overMinor} currency={currency} />
                  : restMinor != null ? <Amount minor={restMinor} currency={currency} /> : parts.length === 0 ? <Amount minor={lineMinor} currency={currency} /> : "…"}
              </span>
            </span>
          </div>
          {showHold ? <HoldLine onDiscard={discard}>{holdText}</HoldLine> : null}
        </div>
      </form>
      <ChangeAssignment
        host="overlay"
        open={target != null}
        onOpenChange={(open) => { if (!open) setTarget(null); }}
        contained
        start={pickerStart}
        supplier={line.supplier}
        amount={money(lineMinor, currency)}
        direction={line.direction}
        projects={projects}
        categories={ownCategories}
        reversals={reversals}
        projectId={pickerProject}
        categoryId={pickerCategory}
        onProjectId={pickProject}
        onCategoryId={pickCategory}
        onCommitPick={() => Promise.resolve(undefined)}
        chainProject
        noProjectLabel={pickerReversal ? undefined : partProjectLabel(null, line.projectName)}
        projectNote={pickerReversal ? lineSplitCopy("a reversal part needs a project") : undefined}
        hideSplitLink
        returnFocusRef={pickerOpener}
        onSplit={() => { setTarget(null); }}
        onCreateProject={async (name) => {
          const created = await createProject(name, draftId === "");
          setExtraProjects((list) => [...list, created]);
          if (draftId !== "") await invalidate(["dashboard"]);
          return created;
        }}
      />
      <ConfirmSheet
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="להסיר את הפיצול?"
        consequence={`השורה תיספר שוב כולה תחת ${line.categoryName ?? "בלי קטגוריה"} · ${line.projectName ?? "בלי פרויקט"}.`}
        confirmLabel="הסרה"
        destructive
        busy={saving}
        onConfirm={() => {
          void write([], "clear").then((done) => { if (!done) setConfirmClear(false); });
        }}
      />
    </>
  );
}

async function createProject(name: string, sample: boolean): Promise<ChangeChoice> {
  if (sample) return { id: `lsplit-added-${name}`, name, status: "active" };
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const saved = await supabase.rpc("upsert_project", { p_name: name, p_status: "active" });
  assertNoError(saved);
  if (typeof saved.data !== "string") throw new Error("supabase");
  return { id: saved.data, name, status: "active" };
}
