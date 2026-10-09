import { formatAmountText, formatMoney, type TransactionDetail } from "@flow/shared";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LoanReadError, LoanTransactionSplit } from "./loan-match";
import { LoanCategoryRow } from "./loan-match-row";
import { useLoanSplitView } from "./loan-match-api";
import { absAgorot } from "../agorot";
import { useHoldWrites } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useCategoriesQuery, useDashboardQuery, useInvalidateBooks, useLineMetaQuery, useTransactionQuery } from "../use-books";
import { TxnNavButtons, usePrefetchNeighbours, useAnnounceTxn, useTxnNav, useTxnNavKeys } from "../txn-nav";
import { assertNoError, useWrite } from "../use-write";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { StatusPill } from "../ui/chip";
import { BackButton, transactionParent, useGoBack, useSheetHistory } from "../ui/back";
import { IconButton } from "../ui/icon-button";
import { ChartIcon, CheckIcon, KeptOutIcon, LockIcon, MoreIcon, ProjectsIcon, TagIcon, TrashIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { Toggle } from "../ui/toggle";
import { ChangeAssignment, changeSaveFailure, type ChangeChoice } from "../ui/change-sheet";
import { BankDetails } from "../ui/bank-details";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Sheet } from "../ui/sheet";
import { useToast } from "../ui/toast";
import { isReversal, reversalChoices } from "../reversal";
import { ReversalTag } from "../ui/suggest-tag";
import type { LineSplitRead } from "../line-split";
import { LineSplitSection, lineSplitRowHint, useLineSplitQuery, useLoanSplitFlag } from "./line-split";
import { invoiceDate, KEPT_OUT, KEPT_OUT_SHORT, MIXED_SHORT, ReservedMenuSlot, saveNewProject, useBlockedPreview, vatStatusLabel, withChoice } from "./screen-shared";

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
  const party = txn.supplier_name ?? txn.customer_name ?? txn.description;
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

/** The switch row's one line of scope, shown only while the line is out (DESIGN-RULES §2.1). */
function linePnlHint(pnl: LinePnl, categoryName: string): string | undefined {
  if (!pnl.out) return undefined;
  if (pnl.partsOut) return "הקטגוריות בפיצול מחוץ לרווח והפסד. אפשר להחזיר רק את השורה הזו.";
  if (pnl.override === false) return "רק השורה הזו. הקטגוריה לא משתנה.";
  return `הקטגוריה ${categoryName} מחוץ לרווח והפסד. אפשר להחזיר רק את השורה הזו.`;
}

