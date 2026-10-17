import { formatAmountText, type PartyCharges, type PaymentRecurring, type TransactionDetail } from "@flow/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LoanReadError, LoanTransactionSplit } from "./loan-match";
import { LoanCategoryRow } from "./loan-match-row";
import { useLoanSplitView } from "./loan-match-api";
import { absAgorot } from "../agorot";
import { cashLinesBackLabel } from "../cash";
import { useHoldWrites } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { transactionQueryOptions, useCategoriesQuery, useDashboardQuery, useInvalidateBooks, useLineMetaQuery, useTransactionQuery } from "../use-books";
import { type TxnMeta } from "../txn-meta";
import { TxnStepNav, txnParty, usePrefetchNeighbours, usePrefetchNextPage, useAnnounceTxn, useNeighbourParty, useTxnNav, useTxnNavKeys } from "../txn-nav";
import { assertNoError, useWrite } from "../use-write";
import { CardSwipe } from "../ui/card-swipe";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { transactionParent, useGoBack, useSheetHistory } from "../ui/back";
import { IconButton } from "../ui/icon-button";
import { IconRow } from "../ui/icon-row";
import { ChevronIcon, MoreIcon, ProjectsIcon, SplitIcon, TagIcon, TrashIcon } from "../ui/icons";
import { List } from "../ui/list-row";
import { ChangeAssignment, changeSaveFailure, type ChangeChoice } from "../ui/change-sheet";
import { CountedInRow, CountedInSheet, COUNTED_REASON_LOAN, COUNTED_REASON_RENO } from "../ui/counted-in";
import { ScreenHeader } from "../ui/screen-header";
import { DetailSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { Sheet } from "../ui/sheet";
import { useToast } from "../ui/toast";
import { isReversal, reversalChoices } from "../reversal";
import { ReversalTag } from "../ui/suggest-tag";
import type { LineSplitRead } from "../line-split";
import { lineSplitRowHint, useLineSplitQuery, useLoanSplitFlag } from "./line-split";
import { ReservedMenuSlot, saveNewProject, useBlockedPreview, withChoice } from "./screen-shared";
import { TransactionTopBar } from "./transaction-top-bar";
import { TxnFooter, TxnHead } from "./transaction-head";
import { TxnRecurring } from "./transaction-recurring";
import { projectChoices } from "../project-groups";

function splitProjectLabel(
  txn: { allocations?: Array<{ project_name?: string | null }> },
  splitRow: boolean,
  fallback: string,
): string {
  if (!splitRow) return fallback;
  const rows = txn.allocations ?? [];
  if (rows.length === 0) return "עלות משותפת · טרם פוצלה";
  if (rows.length === 1) return rows[0]?.project_name || "פרויקט";
  return `מפוצל · ${String(rows.length)} פרויקטים`;
}

/** What a screen reader hears after prev or next: the kind, the party and the amount, with no bare minus. */
function txnAnnouncement(txn: NonNullable<TransactionDetail>): string {
  const party = txnParty(txn);
  const kind = txn.direction === "income" ? "הכנסה" : "הוצאה";
  const amount = formatAmountText(absAgorot(txn.amount_net), txn.currency ?? "ILS", { detail: true });
  return `${kind}, ${party}, ${amount}`;
}

type LinePnlChange = {
  id: string;
  party: string;
  /** The override to write: false out, true in, null follows the category. */
  override: boolean | null;
  previous: boolean | null;
  /** The line is out of the P&L after this write. */
  out: boolean;
  undo: boolean;
};

type LinePnl = {
  override: boolean | null;
  categoryOut: boolean;
  out: boolean;
  /** Some parts count and some are kept out (FLOW-124: a line split by category). */
  mixed: boolean;
  /** The line is kept out by its split's categories, not its own. */
  partsOut: boolean;
  forcedIn: boolean;
  next: boolean | null;
};

/**
 * FLOW-108, decision 0112. Going back to the category's own state always clears the override.
 * FLOW-121, decision 0114: a guessed kept-out category counts until it is confirmed.
 * FLOW-124, decision 0135: the server's pnl_state reads the line's parts, so a line split by
 * category is in, out or mixed by its parts. A sample card that changed its override locally
 * passes no state. A loan line keeps its own mark, so its mixed state is not shown.
 * A line split by category always writes true or false: null lets each part follow its own
 * category, which the line's category can't predict, so a tap could leave the line as it was.
 */
export function linePnlState(
  txn: { category_excluded_from_pnl?: boolean; category_suggested?: boolean; pnl_fixed?: boolean; in_pnl?: boolean },
  override: boolean | null,
  state?: "in" | "out" | "mixed" | null,
  splitByCategory = false,
): LinePnl {
  // A loan line ignores the override, so the server's in_pnl is the category's say. Only a loan
  // category stays out as a guess; a loan-split line under a guessed other category counts.
  const categoryOut = txn.pnl_fixed === true && txn.in_pnl != null
    ? !txn.in_pnl
    : txn.category_excluded_from_pnl === true && txn.category_suggested !== true;
  const lineOut = override === false || (override == null && categoryOut);
  const server = txn.pnl_fixed === true ? null : (state ?? null);
  const out = server == null ? lineOut : server === "out";
  const mixed = server === "mixed";
  const partsOut = out && !lineOut;
  const forcedIn = override === true && categoryOut;
  // Back in: true, unless the line's own false is all that keeps it out. Out: false, unless
  // clearing a forced-in override is enough.
  const next = splitByCategory
    ? out
    : out
      ? (override === false && !categoryOut && !partsOut ? null : true)
      : (forcedIn ? null : false);
  return { override, categoryOut, out, mixed, partsOut, forcedIn, next };
}

/** What a change to a line's project or category refreshes. */
const ASSIGN_KEYS = ["txn", "dashboard", "project", "project-category", "project-waiting", "review"];
/** What a cash switch changes: the line, Home's cash box, the lists. */
const CASH_KEYS = ["txn", "dashboard", "home", "breakdown-lines"];

/** A cash write: the line's own override, with the state before it for the undo. */
type CashChange = { id: string; party: string; next: boolean | null; previous: boolean | null; on: boolean; undo: boolean };

/** A pick's write: the next ids, and the screen as it was before the tap, for a rollback. */
type PickBack = {
  next: { projectId: string; categoryId: string };
  back: { projectId: string; categoryId: string; projectName: string; categoryName: string; committed: { projectId: string; categoryId: string } };
};

export function TransactionScreen({
  sample,
  sampleProjects,
  sampleCategories,
  sampleLineSplit,
  sampleRecurring,
  sampleCharges,
  sampleSheet,
  sampleMeta,
  sampleFrom,
  sampleNoFooter = false,
  onOpenSplit,
}: {
  sample?: NonNullable<TransactionDetail>;
  sampleProjects?: Array<{ id: string; name: string; code?: string }>;
  sampleCategories?: Array<{ id: string; name: string; kind?: "income" | "expense" }>;
  /** FLOW-325: a story's split by category, in place of the get_line_split read. */
  sampleLineSplit?: LineSplitRead | null;
  /** FLOW-415: a story's recurring switch, in place of the payment_recurring read. */
  sampleRecurring?: PaymentRecurring | null;
  /** FLOW-431: a story's party charges, in place of the party_charges read. */
  sampleCharges?: PartyCharges | null;
  /** The sheet a story's frame draws open: the all-charges list or the pace choices. */
  sampleSheet?: "all" | "pace";
  /** A story's bank line (get_line_meta), in place of the read. Its account makes the meta say שורת בנק. */
  sampleMeta?: TxnMeta | null;
  /** The month lines page the story was opened from (`/cash/YYYY-MM/out/USD`), so the back link reads its side. */
  sampleFrom?: string;
  /** The board's frame draws no footer under the cards. */
  sampleNoFooter?: boolean;
  /** Reviewer preview stays on its own split instead of the ledger route. */
  onOpenSplit?: () => void;
} = {}) {
  const { transactionId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const invalidate = useInvalidateBooks();
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  // FLOW-320: each row opens its own picker, and the sheet returns focus to that row.
  const [changeStart, setChangeStart] = useState<"project" | "category">("project");
  const projectRowRef = useRef<HTMLButtonElement>(null);
  const categoryRowRef = useRef<HTMLButtonElement>(null);
  const leaveChange = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const setChangeSheet = useSheetHistory("txn-change", changeOpen, setChangeOpen, () => leaveChange.current());
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const detail = useTransactionQuery(sample ? "" : transactionId);
  const lineMeta = useLineMetaQuery(sample ? sample.id : transactionId, sample == null);
  const meta = sample ? sampleMeta ?? null : lineMeta.data ?? null;
  const nav = useTxnNav(sample?.id ?? transactionId);
  const goBack = useGoBack();
  useTxnNavKeys(nav);
  const dashboard = useDashboardQuery(sample == null);
  const categories = useCategoriesQuery(sample == null);
  const lineSplitQuery = useLineSplitQuery(sample ? "" : transactionId, sample == null);
  const loanSplitFlag = useLoanSplitFlag(sample?.id ?? transactionId);
  const loanSplitView = useLoanSplitView((sample ?? detail.data)?.loan_split);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  const remove = useWrite({
    failure: "לא הצלחנו למחוק.",
    // A card opened from a list returns to it, so that list drops the row too.
    keys: ["dashboard", "txn", "unpaid", "review", "project", "project-category", "filed-today"],
    onSuccess: () => {
      setConfirm(false);
      // Opened from a list: back to that list, not Home.
      if (nav) goBack(nav.list.from);
      else void navigate(`/${search}`);
    },
    run: async () => {
      const supabase = getSupabase();
      const current = sample ?? detail.data;
      if (!supabase || !current) throw new Error("supabase");
      assertNoError(await supabase.rpc("delete_transaction", { p_id: current.id }));
    },
  });
  const txn = sample ?? detail.data;
  const parent = transactionParent(txn?.project_id, search);
  usePrefetchNeighbours(nav, txn != null);
  usePrefetchNextPage(sample?.id ?? transactionId, txn != null);
  const peekNext = useNeighbourParty(nav?.next ?? null);
  const peekPrev = useNeighbourParty(nav?.prev ?? null);
  useAnnounceTxn(nav, txn == null ? null : txnAnnouncement(txn));
  // FLOW-108. A sample card keeps its override locally; a live card reads it back from the server.
  const [sampleOverride, setSampleOverride] = useState<boolean | null | undefined>(undefined);
  // The card's split-by-categories link is shown (writes not held, no open review): לפיצול may go there.
  const splitOpen = useRef(false);
  const pnlLine = useWrite<LinePnlChange>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה."
      // 0138: in the P&L, a kept-out reversal part counts, so it needs its own project.
      // FLOW-343: short, with the way out on the toast.
      : error.message.includes("a reversal part needs a project")
        ? { message: "לחלק ההחזר אין פרויקט.", retry: false, ...(splitOpen.current ? { action: "לפיצול" } : {}) }
        : "לא הצלחנו לעדכן את השורה."),
    onSplit: () => {
      void navigate(`/transactions/${transactionId}/split-category${search}`);
    },
    keys: ["txn", "dashboard", "project", "project-category", "home", "breakdown", "breakdown-lines"],
    onSuccess: (done) => {
      toast.show({
        message: done.out ? "הוצא מהרווח" : "נספר ברווח",
        ...(done.undo ? {} : {
          action: "ביטול",
          onAction: () => {
            pnlLine.mutate({ ...done, override: done.previous, previous: done.override, out: !done.out, undo: true });
          },
        }),
      });
    },
    run: async (change) => {
      if (sample) {
        setSampleOverride(change.override);
        return;
      }
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      // null clears the override; the generated types mark every argument non-null.
      assertNoError(await supabase.rpc("set_transaction_pnl", { p_id: change.id, p_in_pnl: change.override as boolean }));
    },
  });
  const [sampleCash, setSampleCash] = useState<boolean | null | undefined>(undefined);
  const [countedOpen, setCountedOpen] = useState(false);
  const countedRef = useRef<HTMLButtonElement>(null);
  const cashLine = useWrite<CashChange>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את השורה."),
    keys: CASH_KEYS,
    // A switch flips at once and the server's answer only corrects it (decision 0180).
    optimistic: (change) => (sample || detail.data == null ? [] : [{
      key: transactionQueryOptions(preview, detail.data.id).queryKey,
      update: (old: unknown) => (old == null ? old : { ...(old), in_cash_override: change.next }),
    }]),
    onSuccess: (done) => {
      toast.show({
        message: done.on ? "נספר בתזרים" : "הוצא מהתזרים",
        ...(done.undo ? {} : {
          action: "ביטול",
          onAction: () => {
            cashLine.mutate({ ...done, next: done.previous, previous: done.next, on: !done.on, undo: true });
          },
        }),
      });
    },
    run: async (change) => {
      if (sample) {
        setSampleCash(change.next);
        return;
      }
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      // null clears the override; the generated types mark every argument non-null.
      assertNoError(await supabase.rpc("set_transaction_cash", { p_id: change.id, p_in_cash: change.next as boolean }));
    },
  });
  const [projectName, setProjectName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [hold, setHold] = useState("");
  const writeTarget = useRef({ projectId: "", categoryId: "" });
  const committed = useRef({ projectId: "", categoryId: "" });
  const namesRef = useRef({
    projects: [] as Array<{ id: string; name: string }>,
    categories: [] as Array<{ id: string; name: string }>,
  });
  namesRef.current = {
    projects: sample
      ? [...(sampleProjects ?? []), ...extraProjects]
      : [...(dashboard.data?.projects ?? []), ...extraProjects],
    categories: sample ? (sampleCategories ?? []) : (categories.data ?? []),
  };
  const applyRef = useRef<() => void>(() => undefined);
  applyRef.current = () => {
    const next = writeTarget.current;
    committed.current = next;
    setProjectId(next.projectId);
    setCategoryId(next.categoryId);
    const namedProject = namesRef.current.projects.find((project) => project.id === next.projectId);
    if (namedProject) setProjectName(namedProject.name);
    const namedCategory = namesRef.current.categories.find((category) => category.id === next.categoryId);
    if (namedCategory) setCategoryName(namedCategory.name);
  };
  useEffect(() => {
    if (changeOpen || !txn) return;
    setProjectId(committed.current.projectId !== "" ? committed.current.projectId : (txn.project_id ?? ""));
    setCategoryId(committed.current.categoryId !== "" ? committed.current.categoryId : (txn.category_id ?? ""));
  }, [changeOpen, txn]);
  useEffect(() => {
    if (hold === "" || !txn) return;
    const splitLike = txn.pnl_role === "shared" || txn.review_reason === "unallocated_shared" || (txn.allocations?.length ?? 0) > 1;
    const complete = splitLike ? categoryId !== "" : projectId !== "" && categoryId !== "";
    if (complete) setHold("");
  }, [hold, txn, categoryId, projectId]);
  const undoId = useRef<string | null>(null);
  /** The transaction's cache takes the picked names at once (decision 0180). */
  const pickCache = (payload: PickBack, withProject: boolean) => {
    const current = detail.data;
    if (sample || current == null) return [];
    const project = namesRef.current.projects.find((entry) => entry.id === payload.next.projectId);
    const category = namesRef.current.categories.find((entry) => entry.id === payload.next.categoryId);
    return [{
      key: transactionQueryOptions(preview, current.id).queryKey,
      update: (old: unknown) => (old == null ? old : {
        ...(old),
        ...(withProject ? { project_id: payload.next.projectId, project_name: project?.name ?? null } : {}),
        category_id: payload.next.categoryId,
        category_name: category?.name ?? null,
      }),
    }];
  };
  const undo = useWrite({
    failure: "לא הצלחנו לבטל את השיוך.",
    keys: ASSIGN_KEYS,
    success: "השיוך הקודם חזר",
    onSuccess: () => {
      committed.current = { projectId: "", categoryId: "" };
      setProjectName("");
      setCategoryName("");
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase || undoId.current == null) throw new Error("supabase");
      assertNoError(await supabase.rpc("undo_reassign", { p_id: undoId.current }));
    },
  });
  // A saved project or category: the screen takes the write, and ביטול undoes it when the server kept an undo id.
  const assignSaved = () => {
    applyRef.current();
    const id = undoId.current;
    toast.show({
      message: "השיוך נשמר",
      ...(!sample && id ? { action: "ביטול", onAction: () => { undo.mutate(); } } : {}),
    });
  };
  // The pick is the check, the summary and the row at once; a failure goes back to the pick before (decision 0075).
  const restorePick = (payload: PickBack | undefined) => {
    if (payload == null) return;
    committed.current = payload.back.committed;
    setProjectId(payload.back.projectId);
    setCategoryId(payload.back.categoryId);
    setProjectName(payload.back.projectName);
    setCategoryName(payload.back.categoryName);
  };
  const reassign = useWrite<PickBack>({
    failure: changeSaveFailure,
    onError: (_error, payload) => { restorePick(payload); },
    optimistic: (payload) => pickCache(payload, true),
    onSplit: () => {
      if (onOpenSplit) {
        onOpenSplit();
        return;
      }
      void navigate(`/transactions/${transactionId}/split-category${search}`, { replace: true });
    },
    keys: ASSIGN_KEYS,
    onSuccess: assignSaved,
    run: async ({ next }) => {
      const current = sample ?? detail.data;
      if (!current) throw new Error("supabase");
      const supabase = getSupabase();
      if (!supabase || next.projectId === "" || next.categoryId === "") throw new Error("supabase");
      const saved = await supabase.rpc("reassign_transaction", {
        p_id: current.id,
        p_project_id: next.projectId,
        p_category_id: next.categoryId,
      });
      assertNoError(saved);
      undoId.current = typeof saved.data === "string" ? saved.data : null;
    },
  });
  const setCategory = useWrite<PickBack>({
    failure: changeSaveFailure,
    onError: (_error, payload) => { restorePick(payload); },
    optimistic: (payload) => pickCache(payload, false),
    onSplit: () => {
      void navigate(`/transactions/${transactionId}/split-category${search}`, { replace: true });
    },
    keys: ASSIGN_KEYS,
    onSuccess: assignSaved,
    run: async ({ next }) => {
      const current = sample ?? detail.data;
      const nextCategory = next.categoryId;
      if (!current) throw new Error("supabase");
      const supabase = getSupabase();
      if (!supabase || nextCategory === "") throw new Error("supabase");
      const saved = await supabase.rpc("set_transaction_category", {
        p_id: current.id,
        p_category_id: nextCategory,
      });
      assertNoError(saved);
      undoId.current = typeof saved.data === "string" ? saved.data : null;
    },
  });
  // FLOW-345: the step row stays while a card loads, fails or is gone, so the walk can go on past it.
  // Every layout goes through this frame, so the row keeps its place in the tree and is not remounted
  // (its focus move run again) when the card finishes loading.
  const frame = (body: ReactNode) => (
    <div className={nav ? "ui-txn-stepped" : undefined}>
      {body}
      {nav ? <TxnStepNav nav={nav} ready={txn != null} /> : null}
    </div>
  );
  if (phase.kind === "loading" || phase.kind === "error" || phase.kind === "empty") {
    return frame(
      <ScreenState title="פרטי תנועה" backTo={parent} phase={phase.kind === "empty" ? { kind: "empty" } : phase} onRetry={() => { void detail.refetch(); }} loading={<DetailSkeleton />} empty={<p className="ui-page-pad t-hint">אין תנועה להצגה.</p>} />,
    );
  }
  if (!txn) {
    return frame(<ScreenHeader title="פרטי תנועה" subtitle="התנועה לא נמצאה." backTo={parent} />);
  }
  const detailRow = txn;
  const serverSplit = detailRow.pnl_role === "shared" || detailRow.review_reason === "unallocated_shared" || (detailRow.allocations?.length ?? 0) > 1;
  const splitRow = serverSplit;
  const shownProject = splitProjectLabel(txn, splitRow, projectName || txn.project_name || "בחרו פרויקט");
  const shownCategory = categoryName || txn.category_name || "בחרו קטגוריה";
  const shownCategoryId = categoryId || txn.category_id || "";
  const shownLoanPart = categories.data?.find((category) => category.id === shownCategoryId)?.loan_part ?? null;
  function openSplit() {
    if (onOpenSplit) {
      onOpenSplit();
      return;
    }
    void navigate(`/transactions/${detailRow.id}/split-category${search}`);
  }
  function commitPick(kind: "project" | "category", id: string) {
    const previous = { projectId, categoryId };
    // A split's project row opens the split screen, so a split only picks a category here.
    const categoryOnly = splitRow && kind === "category";
    const next = {
      projectId: kind === "project" ? id : previous.projectId,
      categoryId: kind === "category" ? id : previous.categoryId,
    };
    writeTarget.current = next;
    const complete = categoryOnly ? next.categoryId !== "" : next.projectId !== "" && next.categoryId !== "";
    if (!complete) {
      // Name only what is still missing.
      setHold(categoryOnly || next.projectId !== "" ? "בחרו קטגוריה." : next.categoryId === "" ? "בחרו פרויקט וקטגוריה." : "בחרו פרויקט.");
      return "hold" as const;
    }
    setHold("");
    if (sample) {
      applyRef.current();
      toast.show({ message: "השיוך נשמר" });
      return undefined;
    }
    if (blocked()) throw new Error("preview");
    // The check, the summary and the row take the pick now; the write runs behind them.
    const back: PickBack["back"] = {
      projectId: previous.projectId,
      categoryId: previous.categoryId,
      projectName,
      categoryName,
      committed: committed.current,
    };
    applyRef.current();
    const payload: PickBack = { back, next };
    if (categoryOnly) setCategory.mutate(payload);
    else reassign.mutate(payload);
    return undefined;
  }
  const party = txnParty(txn);
  // An income credit (negative income) reads with its minus and is never green, as its row does (decision 0120).
  const moneyIn = txn.direction === "income" && txn.amount_net >= 0n;
  const changeProjects = withChoice(
    [
      ...(sample
        ? (sampleProjects ?? []).map((project) => ({ id: project.id, name: project.name, code: project.code }))
        : projectChoices(dashboard.data)),
      ...extraProjects,
    ],
    projectId,
    txn.project_name,
  );
  const txnDirection = txn.direction === "income" ? "income" : "expense";
  const changeReversals = sample || splitRow ? [] : reversalChoices(categories.data ?? [], txnDirection, txn.category_id);
  const changeCategories = withChoice(
    (sample
      ? (sampleCategories ?? [])
      : (categories.data ?? []).filter((category) => !category.hidden && (txn.direction === "income" ? category.kind === "income" : category.kind !== "income"))
    ).map((category) => ({ id: category.id, name: category.name })),
    changeReversals.some((option) => option.id === categoryId) ? "" : categoryId,
    txn.category_name,
  );
  const shownReversal = sample == null && isReversal(categories.data ?? [], categoryId || txn.category_id, txnDirection);
  const sampleChanged = sample != null && sampleOverride !== undefined;
  const lineSplit = sample ? (sampleLineSplit ?? null) : lineSplitQuery.data;
  const splitByCategory = lineSplit != null && lineSplit.parts.length > 0 && lineSplit.partsMatch;
  // A line with a loan split is fixed too: set_transaction_pnl refuses it, and its mixed state is
  // the loan's parts, not a split by category. get_transaction's pnl_fixed reads only the line's
  // category, which misses a loan's own (unkeyed) principal category (FLOW-134 item 3).
  const loanLine = txn.pnl_fixed === true || loanSplitFlag || loanSplitView != null;
  const pnl = linePnlState(txn, sampleChanged ? sampleOverride : (txn.in_pnl_override ?? null), sampleChanged || loanLine ? null : txn.pnl_state, splitByCategory);
  // The cash view reads the line's override first, then its categories (decision 0168).
  const cashOverride = sampleCash !== undefined ? sampleCash : (txn.in_cash_override ?? null);
  const cashState = sampleCash !== undefined ? (sampleCash === false ? "out" : "in") : (txn.cash_state ?? "in");
  const inCash = cashOverride != null ? cashOverride : cashState !== "out";
  // FLOW-329: ⋯ holds only delete, so it shows only on a manual line; its slot stays so the title keeps its place.
  const canDelete = txn.source === "manual" && !holdWrites;
  const menuButton = canDelete
    ? <IconButton ref={moreRef} label="עוד" onClick={() => { setMenu(true); }}><MoreIcon /></IconButton>
    : <ReservedMenuSlot />;
  // A split's row is set only while no review is open on the line, and not in the reviewer's preview.
  const reviewBlocked = txn.review_status === "open" && txn.review_reason !== "split_mismatch";
  splitOpen.current = !(onOpenSplit || holdWrites || reviewBlocked);
  const splitTo = `/transactions/${txn.id}/split-category${search}`;
  // The reason a line is out of the P&L, as the counted-in row names it (FLOW-366, guide §7.10).
  const category = categories.data?.find((entry) => entry.id === shownCategoryId);
  const countedReason = loanLine ? COUNTED_REASON_LOAN : category?.in_rehab === true ? COUNTED_REASON_RENO : null;
  const countedLocked = loanLine || pnl.mixed;
  const lockedHint = loanLine ? (loanSplitFlag || loanSplitView != null ? "לפי חלקי ההלוואה" : "תשלום הלוואה · לפי הקטגוריה") : "לפי הקטגוריות בפיצול";
  const countedBusy = pnlLine.isPending || cashLine.isPending;
  const lineSplitHint = lineSplitRowHint(lineSplit);
  function togglePnl() {
    if (holdWrites || pnlLine.isPending || (sample == null && blocked())) return;
    pnlLine.mutate({ id: detailRow.id, party, override: pnl.next, previous: pnl.override, out: !pnl.out, undo: false });
  }
  function toggleCash(next: boolean) {
    if (holdWrites || cashLine.isPending || (sample == null && blocked())) return;
    cashLine.mutate({ id: detailRow.id, party, next, previous: cashOverride, on: next, undo: false });
  }
  const pending = txn.review_status === "open";
  const amountText = formatAmountText(absAgorot(txn.amount_net), txn.currency ?? "ILS", { detail: true });
  return frame(
    <>
      <TransactionTopBar
        fallback={parent}
        backLabel={nav ? cashLinesBackLabel(nav.list.from) : sampleFrom != null ? cashLinesBackLabel(sampleFrom) : null}
        title={`${party} · ${amountText}`}
        end={menuButton}
      />
      <CardSwipe key={txn.id} canNext={nav?.next != null} canPrev={nav?.prev != null} enter={nav?.enter} peekNext={peekNext} peekPrev={peekPrev} onStep={(step) => { nav?.move(step, "swipe"); }}>
        <div className="ui-txn-body">
          <div className="ui-txn-intro">
          <TxnHead txn={txn} party={party} moneyIn={moneyIn} meta={meta ?? undefined} />
          {pending ? (
            <Link className="ui-txn-banner" to={txn.review_id ? `/review?item=${encodeURIComponent(txn.review_id)}&from=all` : "/review?from=all"}>
              <span className="ui-txn-banner-text">השורה מחכה לאישור שלך</span>
              <span className="ui-txn-banner-action">לאישור</span>
              <ChevronIcon />
            </Link>
          ) : null}
          </div>
        <List layout="inset">
          {holdWrites ? (
            <IconRow icon={<ProjectsIcon />} label="פרויקט" value={shownProject} valueTone={shownProject === "בחרו פרויקט" ? "accent" : undefined} hint={lineSplitHint} />
          ) : (
            <IconRow icon={<ProjectsIcon />} label="פרויקט" value={shownProject} valueTone={shownProject === "בחרו פרויקט" ? "accent" : undefined} hint={lineSplitHint} buttonRef={projectRowRef} onClick={() => {
              if (splitRow) {
                openSplit();
                return;
              }
              setChangeStart("project");
              setChangeSheet(true);
            }} />
          )}
          {/* FLOW-114: a matched loan payment shows its loan here instead, and its category is locked. */}
          <LoanCategoryRow transactionId={txn.id} split={txn.loan_split} direction={txn.direction} currency={txn.currency} docDate={txn.doc_date} active={sample == null} readOnly={holdWrites}>
            {holdWrites ? (
              <IconRow icon={<TagIcon />} label="קטגוריה" value={shownCategory} valueTone={shownCategory === "בחרו קטגוריה" ? "accent" : undefined} tag={shownReversal ? <ReversalTag /> : undefined} hint={lineSplitHint} />
            ) : (
              <IconRow icon={<TagIcon />} label="קטגוריה" value={shownCategory} valueTone={shownCategory === "בחרו קטגוריה" ? "accent" : undefined} tag={shownReversal ? <ReversalTag /> : undefined} hint={lineSplitHint} buttonRef={categoryRowRef} onClick={() => {
                setChangeStart("category");
                setChangeSheet(true);
              }} />
            )}
          </LoanCategoryRow>
        </List>
        <LoanTransactionSplit
          transactionId={txn.id}
          docDate={txn.doc_date}
          loanPart={shownLoanPart}
          categoryId={shownCategoryId || null}
          direction={txn.direction}
          active={sample == null}
          readOnly={holdWrites}
          split={txn.loan_split}
        />
        <TxnRecurring
          txn={txn}
          holdWrites={holdWrites}
          sample={sample ? (sampleRecurring ?? null) : undefined}
          sampleCharges={sample ? (sampleCharges ?? null) : undefined}
          openSheet={sample ? sampleSheet : undefined}
          context={`${shownProject} · ${shownCategory}`}
        />
        <List layout="inset">
          <CountedInRow
            pnl={!pnl.out}
            cash={inCash}
            reason={countedReason}
            locked={countedLocked}
            lockedHint={lockedHint}
            disabled={holdWrites}
            busy={countedBusy}
            onOpen={() => { setCountedOpen(true); }}
            buttonRef={countedRef}
          />
          {holdWrites ? (
            <IconRow icon={<SplitIcon />} label="פיצול" value={lineSplitHint ?? "בין פרויקטים או לפי קטגוריות"} />
          ) : (
            <IconRow icon={<SplitIcon />} label="פיצול" value={lineSplitHint ?? "בין פרויקטים או לפי קטגוריות"} disabled={loanSplitFlag || loanSplitView != null} onClick={() => {
              if (onOpenSplit) {
                onOpenSplit();
                return;
              }
              void navigate(splitTo);
            }} />
          )}
        </List>
        {lineMeta.isError && lineMeta.data == null ? (
          <LoanReadError label="פרטי הבנק" busy={lineMeta.isFetching} onRetry={() => { void lineMeta.refetch(); }} />
        ) : null}
        {sampleNoFooter ? null : <TxnFooter txn={txn} meta={meta ?? undefined} />}
        </div>
      </CardSwipe>
      {countedLocked ? null : (
        <CountedInSheet
          open={countedOpen}
          onOpenChange={setCountedOpen}
          pnl={!pnl.out}
          cash={inCash}
          reason={countedReason}
          busy={countedBusy}
          onPnl={togglePnl}
          onCash={toggleCash}
          returnFocusRef={countedRef}
        />
      )}
      <ChangeAssignment
        host="overlay"
        open={changeOpen}
        onOpenChange={setChangeSheet}
        contained
        start={changeStart}
        categoryLocked={loanSplitView != null}
        returnFocusRef={changeStart === "category" ? categoryRowRef : projectRowRef}
        supplier={party}
        amount={formatAmountText(absAgorot(txn.amount_net), txn.currency, {
          direction: txn.direction === "income" ? "income" : "expense",
          detail: true,
        })}
        direction={txn.direction === "income" ? "income" : "expense"}
        projects={changeProjects}
        categories={changeCategories}
        reversals={changeReversals}
        projectId={projectId}
        categoryId={categoryId}
        onProjectId={setProjectId}
        onCategoryId={setCategoryId}
        hold={hold}
        leave={leaveChange}
        onDiscard={() => {
          setHold("");
          setProjectId(committed.current.projectId !== "" ? committed.current.projectId : (detailRow.project_id ?? ""));
          setCategoryId(committed.current.categoryId !== "" ? committed.current.categoryId : (detailRow.category_id ?? ""));
        }}
        loading={sample == null && (dashboard.isLoading || categories.isLoading)}
        onCommitPick={commitPick}
        onSplit={() => {
          setChangeOpen(false);
          openSplit();
        }}
        onCreateProject={(name) => saveNewProject(name, blocked, toast, (project) => {
          setExtraProjects((list) => [...list, project]);
        }, invalidate)}
      />
      <Sheet open={menu && canDelete} onOpenChange={setMenu} title="עוד" returnFocusRef={moreRef}>
        <div className="ui-stack">
          <Button variant="danger" icon={<TrashIcon />} onClick={() => { setMenu(false); setConfirm(true); }}>מחיקה</Button>
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title="למחוק את הרשומה?"
        item={txn.description}
        consequence="למחוק את הרשומה הידנית? אי אפשר לשחזר."
        confirmLabel="מחיקה"
        destructive
        busy={remove.isPending}
        onConfirm={() => {
          if (blocked()) return;
          remove.mutate();
        }}
      />
    </>,
  );
}
