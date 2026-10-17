import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useId, useRef, useState, type Ref, type ReactNode } from "react";
import type { LoanKind } from "@flow/shared";
import { BackIcon } from "../ui/icons";
import { IconButton } from "../ui/icon-button";
import { Skeleton } from "../ui/skeleton";
import { Sheet } from "../ui/sheet";
import { useSheetHistory } from "../ui/back";
import { useToast } from "../ui/toast";
import { usePreviewSearch } from "../preview";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import { useOpenFromQuery } from "../open-from-query";
import { useHoldWrites } from "../use-is-viewer";
import {
  readCompanyLoanCurrency,
  type LoanCurrency,
  type LoanInsert,
} from "./loan-form";
import { groupLoans, useLoanList, type LoanListRow } from "./loan-list";
import { useLoanSummary } from "./loan-summary-entries";
import type { LoanListSummary } from "./loan-list-summary";
import { LoanProjectPicker, projectNameOf, type LoanProjectSource } from "./loan-project-picker";
import { LoanKindPicker, LoanSaveButton, LoanSetupForm, type LoanSetupInitial } from "./loan-setup";

/**
 * The new-loan sheet's panel: the form is a tall sheet (board: 780 of 844, so its top sits 64px down), the
 * kind view a choice sheet, and the project view keeps the sheet's own height.
 */
function sheetPanelClass(view: "form" | "project" | "kind"): string | undefined {
  if (view === "kind") return "ui-sheet-choice ui-sheet-g8 ui-sheet-wide";
  if (view === "form") return "ui-sheet-tall ui-sheet-wide ui-sheet-g14 ui-loan-new";
  return undefined;
}

/** Sample balances for stories and preview. Live omits it and reads `loans`. */
export type LoanRowsSample = readonly LoanListRow[] | "loading" | "error";

export const LOANS_EMPTY_TITLE = "אין הלוואות עדיין";
export const LOANS_EMPTY_OWNER = "הוסיפו הלוואה כדי לפצל כל תשלום לריבית, מסים וביטוח וקרן.";
export const LOANS_EMPTY_VIEWER = "כשיתווספו הלוואות הן יופיעו כאן.";
export const LOANS_ERROR_TITLE = "לא הצלחנו לטעון את ההלוואות";

/** What the Loans tab's list draws (LoansList in loans-list.tsx), with the host's reads and actions. */
export type LoansHostCtx = {
  rows: readonly LoanListRow[];
  loading: boolean;
  failed: boolean;
  /** No open loan: the empty state shows, with the closed group under it. */
  empty: boolean;
  summary: ReturnType<typeof useLoanSummary>;
  currency: LoanCurrency | null;
  holdWrites: boolean;
  /** A background refresh of the list is running. */
  retrying: boolean;
  retry: () => void;
  /** Opens the new-loan sheet (הלוואה חדשה). */
  openNew: () => void;
  newRef: Ref<HTMLButtonElement>;
  emptyRef: Ref<HTMLButtonElement>;
  /** Opens one loan's page. */
  openLoan: (id: string) => void;
};

/**
 * The Loans tab's data and the new-loan sheet (FLOW-139b). The list is the render prop: the screen
 * draws it from `ctx`, and the sheet and everything it saves stay here. A viewer gets no new-loan
 * action (U10). A row opens the loan's page under /loans, or /e2e/loans in the dev fixture.
 */
