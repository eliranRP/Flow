import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { allocateLoanSplitWithFees, type LoanSplitPart, type TransactionLoanSplit } from "@flow/shared";
import { parseShekelInput } from "@flow/shared";
import { AlertIcon, BankIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { LoanPartsSheet, loanPartsCount, loanPaymentTitle, type LoanPartField } from "../ui/loan-parts-sheet";
import { useSheetHistory } from "../ui/back";
import { useToast } from "../ui/toast";
import { useWrite } from "../use-write";
import { minorToInput } from "./loan-form";
import { LOAN_AMOUNT_CHANGED_HINT, LOAN_BUSY_HINT, LOAN_ROW_CLASS_NAME, showMoney, useLoanMatchRead } from "./loan-match";
import {
  LOAN_WRITE_KEYS,
  isAlreadyUnmatched,
  loanClearFailureText,
  loanSaveFailureText,
  partsFromCleared,
  splitFromLoaded,
  useLoanMatchContext,
  useLoanSplitView,
  type ClearedSplit,
  type SavePart,
  type StoredSplit,
} from "./loan-match-api";

type Draft = Partial<Record<LoanSplitPart, string>>;

/** The matched row's class. A new match moves focus to it (FLOW-114). */
const LOAN_ROW_CLASS = LOAN_ROW_CLASS_NAME;

function draftOf(parts: ReadonlyArray<{ part: LoanSplitPart; amountMinor: bigint }>): Draft {
  const draft: Draft = {};
  for (const part of parts) draft[part.part] = minorToInput(part.amountMinor);
  return draft;
}

function minorOf(raw: string | undefined): bigint | null {
  if (raw == null || raw.trim() === "") return null;
  try {
    const minor = parseShekelInput(raw);
    return minor < 0n ? null : minor;
  } catch {
    return null;
  }
}

/**
 * A matched payment whose parts no longer add up to the line (a re-synced amount) opens with the
 * schedule's split of the new amount; the fees keep their amount (decision 0130).
 */
function correctedDraft(stored: StoredSplit): Draft | null {
  const sum = stored.parts.reduce((total, part) => total + part.amountMinor, 0n);
  if (sum === stored.lineMinor) return null;
  const scheduled = { interestMinor: 0n, escrowMinor: 0n, principalMinor: 0n };
  let feesMinor = 0n;
  for (const part of stored.parts) {
    if (part.part === "interest") scheduled.interestMinor = part.scheduledMinor;
    if (part.part === "escrow") scheduled.escrowMinor = part.scheduledMinor;
    if (part.part === "principal") scheduled.principalMinor = part.scheduledMinor;
    if (part.part === "fees") feesMinor = part.amountMinor;
  }
  const next = allocateLoanSplitWithFees({ lineMinor: stored.lineMinor, feesMinor, ...scheduled });
  return next == null ? null : draftOf(next);
}

/**
 * FLOW-114 option B. On a payment matched to a loan, the category row is one row:
 * "תשלום הלוואה · <loan>" with "N חלקים" under it. It opens the split sheet, which saves the parts
 * with one save_loan_split and unmatches with clear_loan_split (undo re-matches the same parts).
 * The category can't be changed while the line is matched (decision 0136). Any other line shows
 * its own category row, passed as children.
 */
export function LoanCategoryRow({
  transactionId,
  split: serverSplit,
  direction,
  active,
  readOnly,
  currency: lineCurrency,
  children,
}: {
  transactionId: string;
  /** get_transaction's loan_split. Undefined when the server did not send it. */
  split: TransactionLoanSplit | null | undefined;
  direction: string;
  /** False on a sample card (unless a story provides a sample loan match). */
  active: boolean;
  /** A viewer, or a role still loading: the row opens the parts read-only, with no writes. */
  readOnly: boolean;
  /** The line's currency, until the stored parts say the loan's. */
  currency?: string | null;
  /** The ordinary category row. */
  children: ReactNode;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { api, sample } = useLoanMatchContext();
  const view = useLoanSplitView(serverSplit);
  const on = (active || sample != null) && direction !== "income";
  const fallback = useLoanMatchRead(transactionId, view, on && view === undefined);
  const split = view !== undefined ? view : splitFromLoaded(fallback.data);
  const rowRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const setSheet = useSheetHistory("loan-split", open, setOpen);
  // The split the sheet opened on, so it closes cleanly once an unmatch takes the row away.
  const [shown, setShown] = useState<TransactionLoanSplit | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const touched = useRef(false);
  // Each open runs the needs-review correction again, even on cached stored parts.
  const [opens, setOpens] = useState(0);
  const stored = useQuery({
    queryKey: ["loan-split", "stored", transactionId],
    enabled: open && !readOnly,
    retry: false,
    staleTime: 0,
    queryFn: () => api.readStored(transactionId),
  });
  useEffect(() => {
    const read = stored.data;
    if (read == null || touched.current || !read.parts.some((part) => part.needsReview)) return;
    const corrected = correctedDraft(read);
    if (corrected) setDraft(corrected);
  }, [stored.data, stored.dataUpdatedAt, opens]);
  const save = useWrite<SavePart[]>({
    failure: (error) => loanSaveFailureText(error),
    success: "הפיצול נשמר",
    keys: LOAN_WRITE_KEYS,
    onSuccess: () => { setSheet(false); },
    run: async (parts) => {
      if (readOnly || shown == null) throw new Error("preview");
      await api.save(transactionId, shown.loan_id, parts);
    },
  });
  const rematch = useWrite<ClearedSplit>({
    failure: (error) => loanSaveFailureText(error, "לא הצלחנו להחזיר את השיוך."),
    success: "השיוך חזר",
    keys: LOAN_WRITE_KEYS,
    run: async (cleared) => {
      if (readOnly) throw new Error("preview");
      await api.save(transactionId, cleared.loanId, partsFromCleared(cleared, clearedLine.current));
    },
  });
  const cleared = useRef<ClearedSplit | null>(null);
  const clearedLine = useRef<bigint | null>(null);
  // One undo per toast, however fast the taps (a retry toast handles a failure).
  const undoSent = useRef(false);
  const unmatch = useWrite({
    failure: loanClearFailureText,
    silent: isAlreadyUnmatched,
    keys: LOAN_WRITE_KEYS,
    onSuccess: () => {
      setSheet(false);
      const removed = cleared.current;
      if (removed == null) return;
      // Decision 0136: the line keeps its project and category and counts whole again.
      undoSent.current = false;
      toast.show({
        message: "השיוך בוטל",
        action: "ביטול",
        onAction: () => {
          if (undoSent.current) return;
          undoSent.current = true;
          rematch.mutate(removed);
        },
      });
    },
    run: async () => {
      if (readOnly) throw new Error("preview");
      clearedLine.current = stored.data?.lineMinor ?? null;
      cleared.current = await api.clear(transactionId);
    },
  });
  if (!on) return <>{children}</>;
  // The sheet stays mounted while it closes, after an unmatch has already taken the row away.
  const sheetSplit = split ?? shown;
  if (sheetSplit == null) return <>{children}</>;
  const reviewWaits = sheetSplit.needs_review === true;
  const title = loanPaymentTitle(sheetSplit.loan_name);
  const count = loanPartsCount(sheetSplit.parts.length);
  const rowProps = {
    eyebrow: "קטגוריה",
    title,
    hint: reviewWaits ? "ממתין לבדיקה" : count,
    icon: reviewWaits ? <AlertIcon /> : <BankIcon />,
    tone: reviewWaits ? ("warning" as const) : undefined,
  };
  const editing = shown ?? sheetSplit;
  if (readOnly) {
    if (split == null) return <>{children}</>;
    // Screen 11a: a viewer reads the parts, with no fields and no writes.
    const viewCurrency = lineCurrency ?? "ILS";
    const viewTotal = editing.parts.reduce((sum, part) => sum + part.amount_minor, 0n);
    return (
      <>
        <ListRow variant="button" {...rowProps} chevron buttonRef={rowRef} label={`${title}, ${reviewWaits ? "ממתין לבדיקה" : count}, פיצול`} onClick={() => { setShown(split); setSheet(true); }} />
        <LoanPartsSheet
          readOnly
          open={open}
          onOpenChange={(next) => { setSheet(next); }}
          title={editing.loan_name ?? "הלוואה"}
          fields={editing.parts.map((part) => ({ part: part.part, value: showMoney(part.amount_minor, viewCurrency) }))}
          total={showMoney(viewTotal, viewCurrency)}
          returnFocusRef={rowRef}
        />
      </>
    );
  }
  const storedData = stored.data;
  const currency = storedData?.loanCurrency ?? storedData?.currency ?? null;
  const fields: LoanPartField[] = editing.parts.map((part) => ({ part: part.part, value: draft[part.part] ?? "" }));
  const amounts = fields.map((field) => minorOf(field.value));
  const totalMinor = amounts.reduce<bigint>((sum, minor) => sum + (minor ?? 0n), 0n);
  const shownCurrency = currency ?? lineCurrency ?? "ILS";
  const lineMinor = storedData?.lineMinor ?? null;
  const currencyMismatch = storedData != null && storedData.loanCurrency != null && storedData.loanCurrency !== storedData.currency;
  const feesIndex = fields.findIndex((field) => field.part === "fees");
  const problem = stored.isError
    ? "לא הצלחנו לטעון את הפיצול."
    : amounts.some((minor) => minor == null)
    ? "חסר סכום."
    : feesIndex >= 0 && amounts[feesIndex] === 0n
      ? "חסר סכום עמלות."
      : lineMinor != null && totalMinor !== lineMinor
        ? <>הסה״כ צריך להיות <bdi className="ui-num" dir="ltr">{showMoney(lineMinor, shownCurrency)}</bdi>.</>
        : currencyMismatch
          ? "המטבע של השורה לא מתאים להלוואה."
          : undefined;
  const amountChanged = storedData != null
    && storedData.parts.reduce((sum, part) => sum + part.amountMinor, 0n) !== storedData.lineMinor;
  const note = reviewWaits ? (amountChanged ? LOAN_AMOUNT_CHANGED_HINT : LOAN_BUSY_HINT) : undefined;
  const canSave = problem == null && storedData != null && !save.isPending && !unmatch.isPending;
  function openSheet() {
    if (split == null) return;
    touched.current = false;
    setShown(split);
    setOpens((count) => count + 1);
    setDraft(draftOf(split.parts.map((part) => ({ part: part.part, amountMinor: part.amount_minor }))));
    setSheet(true);
  }
  return (
    <>
      {split == null ? children : (
        <ListRow
          variant="button"
          {...rowProps}
          className={LOAN_ROW_CLASS}
          chevron
          buttonRef={rowRef}
          label={`${title}, ${reviewWaits ? "ממתין לבדיקה" : count}, פיצול`}
          onClick={openSheet}
        />
      )}
      <LoanPartsSheet
        open={open}
        onOpenChange={(next) => {
          setSheet(next);
          if (!next) setShown(null);
        }}
        title={editing.loan_name ?? "הלוואה"}
        fields={fields}
        onFieldChange={(part, raw) => {
          touched.current = true;
          setDraft((current) => ({ ...current, [part]: raw }));
        }}
        prefix={shownCurrency === "USD" ? "$" : "₪"}
        total={showMoney(totalMinor, shownCurrency)}
        problem={problem}
        note={note}
        loading={stored.isLoading}
        saving={save.isPending}
        unmatching={unmatch.isPending}
        canSave={canSave}
        returnFocusRef={rowRef}
        onRetry={stored.isError ? () => { void stored.refetch(); } : undefined}
        onSave={() => {
          if (!canSave) return;
          const parts = fields.map((field, index): SavePart => {
            const before = storedData.parts.find((part) => part.part === field.part);
            return {
              part: field.part,
              amount_minor: Number(amounts[index] ?? 0n),
              scheduled_minor: Number(before?.scheduledMinor ?? 0n),
              ...(field.part === "fees" && before?.categoryId ? { category_id: before.categoryId } : {}),
            };
          });
          save.mutate(parts);
        }}
        onUnmatch={() => {
          if (unmatch.isPending || save.isPending) return;
          unmatch.mutate(undefined, {
            onError: (error) => {
              if (!isAlreadyUnmatched(error)) return;
              // Unmatched elsewhere meanwhile: close and show the card as it is now.
              setSheet(false);
              void Promise.all(LOAN_WRITE_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
            },
          });
        }}
      />
    </>
  );
}