export function TransactionScreen({
  sample,
  sampleProjects,
  sampleCategories,
  sampleLineSplit,
  onOpenSplit,
}: {
  sample?: NonNullable<TransactionDetail>;
  sampleProjects?: Array<{ id: string; name: string; code?: string }>;
  sampleCategories?: Array<{ id: string; name: string; kind?: "income" | "expense" }>;
  /** FLOW-325: a story's split by category, in place of the get_line_split read. */
  sampleLineSplit?: LineSplitRead | null;
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
  useAnnounceTxn(nav, txn == null ? null : txnAnnouncement(txn));
  // FLOW-108. A sample card keeps its override locally; a live card reads it back from the server.
  const [sampleOverride, setSampleOverride] = useState<boolean | null | undefined>(undefined);
  const pnlLine = useWrite<LinePnlChange>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה."
      // 0138: in the P&L, a kept-out reversal part counts, so it needs its own project.
      : error.message.includes("a reversal part needs a project") ? "לחלק החזר בפיצול אין פרויקט. בחרו לו פרויקט בפיצול, ואז נסו שוב."
        : "לא הצלחנו לעדכן את השורה."),
    keys: ["txn", "dashboard", "project", "project-category", "home", "breakdown", "breakdown-lines"],
    onSuccess: (done) => {
      toast.show({
        message: `${done.party} · ${done.out ? KEPT_OUT : "ברווח והפסד"}`,
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
  const undo = useWrite({
    failure: "לא הצלחנו לבטל את השיוך.",
    keys: ["txn", "dashboard", "project", "project-category", "project-waiting", "review"],
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
  const reassign = useWrite({
    failure: changeSaveFailure,
    onSplit: () => {
      if (onOpenSplit) {
        onOpenSplit();
        return;
      }
      void navigate(`/transactions/${transactionId}/split${search}`, { replace: true });
    },
    keys: ["txn", "dashboard", "project", "project-category", "project-waiting", "review"],
    onSuccess: () => {
      applyRef.current();
      const id = undoId.current;
      toast.show({
        message: "השיוך נשמר",
        ...(!sample && id ? { action: "ביטול", onAction: () => { undo.mutate(); } } : {}),
      });
    },
    run: async () => {
      const current = sample ?? detail.data;
      const next = writeTarget.current;
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
  const setCategory = useWrite({
    failure: changeSaveFailure,
    onSplit: () => {
      void navigate(`/transactions/${transactionId}/split${search}`, { replace: true });
    },
    keys: ["txn", "dashboard", "project", "project-category", "project-waiting", "review"],
    onSuccess: () => {
      applyRef.current();
      const id = undoId.current;
      toast.show({
        message: "השיוך נשמר",
        ...(!sample && id ? { action: "ביטול", onAction: () => { undo.mutate(); } } : {}),
      });
    },
    run: async () => {
      const current = sample ?? detail.data;
      const nextCategory = writeTarget.current.categoryId;
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
  // While a card loads or fails, ⋯ keeps its slot so ˄ ˅ stay under the finger,
  // and the long title sits under the bar so it fits at 320.
  const navEnd = nav ? (
    <div className="ui-txn-end">
      <TxnNavButtons nav={nav} />
      <ReservedMenuSlot />
    </div>
  ) : undefined;
  if (phase.kind === "loading" || phase.kind === "error" || phase.kind === "empty") {
    return <ScreenState title="פרטי תנועה" backTo={parent} stacked={nav != null} action={navEnd} phase={phase.kind === "empty" ? { kind: "empty" } : phase} onRetry={() => { void detail.refetch(); }} empty={<p className="ui-page-pad t-hint">אין תנועה להצגה.</p>} />;
  }
  if (!txn) {
    return nav
      ? <ScreenHeader layout="stacked" title="פרטי תנועה" subtitle="התנועה לא נמצאה." backTo={parent} trailing={navEnd} />
      : <ScreenHeader title="פרטי תנועה" subtitle="התנועה לא נמצאה." backTo={parent} />;
  }
  const detailRow = txn;
  const serverSplit = detailRow.pnl_role === "shared" || detailRow.review_reason === "unallocated_shared" || (detailRow.allocations?.length ?? 0) > 1;
  const splitRow = serverSplit;
  const shownProject = splitProjectLabel(txn, splitRow, projectName || txn.project_name || "בלי פרויקט");
  const shownCategory = categoryName || txn.category_name || "בלי קטגוריה";
  const shownCategoryId = categoryId || txn.category_id || "";
  const shownLoanPart = categories.data?.find((category) => category.id === shownCategoryId)?.loan_part ?? null;
  function openSplit() {
    if (onOpenSplit) {
      onOpenSplit();
      return;
    }
    void navigate(`/transactions/${detailRow.id}/split${search}`);
  }
  async function commitPick(kind: "project" | "category", id: string) {
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
    try {
      if (sample) {
        applyRef.current();
        toast.show({ message: "השיוך נשמר" });
        return undefined;
      }
      if (blocked()) throw new Error("preview");
      if (categoryOnly) await setCategory.mutateAsync();
      else await reassign.mutateAsync();
    } catch (error) {
      setProjectId(previous.projectId);
      setCategoryId(previous.categoryId);
      throw error;
    }
    return undefined;
  }
  const party = txn.supplier_name ?? txn.customer_name ?? txn.description;
  const changeProjects = withChoice(
    [
      ...(sample
        ? (sampleProjects ?? []).map((project) => ({ id: project.id, name: project.name, code: project.code }))
        : (dashboard.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name, status: project.status }))),
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
  const reviewLabel = txn.review_status === "open" ? "ממתין לאישור" : txn.review_status === "approved" || txn.review_status === "changed" ? "מאושר" : null;
  const paymentLabel = txn.open_gross_agorot != null && txn.open_gross_agorot !== 0n ? "טרם נגבה" : txn.paid === true ? "שולם" : null;
  const vatShown = (txn.currency ?? "ILS") === "ILS";
  const sampleChanged = sample != null && sampleOverride !== undefined;
  const lineSplit = sample ? (sampleLineSplit ?? null) : lineSplitQuery.data;
  const splitByCategory = lineSplit != null && lineSplit.parts.length > 0 && lineSplit.partsMatch;
  // A line with a loan split is fixed too: set_transaction_pnl refuses it, and its mixed state is
  // the loan's parts, not a split by category. get_transaction's pnl_fixed reads only the line's
  // category, which misses a loan's own (unkeyed) principal category (FLOW-134 item 3).
  const loanLine = txn.pnl_fixed === true || loanSplitFlag || loanSplitView != null;
  const pnl = linePnlState(txn, sampleChanged ? sampleOverride : (txn.in_pnl_override ?? null), sampleChanged || loanLine ? null : txn.pnl_state, splitByCategory);
  const pnlPill = pnl.out ? (
    <StatusPill icon={<KeptOutIcon size={16} />}>{KEPT_OUT_SHORT}</StatusPill>
  ) : pnl.mixed ? (
    <StatusPill icon={<KeptOutIcon size={16} />}>{MIXED_SHORT}</StatusPill>
  ) : pnl.forcedIn ? <StatusPill>ברווח והפסד</StatusPill> : null;
  const pnlSplit = txn.pnl_role === "shared" || (txn.allocations?.length ?? 0) > 1;
  // FLOW-325 (plan Q9): the P&L reads the parts, not the line's own category and project.
  const lineSplitHint = lineSplitRowHint(lineSplit);
  // FLOW-329: ⋯ holds only delete, so it shows only on a manual line. ˄ ˅ keep their place without it.
  const canDelete = txn.source === "manual" && !holdWrites;
  const menuButton = canDelete
    ? <IconButton ref={moreRef} label="עוד" onClick={() => { setMenu(true); }}><MoreIcon /></IconButton>
    : <ReservedMenuSlot />;
  const pnlScope = linePnlHint(pnl, txn.category_name ?? "");
  const pnlHint = pnlScope == null ? undefined : `${pnlScope}${pnlSplit && !pnl.partsOut ? " כל הפרויקטים בשורה." : ""}`;
  // Like the פיצול section's rows: no link for the reviewer preview, a viewer, or a line with an open review.
  const reviewBlocked = txn.review_status === "open" && txn.review_reason !== "split_mismatch";
  const splitCategoryTo = onOpenSplit || holdWrites || reviewBlocked ? undefined : `/transactions/${txn.id}/split-category${search}`;
  // FLOW-329 design review: the row sits after the VAT line. A loan line, and a split whose parts
  // differ, are locked with one reason; a mixed split opens the split by category, where its parts are set.
  const pnlRow = loanLine ? (
    <ListRow variant="static" title="ברווח והפסד" icon={<LockIcon />} hint={loanSplitFlag || loanSplitView != null ? "לפי חלקי ההלוואה" : "תשלום הלוואה · נספר לפי הפיצול"} />
  ) : pnl.mixed ? (
    splitCategoryTo ? (
      <ListRow variant="item" href={splitCategoryTo} title="ברווח והפסד" icon={<LockIcon />} hint="לפי הקטגוריות בפיצול" label="ברווח והפסד, לפי הקטגוריות בפיצול, פיצול לפי קטגוריות" chevron />
    ) : (
      <ListRow variant="static" title="ברווח והפסד" icon={<LockIcon />} hint="לפי הקטגוריות בפיצול" />
    )
  ) : (
    // FLOW-329: one tap takes the line out of the P&L or brings it back.
    <Toggle
      label="ברווח והפסד"
      hint={pnlHint}
      icon={<ChartIcon />}
      checked={!pnl.out}
      disabled={holdWrites}
      busy={pnlLine.isPending}
      onChange={() => {
        if (holdWrites || pnlLine.isPending || (sample == null && blocked())) return;
        pnlLine.mutate({
          id: txn.id,
          party,
          override: pnl.next,
          previous: pnl.override,
          out: !pnl.out,
          undo: false,
        });
      }}
    />
  );
  return (
    <div>
      <ScreenHeader
        title={txn.direction === "income" ? "הכנסה" : "הוצאה"}
        size="compact"
        leading={<BackButton fallback={parent} />}
        trailing={nav ? (
          <div className="ui-txn-end">
            <TxnNavButtons nav={nav} />
            {menuButton}
          </div>
        ) : menuButton}
      />
      <div className="ui-page-pad">
        <p className="t-title-3 ui-party">{party}</p>
        <p className="t-display">
          <BigNumber
            agorot={absAgorot(txn.amount_net)}
            presentation="detail"
            currency={txn.currency}
            direction={txn.direction === "income" ? "income" : "expense"}
            income={txn.direction === "income"}
            size="display"
          />
        </p>
        <p className="t-hint">
          {vatShown ? "לפני מע״מ · " : null}
          <bdi dir="ltr">{invoiceDate(txn.doc_date)}</bdi>
        </p>
        {reviewLabel || paymentLabel || pnlPill ? (
          <div className="ui-status-row">
            {reviewLabel ? <StatusPill>{reviewLabel}</StatusPill> : null}
            {paymentLabel ? <StatusPill icon={paymentLabel === "שולם" ? <CheckIcon size={14} /> : undefined}>{paymentLabel}</StatusPill> : null}
            {pnlPill}
          </div>
        ) : null}
      </div>
      <List>
        {holdWrites ? (
          <ListRow variant="static" eyebrow="פרויקט" title={shownProject} icon={<ProjectsIcon />} hint={lineSplitHint} />
        ) : (
          <ListRow variant="button" buttonRef={projectRowRef} eyebrow="פרויקט" title={shownProject} icon={<ProjectsIcon />} hint={lineSplitHint} chevron onClick={() => {
            if (splitRow) {
              openSplit();
              return;
            }
            setChangeStart("project");
            setChangeSheet(true);
          }} />
        )}
        {/* FLOW-114: a matched loan payment shows its loan here instead, and its category is locked. */}
        <LoanCategoryRow transactionId={txn.id} split={txn.loan_split} direction={txn.direction} currency={txn.currency} active={sample == null} readOnly={holdWrites}>
          {holdWrites ? (
            <ListRow variant="static" eyebrow="קטגוריה" title={shownCategory} icon={<TagIcon />} tag={shownReversal ? <ReversalTag /> : undefined} hint={lineSplitHint} />
          ) : (
            <ListRow variant="button" buttonRef={categoryRowRef} eyebrow="קטגוריה" title={shownCategory} icon={<TagIcon />} tag={shownReversal ? <ReversalTag /> : undefined} hint={lineSplitHint} chevron onClick={() => {
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
      {vatShown && txn.vat_amount !== 0n ? (
        <p className="ui-page-pad t-hint">
          מע״מ <bdi dir="ltr">{formatMoney(txn.vat_amount, txn.currency, { agorot: true })}</bdi>
          {" · "}
          {vatStatusLabel(txn.vat_status)}
        </p>
      ) : null}
      <List>{pnlRow}</List>
      {lineMeta.isError && lineMeta.data == null ? (
        <LoanReadError label="פרטי הבנק" busy={lineMeta.isFetching} onRetry={() => { void lineMeta.refetch(); }} />
      ) : (
        <BankDetails meta={lineMeta.data} party={party} direction={txnDirection} />
      )}
      <LineSplitSection
        txn={txn}
        split={lineSplit}
        readOnly={holdWrites}
        categories={sample ? (sampleCategories ?? []) : (categories.data ?? [])}
        loanSplit={loanSplitFlag || loanSplitView != null}
        projectSplitTo={`/transactions/${txn.id}/split${search}`}
        onProjectSplit={onOpenSplit ? openSplit : undefined}
        categorySplitTo={onOpenSplit ? undefined : `/transactions/${txn.id}/split-category${search}`}
      />
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
    </div>
  );
}