export function LoansHost({
  companyId,
  companyCurrency,
  blocked,
  projects,
  sample,
  summary: sampleSummary,
  openNew = false,
  newLoan,
  children,
}: {
  companyId: string | null;
  /** Preview passes this. Live omits it and reads the company's lines. */
  companyCurrency?: LoanCurrency;
  blocked?: () => boolean;
  /** FLOW-119. The projects the loan can sit under. */
  projects?: LoanProjectSource;
  sample?: LoanRowsSample;
  /** A sample's summary card (the dev fixture and stories); live reads the company's loans. */
  summary?: LoanListSummary;
  /** The dev fixture's proof: the new-loan sheet opens once it has drawn, with `newLoan` typed in. */
  openNew?: boolean;
  newLoan?: LoanSetupInitial;
  children: (ctx: LoansHostCtx) => ReactNode;
}) {
  const source: LoanProjectSource = projects ?? { rows: [] };
  const navigate = useNavigate();
  const location = useLocation();
  const search = usePreviewSearch();
  const toast = useToast();
  const savedId = useRef<string | null>(null);
  // The loan's page sits under the tab: /loans/:id, or /e2e/loans/:id in the dev fixture.
  // The first segment is "loans", or the dev fixture's prefix (built here, so no fixture path ships in the build).
  const first = location.pathname.split("/")[1] ?? "";
  const base = first === "loans" ? "/loans" : `/${first}/loans`;
  const loanHref = (id: string) => `${base}/${encodeURIComponent(id)}${search}`;
  const [open, setOpenState] = useState(false);
  const [view, setView] = useState<"form" | "project" | "kind">("form");
  const [draftProject, setDraftProject] = useState<string | null>(null);
  const [draftKind, setDraftKind] = useState<LoanKind>("amortizing");
  // The picker keeps the form's height, so the sheet does not jump when they swap.
  const [formHeight, setFormHeight] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const projectFieldRef = useRef<HTMLButtonElement>(null);
  const kindFieldRef = useRef<HTMLButtonElement>(null);
  const sheetTitle = useRef<HTMLHeadingElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const loanFormId = useId();
  const posted = useRef(false);
  const draftRef = useRef<LoanSetupInitial | null>(newLoan ?? null);
  const openedForProof = useRef(false);
  const keepDraft = useRef(false);
  const clearDraft = useCallback(() => {
    keepDraft.current = false;
    draftRef.current = null;
    setDraftProject(null);
    setDraftKind("amortizing");
    setView("form");
  }, []);
  const setOpen = useCallback((next: boolean) => {
    if (!next) clearDraft();
    setOpenState(next);
  }, [clearDraft]);
  // Back in the picker view returns to the form, like Escape and חזרה.
  const adoptNew = useRef(false);
  const setSheet = useSheetHistory("loan-new", open, setOpen, () => {
    // FLOW-115: Back during a save waits for it, like ✕ and Escape (0075).
    if (posted.current) return false;
    if (view === "form") return true;
    backToForm();
    return false;
  }, adoptNew);
  const balances = useLoanList(sample == null ? companyId : null);
  const holdWrites = useHoldWrites();
  const emptyButton = useRef<HTMLButtonElement>(null);
  const query = useQuery({
    queryKey: ["loan-currency", companyId],
    enabled: companyCurrency == null && companyId != null,
    retry: false,
    queryFn: readCompanyLoanCurrency,
  });
  const currency: LoanCurrency | null = companyCurrency
    ?? query.data
    ?? (query.isFetched || companyId == null ? "ILS" : null);
  // FLOW-139: the summary card reads each loan's outlook, the same figures the loan page shows.
  const liveSummary = useLoanSummary(sample == null ? companyId : null, currency);
  const summary = sampleSummary ?? liveSummary;
  const save = useWrite<Omit<LoanInsert, "company_id">>({
    failure: (error) => {
      const code = (error as { code?: string }).code;
      if (code === "42501") return "אין הרשאה לשמור הלוואה.";
      if (code === "23503") return "הפרויקט לא נמצא.";
      return "לא הצלחנו לשמור את ההלוואה.";
    },
    keys: ["loans", "project"],
    onSuccess: () => {
      posted.current = false;
      clearDraft();
      setSheet(false);
      const id = savedId.current;
      // FLOW-106 B: the toast opens the new loan's page, where its categories are set.
      toast.show({
        message: "ההלוואה נשמרה",
        ...(id == null ? {} : { action: "פתיחה", onAction: () => { void navigate(loanHref(id)); } }),
      });
    },
    run: async (row) => {
      if (holdWrites) throw new Error("preview");
      const supabase = getSupabase();
      if (!supabase || companyId == null) throw new Error("supabase");
      savedId.current = null;
      const inserted = await supabase.from("loans").insert({ ...row, company_id: companyId }).select("id").single();
      assertNoError(inserted);
      savedId.current = typeof inserted.data?.id === "string" ? inserted.data.id : null;
    },
  });

  function setLoanSheet(next: boolean) {
    if (next && holdWrites) return;
    if (next) keepDraft.current = true;
    else clearDraft();
    setSheet(next);
  }

  // The dev fixture's ?sheet=new: the same open as ?new=loan, once the list has drawn.
  useEffect(() => {
    if (!openNew || openedForProof.current || holdWrites || currency == null) return;
    openedForProof.current = true;
    setLoanSheet(true);
  }, [openNew, holdWrites, currency, setLoanSheet]);

  // FLOW-331: + → הלוואה חדשה lands on /loans with ?new=loan.
  useOpenFromQuery("loan", !holdWrites && currency != null, (sameEntry) => {
    adoptNew.current = sameEntry;
    setLoanSheet(true);
  });

  function openPicker(next: "project" | "kind" = "project") {
    setFormHeight(formRef.current?.offsetHeight ?? null);
    setView(next);
    // The פרויקט field is hidden now. Focus the title, like the change sheet's picker.
    requestAnimationFrame(() => { sheetTitle.current?.focus({ preventScroll: true }); });
  }

  function backToForm() {
    const field = view === "kind" ? kindFieldRef : projectFieldRef;
    setView("form");
    requestAnimationFrame(() => { field.current?.focus({ preventScroll: true }); });
  }

  const picking = view !== "form";
  const loading = sample === "loading" || (sample == null && balances.isLoading);
  const failed = sample === "error" || (sample == null && balances.isError);
  const rows: readonly LoanListRow[] = Array.isArray(sample) ? sample : sample == null ? (balances.data ?? []) : [];
  // Only closed loans: the empty state shows, with "הלוואות שנסגרו (N)" under it (§3.1).
  const empty = !loading && !failed && groupLoans(rows).open.length === 0;
  const newLoanReturn = empty ? emptyButton : newButton;

  return (
    <>
      {children({
        rows,
        loading,
        failed,
        empty,
        summary,
        currency,
        holdWrites,
        retrying: sample == null && balances.isFetching,
        retry: () => { if (sample == null) void balances.refetch(); },
        openNew: () => { setLoanSheet(true); },
        newRef: newButton,
        emptyRef: emptyButton,
        openLoan: (id) => { void navigate(loanHref(id)); },
      })}
      <Sheet
        open={holdWrites ? false : open}
        onOpenChange={setLoanSheet}
        title={view === "kind" ? "סוג ההלוואה" : picking ? "פרויקט" : "הלוואה חדשה"}
        panelClassName={sheetPanelClass(view)}
        titleRef={sheetTitle}
        returnFocusRef={newLoanReturn}
        leading={picking ? (
          <IconButton label="חזרה" className="ui-back-btn" onClick={backToForm}>
            <BackIcon />
          </IconButton>
        ) : undefined}
        onEscape={picking ? backToForm : undefined}
        onBeforeClose={() => !posted.current}
        action={currency == null || picking ? undefined : (
          <LoanSaveButton formId={loanFormId} busy={save.isPending} buttonRef={saveButton} />
        )}
      >
        {currency == null ? (
          // FLOW-115: the form's shape while the currency read lands, so the sheet does not jump.
          <div className="ui-stack ui-loan-skeleton" aria-busy="true">
            <p className="sr-only" role="status">טוען…</p>
            <div className="ui-loan-skel-field" key="a">
              <Skeleton width="sm" />
              <Skeleton className="ui-loan-skel-control" />
            </div>
            <div className="ui-loan-skel-field" key="b">
              <Skeleton width="sm" />
              <Skeleton className="ui-loan-skel-control" />
            </div>
            <div className="ui-loan-skel-field" key="c">
              <Skeleton width="sm" />
              <Skeleton className="ui-loan-skel-control" />
            </div>
            <div className="ui-loan-skel-field" key="d">
              <Skeleton width="sm" />
              <Skeleton className="ui-loan-skel-control" />
            </div>
          </div>
        ) : (
          <>
            {view === "kind" ? (
              <div style={formHeight ? { minHeight: formHeight } : undefined}>
                <LoanKindPicker
                  selected={draftKind}
                  onSelect={(next) => {
                    setDraftKind(next);
                    backToForm();
                  }}
                />
              </div>
            ) : null}
            {view === "project" ? (
              <div style={formHeight ? { minHeight: formHeight } : undefined}>
                <LoanProjectPicker
                  source={source}
                  selectedId={draftProject}
                  onSelect={(id) => {
                    setDraftProject(id);
                    backToForm();
                  }}
                />
              </div>
            ) : null}
            <div hidden={picking} ref={formRef}>
              <LoanSetupForm
                companyCurrency={currency}
                initial={draftRef.current ?? undefined}
                busy={save.isPending}
                formId={loanFormId}
                saveInFoot
                keepDraft={keepDraft}
                onDraft={(next) => { draftRef.current = next; }}
                project={{
                  name: projectNameOf(source, draftProject),
                  buttonRef: projectFieldRef,
                  onOpen: () => { openPicker("project"); },
                }}
                kind={{
                  value: draftKind,
                  buttonRef: kindFieldRef,
                  onOpen: () => { openPicker("kind"); },
                }}
                onSave={(row) => {
                  if (holdWrites || blocked?.()) return;
                  if (posted.current || save.isPending) return;
                  posted.current = true;
                  save.mutate({ ...row, project_id: draftProject }, {
                    onError: (error) => {
                      if ((error as { code?: string }).code === "23503") setDraftProject(null);
                      saveButton.current?.focus();
                    },
                    onSettled: () => { posted.current = false; },
                  });
                }}
              />
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}
