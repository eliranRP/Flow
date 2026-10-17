import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  equalSplitParts,
  newPartKey,
  pairKey,
  percentMinorOf,
  percentOf,
  percentText,
  resolvePreview,
  reversalNeedsProject,
  shareOfLine,
  writeLineDraft,
  type LineContext,
  type LineSplitRead,
  type PartDraft,
  type PayloadPart,
  type RestDraft,
  type ServerPart,
} from "../line-split";
import { LINE_SPLIT_PARTS_CHANGED, LINE_SPLIT_PLACE, LINE_SPLIT_SAVE_FAILURE, PART_FILL_AMOUNT, PART_PICK_PROJECT, PART_TWICE, lineSplitCopy, lineSplitRefusal, localIssueCopy, type LineSplitRefusal } from "../line-split-copy";
import { usePreviewSearch } from "../preview";
import { reviewFocusPath } from "../review-paths";
import { isReversal, reversalChoices, type KindedCategory } from "../reversal";
import { useInvalidateBooks } from "../use-books";
import { assertNoError } from "../use-write";
import { useGoBack } from "../ui/back";
import { Banner } from "../ui/banner";
import { Amount as AmountFigure } from "../ui/amount";
import { ChangeAssignment, type ChangeChoice } from "../ui/change-sheet";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { HoldLine } from "../ui/hold-line";
import { IconButton } from "../ui/icon-button";
import { AlertIcon, CloseIcon, PlusIcon } from "../ui/icons";
import { MoneyField, PercentField } from "../ui/money-field";
import { ReversalTag } from "../ui/suggest-tag";
import { SwipeRow } from "../ui/swipe-row";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import {
  Amount,
  LINE_SPLIT_KEYS,
  LINE_SPLIT_MAX_PARTS,
  SplitUnitToggle,
  type LineInfo,
  type LineSplitApi,
  money,
  partProjectLabel,
} from "./line-split-parts";
import { listenPopState, useSaveOnBack } from "./split-back";

type PickTarget = { kind: "part"; key: string } | { kind: "rest" };

type PreviewState = { key: string; parts: ServerPart[] } | { key: string; error: unknown };

function sameDraft(left: { parts: PartDraft[]; rest: RestDraft }, right: { parts: PartDraft[]; rest: RestDraft }): boolean {
  const shape = (draft: { parts: PartDraft[]; rest: RestDraft }) => JSON.stringify({
    parts: draft.parts.map((part) => [part.categoryId, part.projectId, part.unit, part.value.trim()]),
    rest: draft.rest,
  });
  return shape(left) === shape(right);
}

export function LineSplitEditor({
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
  initialTarget,
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
  /** The part picker open on load (the board's SplitPicker frame). */
  initialTarget?: { partKey: string; kind: "project" | "category" };
}) {
  const toast = useToast();
  const goBack = useGoBack();
  const invalidate = useInvalidateBooks();
  const search = usePreviewSearch();
  const [parts, setParts] = useState<PartDraft[]>(initial.parts);
  const [rest, setRest] = useState<RestDraft>(initial.rest);
  const [baseline] = useState(() => draftFromRead(split, line.categoryId));
  const [target, setTarget] = useState<PickTarget | null>(initialTarget ? { kind: "part", key: initialTarget.partKey } : null);
  const [pickerStart, setPickerStart] = useState<"category" | "project">(initialTarget?.kind ?? "category");
  const [warned, setWarned] = useState(initialWarned);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const [lastEdited, setLastEdited] = useState<string | null>(null);
  /** FLOW-333 C3b: a new part takes the unit of the last part typed. */
  const [typedUnit, setTypedUnit] = useState<PartDraft["unit"]>(() => initial.parts.at(-1)?.unit ?? "amount");
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [serverError, setServerError] = useState<{ reason: LineSplitRefusal; key: string | null } | null>(
    initialError ? { reason: initialError, key: null } : null,
  );
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
  const keptOutIds = useMemo(() => new Set(categories.filter((category) => category.excluded_from_pnl === true).map((category) => category.id)), [categories]);
  const ctx: LineContext = {
    lineMinor,
    lineCategoryId: line.categoryId,
    lineProjectId: line.projectId,
    isReversal: partIsReversal,
    keptOut: (categoryId: string) => keptOutIds.has(categoryId),
    lineInPnl: line.inPnl === true,
  };
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

  /** The part's ✕, or a swipe toward the start side (FLOW-325 §10). */
  function removePart(key: string) {
    setParts((list) => list.filter((item) => item.key !== key));
    setLastEdited(null);
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
      message: kind === "clear" ? "הפיצול הוסר" : "הפיצול נשמר",
      ...(undoable ? {
        action: "ביטול",
        onAction: () => { void undoTo(previous, kind === "clear" ? "הפיצול חזר" : "הפיצול הקודם חזר"); },
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

  useSaveOnBack({ dirty, busy, leave, leaving, listen: listenPopState });

  const categoryName = (id: string | null) => (id == null ? line.categoryName : categories.find((category) => category.id === id)?.name ?? null);
  const projectName = (id: string | null) => (id == null ? null : projects.find((project) => project.id === id)?.name ?? null);

  const targetPart = target?.kind === "part" ? parts.find((part) => part.key === target.key) : undefined;
  const pickerCategory = target?.kind === "rest" ? (rest.categoryId ?? line.categoryId ?? "") : (targetPart?.categoryId ?? "");
  const pickerProject = target?.kind === "rest" ? (rest.projectId ?? "") : (targetPart?.projectId ?? "");
  // A reversal part needs its own project unless its category is kept out of the P&L on a line
  // not forced in (0138); only then is the "no project" row withheld (FLOW-325, #189 review).
  const pickerReversal = target?.kind === "part" && targetPart != null && targetPart.categoryId !== "" && reversalNeedsProject(targetPart.categoryId, ctx);
  const ownCategories: ChangeChoice[] = categories
    .filter((category) => category.kind != null && (line.direction === "income" ? category.kind === "income" : category.kind !== "income"))
    .filter((category) => category.hidden !== true || category.id === line.categoryId)
    .map((category) => ({ id: category.id, name: category.name }));
  // A part's own category stays listed even when kept out, so its project can be changed without losing it.
  const reversals: ChangeChoice[] = target?.kind === "rest" ? [] : reversalChoices(categories, line.direction, targetPart?.categoryId || line.categoryId);
  // FLOW-333 C9: unless a project is required, the top row already stands for the line's project.
  const pickerProjects = pickerReversal || line.projectId == null ? projects : projects.filter((project) => project.id !== line.projectId);
  const pickerProjectId = !pickerReversal && pickerProject === line.projectId ? "" : pickerProject;

  function openPicker(next: PickTarget, start: "category" | "project", opener: HTMLElement | null) {
    if (busy || blocked) return;
    pickerOpener.current = opener;
    setPickerStart(start);
    setTarget(next);
  }

  function pickCategory(id: string) {
    if (target?.kind === "rest") {
      setRest((value) => ({ ...value, categoryId: id === line.categoryId ? null : id }));
      return;
    }
    if (target?.kind === "part") update(target.key, { categoryId: id });
  }

  /** FLOW-333 C3a: a part's picker hands focus to its value field, so the next tap types. */
  function closePicker() {
    if (target?.kind === "part") {
      const part = parts.find((item) => item.key === target.key);
      const field = part ? document.getElementById(`lsplit-${part.unit === "percent" ? "pct" : "amt"}-${part.key}`) : null;
      if (field) pickerOpener.current = field;
    }
    setTarget(null);
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
  // FLOW-333 C5: only after the first ✕; the part's own line then drops the same sentence.
  const showHold = holdText != null && warned;
  const holdOnPart = reason != null && LINE_SPLIT_PLACE[reason] !== "banner"
    ? reason === "a reversal part needs a project"
    : check.overMinor === 0n && !restNoCategory && formIssue === "a reversal part needs a project";
  // Only while a part's red line says it; a server refusal with no such part keeps the sentence visible.
  const holdShownOnPart = holdOnPart && parts.some((part) => check.parts[part.key] === "a reversal part needs a project");
  const holdIsOver = showHold && (reason == null || LINE_SPLIT_PLACE[reason] === "banner") && check.overMinor > 0n;
  const bannerReason = reason != null && LINE_SPLIT_PLACE[reason] === "banner" ? reason
    : line.amountNet === 0n ? "line amount is zero"
      : line.loanSplit ? "line has a loan split"
        : line.reviewBlocked ? "line has an open review" : null;

  const dateShort = line.docDate ? `${line.docDate.slice(8, 10)}/${line.docDate.slice(5, 7)}` : "";
  const meta = [line.direction === "income" && line.categoryId != null && isReversal(categories, line.categoryId, "income") ? "החזר" : null, line.supplier, dateShort, line.categoryName].filter(Boolean);
  const restCategory = categoryName(rest.categoryId);
  const restProject = rest.projectId == null ? (line.projectName ?? "בלי פרויקט") : (projectName(rest.projectId) ?? "פרויקט");
  const restDuplicate = check.restDuplicate;
  const restReason = reason != null && LINE_SPLIT_PLACE[reason] === "rest" ? reason : restNoCategory ? "line has no category for the rest" : null;
  const restMessage = restReason != null ? lineSplitCopy(restReason) : restDuplicate ? lineSplitCopy("same category and project twice") : null;
  const restMessageId = "lsplit-rest-msg";
  /** What the rest shows: never negative; an overshoot shows $0. */
  const restShown: bigint | null = restMinor == null ? null : restMinor < 0n ? 0n : restMinor;
  const splitShown: bigint | null = check.overMinor > 0n ? lineMinor + check.overMinor : splitMinor;
  const fillPercent = check.overMinor > 0n ? 100 : splitShown != null && lineMinor > 0n ? Math.min(100, Number((splitShown * 10_000n) / lineMinor) / 100) : 0;
  const saveCount = parts.length + (restShown != null && restShown > 0n ? 1 : 0);

  /** "+ חלק נוסף": a part on the line's category and no project, for what is left (no picker). */
  function addPart() {
    const key = newPartKey();
    const left = restMinor != null && restMinor > 0n ? amountText(restMinor) : "";
    setParts((list) => [...list, { key, categoryId: line.categoryId ?? "", projectId: null, unit: "amount", value: left }]);
    setLastEdited(key);
    setTypedUnit("amount");
  }

  /**
   * חלוקה שווה: an empty split gets two parts (the first on another project of the list, the
   * last takes the cents); a split with parts gets one share for every part and the rest.
   */
  function splitEqually() {
    if (parts.length === 0) {
      const other = projects.find((project) => project.id !== line.projectId);
      setParts(equalSplitParts(lineMinor, line.categoryId ?? "", other?.id ?? null));
      setTypedUnit("amount");
      setLastEdited(null);
      return;
    }
    const shares = BigInt(parts.length + 1);
    const share = lineMinor / shares;
    if (share === 0n) return;
    const cents = lineMinor - share * shares;
    setParts((list) => list.map((part, index) => ({
      ...part,
      unit: "amount",
      value: amountText(index === list.length - 1 ? share + cents : share),
    })));
    setTypedUnit("amount");
    setLastEdited(null);
  }

  const statusNode: ReactNode = check.overMinor > 0n
    ? <>{"חולק יותר מהסכום ב־"}<Amount minor={check.overMinor} currency={currency} /></>
    : parts.length === 0
      ? "הוסיפו חלק כדי לפצל. מה שלא פוצל נשאר בשורה."
      : <>{"חולק "}{splitShown == null ? "…" : <Amount minor={splitShown} currency={currency} />}{" · נשאר "}{restShown == null ? "…" : <Amount minor={restShown} currency={currency} />}</>;

  return (
    <>
      <form
        className="ui-split ui-lsplit ui-lsplit-board"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void leave();
        }}
      >
        {/* FLOW-370: the fixed top box of the board's Split frame. */}
        <header className="ui-lsplit-top">
          <div className="ui-lsplit-top-row">
            <IconButton label="סגירה" disabled={sampleSaving} onClick={() => { void leave(); }}><CloseIcon /></IconButton>
            <h1 className="ui-lsplit-top-title">פיצול</h1>
            <span className="ui-lsplit-top-spacer" aria-hidden="true" />
          </div>
          <div className="ui-lsplit-line">
            {meta.length > 0 ? (
              <p className="ui-lsplit-meta">
                {meta.map((item, index) => (
                  <span key={item}>
                    {index > 0 ? " · " : null}
                    {item === dateShort ? <bdi dir="ltr">{item}</bdi> : item}
                  </span>
                ))}
              </p>
            ) : null}
            <p className="ui-lsplit-amount">
              {line.direction === "income" ? <span className="sr-only">הכנסה </span> : null}
              <AmountFigure agorot={line.direction === "income" ? lineMinor : -lineMinor} presentation="detail" currency={currency} income={line.direction === "income"} />
            </p>
          </div>
          <div className="ui-lsplit-bar" aria-hidden="true">
            <span className={check.overMinor > 0n ? "ui-lsplit-fill ui-lsplit-fill-over" : "ui-lsplit-fill"} style={{ inlineSize: `${String(fillPercent)}%` }} />
          </div>
          <p className="ui-lsplit-status" aria-live="polite">{statusNode}</p>
        </header>
        {bannerReason ? (
          <div className="ui-lsplit-banner">
            <Banner
              icon={<AlertIcon />}
              title={lineSplitCopy(bannerReason)}
              hint={bannerReason === "line has an open review" ? <TextLink to={line.reviewId ? reviewFocusPath(search, line.reviewId) : `/review${search}`}>לתור</TextLink> : undefined}
            />
          </div>
        ) : split?.partsMatch === false ? (
          <div className="ui-lsplit-banner">
            <Banner icon={<AlertIcon />} title={LINE_SPLIT_PARTS_CHANGED} />
          </div>
        ) : null}
        <fieldset className="ui-split-body ui-lsplit-body" disabled={busy || blocked}>
          {parts.map((part, index) => {
            const name = categoryName(part.categoryId) ?? "בחירת קטגוריה";
            const reversal = part.categoryId !== "" && partIsReversal(part.categoryId);
            const issue = check.parts[part.key];
            const needsProject = issue === "a reversal part needs a project";
            const project = part.projectId == null ? (reversal && reversalNeedsProject(part.categoryId, ctx) ? "פרויקט · חובה בהחזר" : partProjectLabel(null, line.projectName)) : (projectName(part.projectId) ?? "פרויקט");
            const percent = part.unit === "percent" ? percentOf(part.value) : null;
            const amount = part.unit === "amount" ? amountOf(part.value) : null;
            const cents = resolved?.parts[part.key];
            const fieldError = issue === "percent over" ? localIssueCopy("percent over") : undefined;
            const over = check.overMinor > 0n && !holdIsOver && (lastEdited === part.key || (lastEdited == null && index === parts.length - 1));
            // The same category and project as an earlier part: only the later one says so (FLOW-922).
            const twice = part.categoryId !== "" && parts.findIndex((other) => other.categoryId !== "" && pairKey(other.categoryId, other.projectId, ctx) === pairKey(part.categoryId, part.projectId, ctx)) < index;
            const missingAmount = issue === "incomplete" && part.categoryId !== "" && part.value.trim() === "";
            // One problem per part, in this order; it replaces the share line (FLOW-922, the board).
            const problem: ReactNode = twice ? PART_TWICE
              : over ? <>{"יותר מהסכום ב־"}<Amount minor={check.overMinor} currency={currency} /></>
                : issue === "a reversal part needs a project" ? PART_PICK_PROJECT
                  : missingAmount ? PART_FILL_AMOUNT
                    : null;
            const messageId = `lsplit-msg-${part.key}`;
            const flagged = problem != null || fieldError != null;
            const fieldFlagged = over || missingAmount || fieldError != null;
            const note: ReactNode = part.unit === "percent"
              // The server's cents once previewed; until then, or while the split can't be previewed, the local share.
              ? (cents != null ? <>{"= "}<Amount minor={cents} currency={currency} /></> : percent != null ? <>{"= "}<Amount minor={percentMinorOf(percent, lineMinor)} currency={currency} /></> : null)
              : (amount != null ? <><bdi dir="ltr">{`${Math.round(shareOfLine(amount, lineMinor)).toLocaleString("en-US")}%`}</bdi>{" מהסכום"}</> : null);
            return (
              <SwipeRow key={part.key} disabled={busy || blocked} onRemove={() => { removePart(part.key); }}>
                <div className="ui-lsplit-part" data-invalid={flagged ? "" : undefined}>
                  <div className="ui-lsplit-part-head">
                    <span className="ui-lsplit-part-no">{`חלק ${String(index + 1)}`}</span>
                    <button
                      type="button"
                      className="ui-lsplit-part-remove ui-hit"
                      aria-label={`הסרת החלק ${name}`}
                      onClick={() => { removePart(part.key); }}
                    >
                      הסרה
                    </button>
                  </div>
                  <div className="ui-lsplit-pickers">
                    <button
                      type="button"
                      className="ui-lsplit-pick ui-lsplit-pick-project ui-hit"
                      aria-label={`${project}, פרויקט, שינוי`}
                      aria-describedby={problem != null ? messageId : undefined}
                      onClick={(event) => { openPicker({ kind: "part", key: part.key }, "project", event.currentTarget); }}
                    >
                      <span className={needsProject ? "ui-lsplit-project ui-lsplit-project-error" : "ui-lsplit-project"}>{project}</span>
                      <ChevronDown />
                    </button>
                    <button
                      type="button"
                      className="ui-lsplit-pick ui-hit"
                      aria-label={`${name}${reversal ? ", החזר" : ""}, קטגוריה, שינוי`}
                      aria-describedby={problem != null ? messageId : undefined}
                      onClick={(event) => { openPicker({ kind: "part", key: part.key }, "category", event.currentTarget); }}
                    >
                      <span className="ui-lsplit-title">
                        {/* The full name is in the button's label. */}
                        <span className="ui-lsplit-name" data-clip-ok="">{name}</span>
                        {reversal ? <ReversalTag /> : null}
                      </span>
                      <ChevronDown />
                    </button>
                  </div>
                  <div className={fieldFlagged ? "ui-lsplit-field ui-lsplit-field-flagged" : "ui-lsplit-field"}>
                    {part.unit === "percent" ? (
                      <PercentField
                        hideLabel
                        id={`lsplit-pct-${part.key}`}
                        label={`אחוז, ${name}`}
                        value={part.value}
                        decimals={2}
                        disabled={busy || blocked}
                        error={fieldError}
                        describedBy={problem != null ? messageId : undefined}
                        enterKeyHint={index === parts.length - 1 ? "done" : "next"}
                        onValueChange={(value) => {
                          update(part.key, { value });
                          setTypedUnit(part.unit);
                        }}
                      />
                    ) : (
                      <MoneyField
                        hideLabel
                        id={`lsplit-amt-${part.key}`}
                        label={`סכום, ${name}`}
                        prefix=""
                        value={part.value}
                        disabled={busy || blocked}
                        describedBy={problem != null ? messageId : undefined}
                        enterKeyHint={index === parts.length - 1 ? "done" : "next"}
                        onValueChange={(value) => {
                          update(part.key, { value });
                          setTypedUnit(part.unit);
                        }}
                      />
                    )}
                    <SplitUnitToggle
                      name={name}
                      unit={part.unit}
                      amountLabel={currency === "USD" ? "$" : "₪"}
                      disabled={busy || blocked}
                      onChange={(unit) => {
                        if (unit === part.unit) return;
                        // Keep the same money: the resolved cents become the amount (the percent of
                        // the line, rounded, before a preview), or the share the percent.
                        const value = unit === "amount"
                          ? (cents != null ? amountText(cents) : percent != null ? amountText(percentMinorOf(percent, lineMinor)) : "")
                          : (amount != null ? percentText(shareOfLine(amount, lineMinor)) : "");
                        update(part.key, { unit, value });
                        setTypedUnit(unit);
                      }}
                    />
                  </div>
                  <p
                    id={messageId}
                    className={problem != null ? "ui-lsplit-note ui-lsplit-note-flagged" : "ui-lsplit-note"}
                    role={problem != null ? "status" : undefined}
                  >
                    {problem ?? note}
                  </p>
                </div>
              </SwipeRow>
            );
          })}
          <button
            type="button"
            className="ui-lsplit-add-card ui-hit"
            disabled={busy || blocked || parts.length >= LINE_SPLIT_MAX_PARTS}
            onClick={addPart}
          >
            <PlusIcon size={18} />
            <span>חלק נוסף</span>
          </button>
          <button
            type="button"
            className="ui-lsplit-rest ui-hit"
            aria-label={`השאר, ${restCategory ?? "בלי קטגוריה"}, ${restProject}, שינוי`}
            aria-describedby={restMessage != null ? restMessageId : undefined}
            data-empty={restShown == null || restShown === 0n ? "" : undefined}
            onClick={(event) => { openPicker({ kind: "rest" }, "category", event.currentTarget); }}
          >
            <span className="ui-lsplit-rest-text">
              <span className="ui-lsplit-rest-label">השאר · נשאר בשורה</span>
              <span className="ui-lsplit-rest-line">{`${restProject} · ${restCategory ?? "בחירת קטגוריה"}`}</span>
            </span>
            <span className="ui-lsplit-rest-amount">
              {restShown != null
                ? <Amount minor={restShown} currency={currency} />
                : pending ? "…" : <Amount minor={lineMinor} currency={currency} />}
            </span>
          </button>
          {/* Outside the button, whose label would hide it; tied back by aria-describedby. */}
          {restMessage != null ? <p id={restMessageId} className="ui-lsplit-msg ui-lsplit-rest-msg" role="status">{restMessage}</p> : null}
        </fieldset>
        {/* Outside the fieldset: the server clears a line it would not split (a loan split, an open review). */}
        <div className="ui-lsplit-actions">
          <TextLink chevron={false} disabled={busy || blocked} onClick={splitEqually}>חלוקה שווה</TextLink>
          {split != null && split.parts.length > 0 ? (
            <TextLink chevron={false} className="ui-lsplit-clear-link" disabled={busy} onClick={() => { setConfirmClear(true); }}>הסרת הפיצול</TextLink>
          ) : null}
        </div>
        <p className="ui-lsplit-footnote">כל חלק נספר ברווח של הפרויקט שלו ובקטגוריה שלו. אפשר אותו פרויקט עם כמה קטגוריות. בבנק נשארת תנועה אחת.</p>
        <div className="ui-lsplit-foot" aria-busy={busy || undefined}>
          {showHold ? (
            <HoldLine onDiscard={discard}>
              {/* The part's red "פרויקט · חובה בהחזר" already says it: here only for screen readers. */}
              {holdShownOnPart ? <span className="sr-only">{holdText}</span> : holdText}
            </HoldLine>
          ) : null}
          <Button type="submit" variant="primary" full busy={busy} disabled={busy || invalid || parts.length === 0}>
            {saveCount > 0 ? `שמירת הפיצול · ${String(saveCount)} חלקים` : "שמירה"}
          </Button>
        </div>
      </form>
      <ChangeAssignment
        host="overlay"
        open={target != null}
        onOpenChange={(open) => { if (!open) closePicker(); }}
        contained
        start={pickerStart}
        supplier={line.supplier}
        amount={money(lineMinor, currency)}
        direction={line.direction}
        projects={pickerProjects}
        categories={ownCategories}
        reversals={reversals}
        reversalsOpen={line.direction === "income"}
        projectId={pickerProjectId}
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

/** The part picker's chevron, pointing down as on the board. */
function ChevronDown() {
  return (
    <svg className="ui-lsplit-chevron" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
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
