import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { amountOf, amountText, percentOf, percentText, shareOfLine, type PartUnit } from "../line-split";
import { LINE_HAS_CATEGORY_SPLIT, LINE_SPLIT_SAVE_FAILURE, hasCategorySplit, lineSplitCopy } from "../line-split-copy";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import {
  checkProjectSplit,
  newProjectPartKey,
  percentPartsMinor,
  projectDraftFrom,
  sharesKey,
  type ProjectPart,
  type ProjectShare,
} from "../project-split";
import { screenPhase } from "../query-phase";
import { useDashboardQuery, useInvalidateBooks, useTransactionQuery } from "../use-books";
import { useWriteGate } from "../use-is-viewer";
import { assertNoError } from "../use-write";
import { useGoBack } from "../ui/back";
import { BigNumber } from "../ui/big-number";
import { ChangeAssignment, type ChangeChoice } from "../ui/change-sheet";
import { formatDisplay } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { HoldLine } from "../ui/hold-line";
import { IconButton } from "../ui/icon-button";
import { CloseIcon, PlusIcon, ProjectsIcon } from "../ui/icons";
import { MoneyField, PercentField } from "../ui/money-field";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { SegmentedControl } from "../ui/segmented-control";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { Amount, LINE_SPLIT_MAX_PARTS, money, Percent } from "./line-split-parts";
import { combinePhase, saveNewProject, useBlockedPreview } from "./screen-shared";
import { holdSplitPop } from "./split-pop";

/** The keys a project split write refreshes. */
const PROJECT_SPLIT_KEYS = ["dashboard", "txn", "project", "project-category", "project-waiting", "home", "breakdown", "breakdown-lines", "review"];

/** A project the split can use. Missing status counts as active. */
export type SplitProject = { id: string; name: string; status?: "active" | "finished" };

/** One saved row: a project and its exact part of the line, in minor units. */
export type SplitSaveRow = ProjectShare;

/** false keeps the screen; "left" means the caller already moved on, so the screen does not go back. */
type SaveOutcome = undefined | boolean | "left";

type PickTarget = { kind: "new" } | { kind: "part"; key: string } | { kind: "rest" };

const COPY = {
  missing: "השלימו סכום לכל חלק.",
  twice: "הפרויקט הזה כבר בפיצול.",
  restProject: "בחרו פרויקט לשאר.",
} as const;

/**
 * `/transactions/:id/split` (FLOW-346): the split between projects, laid out like the split by
 * categories. Parts are projects with an exact amount or a percent; the rest stays on one
 * project. ✕ and browser back save a valid change; an invalid one holds once, then discards.
 */
export function SplitScreen({
  sampleProjects,
  sampleAmount,
  sampleMeta,
  sampleCurrency,
  sampleParts,
  sampleRestProject,
  sampleSaving = false,
  sampleWarned = false,
  onSave,
  example,
  backTo,
}: {
  sampleProjects?: SplitProject[];
  sampleAmount?: bigint;
  /** Supplier · date under the amount. Stories pass the spec line. */
  sampleMeta?: string;
  sampleCurrency?: string;
  /** Rows to open on. Stories set the state here, not in a play. */
  sampleParts?: Array<{ projectId: string; unit?: PartUnit; value: string }>;
  /** The project that keeps the rest. Null for a line with no project yet. */
  sampleRestProject?: string | null;
  /** The saving story. Fields, links, and ✕ stay disabled. */
  sampleSaving?: boolean;
  /** The hold line is already showing, as after a first ✕. */
  sampleWarned?: boolean;
  onSave?: (rows: SplitSaveRow[]) => SaveOutcome | Promise<SaveOutcome>;
  example?: ReactNode;
  /** Where back goes when this screen was opened directly. */
  backTo?: string;
} = {}) {
  const { transactionId = "" } = useParams();
  const writeGate = useWriteGate(`/transactions/${transactionId}`);
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const sample = sampleProjects != null;
  const dashboard = useDashboardQuery(!sample);
  const txn = useTransactionQuery(sample ? "" : transactionId);
  const phase = sample ? ({ kind: "ready" } as const) : combinePhase(screenPhase(preview, dashboard), screenPhase(preview, txn));
  const fallback = backTo ?? `/transactions/${transactionId}${search}`;
  if (!sample) {
    if (writeGate === "wait") return null;
    if (writeGate !== "show") return writeGate;
  }
  if (phase.kind !== "ready" || (!sample && !txn.data)) {
    return (
      <ScreenState
        title="פיצול בין פרויקטים"
        backTo={fallback}
        phase={phase.kind === "ready" ? { kind: "empty" } : phase}
        onRetry={() => { void dashboard.refetch(); void txn.refetch(); }}
        empty={<EmptyState icon={<ProjectsIcon />} title="אין תנועה להצגה" body="התנועה לא נמצאה." />}
      />
    );
  }
  const projects: ChangeChoice[] = sampleProjects
    ? sampleProjects.map((project) => ({ id: project.id, name: project.name, status: project.status ?? "active" }))
    : (dashboard.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name, status: project.status }));
  if (projects.length === 0) {
    return (
      <ScreenState
        title="פיצול בין פרויקטים"
        backTo={fallback}
        phase={{ kind: "empty" }}
        onRetry={() => { void dashboard.refetch(); }}
        empty={<EmptyState icon={<ProjectsIcon />} title="אין פרויקטים לפיצול" body="פיצול מחכה לפרויקט אחד לפחות." />}
      />
    );
  }
  const detail = txn.data;
  const lineMinor = sampleAmount ?? absAgorot(detail?.amount_net ?? 0n);
  const meta = sampleMeta ?? [detail?.supplier_name ?? detail?.customer_name ?? detail?.description, detail?.doc_date ? formatDisplay(detail.doc_date) : ""].filter(Boolean).join(" · ");
  const saved = projectDraftFrom(detail?.project_id, detail?.allocations);
  const initial = sample
    ? {
        parts: (sampleParts ?? []).map((part) => ({ key: newProjectPartKey(), projectId: part.projectId, unit: part.unit ?? "amount", value: part.value })),
        restProjectId: sampleRestProject === undefined ? (projects[0]?.id ?? null) : sampleRestProject,
      }
    : saved;
  const baseline = sharesKey(checkProjectSplit(initial.parts, initial.restProjectId, lineMinor).shares);
  return (
    <ProjectSplitEditor
      key={transactionId}
      transactionId={transactionId}
      projects={projects}
      lineMinor={lineMinor}
      income={detail?.direction === "income"}
      currency={sampleCurrency ?? detail?.currency ?? "ILS"}
      meta={meta}
      initial={initial}
      baseline={baseline}
      undoShares={sample ? null : checkProjectSplit(saved.parts, saved.restProjectId, lineMinor).shares}
      sample={sample}
      sampleSaving={sampleSaving}
      initialWarned={sampleWarned}
      onSave={onSave}
      example={example}
      fallback={fallback}
    />
  );
}

async function saveShares(transactionId: string, shares: ProjectShare[]): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  assertNoError(await supabase.rpc("save_split", { p_transaction_id: transactionId, p_shares: shares }));
}

/** A part's value field. The field adds its own name prefix to the id, so match the end. */
function partField(part: ProjectPart): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[id$="psplit-${part.unit === "percent" ? "pct" : "amt"}-${part.key}"]`);
}

function ProjectSplitEditor({
  transactionId,
  projects: givenProjects,
  lineMinor,
  income,
  currency,
  meta,
  initial,
  baseline,
  undoShares,
  sample,
  sampleSaving,
  initialWarned,
  onSave,
  example,
  fallback,
}: {
  transactionId: string;
  projects: ChangeChoice[];
  lineMinor: bigint;
  income: boolean;
  currency: string;
  meta: string;
  initial: { parts: ProjectPart[]; restProjectId: string | null };
  baseline: string;
  undoShares: ProjectShare[] | null;
  sample: boolean;
  sampleSaving: boolean;
  initialWarned: boolean;
  onSave?: (rows: SplitSaveRow[]) => SaveOutcome | Promise<SaveOutcome>;
  example?: ReactNode;
  fallback: string;
}) {
  const toast = useToast();
  const goBack = useGoBack();
  const invalidate = useInvalidateBooks();
  const blockedPreview = useBlockedPreview();
  const location = useLocation();
  const [parts, setParts] = useState<ProjectPart[]>(initial.parts);
  const [restProjectId, setRestProjectId] = useState<string | null>(initial.restProjectId);
  const [target, setTarget] = useState<PickTarget | null>(null);
  const [warned, setWarned] = useState(initialWarned);
  const [saving, setSaving] = useState(false);
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const [lastEdited, setLastEdited] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /** A new part takes the unit of the last part typed, as in the split by categories. */
  const [typedUnit, setTypedUnit] = useState<PartUnit>(() => initial.parts.at(-1)?.unit ?? "amount");
  const addRef = useRef<HTMLButtonElement>(null);
  const pickerOpener = useRef<HTMLElement | null>(null);
  const leaving = useRef(false);
  const busy = sampleSaving || saving;
  const zero = lineMinor === 0n;
  const projects = useMemo(() => [...givenProjects, ...extraProjects.filter((extra) => !givenProjects.some((project) => project.id === extra.id))], [givenProjects, extraProjects]);
  const check = checkProjectSplit(parts, restProjectId, lineMinor);
  const dirty = sharesKey(check.shares) !== baseline || (check.shares == null && (parts.length > 0 || restProjectId !== initial.restProjectId));
  const invalid = check.shares == null;
  const projectName = (id: string | null) => (id == null ? null : projects.find((project) => project.id === id)?.name ?? null);
  const restMinor = check.restMinor;
  const splitMinor = restMinor != null && restMinor >= 0n ? lineMinor - restMinor : null;

  function update(key: string, change: Partial<ProjectPart>) {
    setParts((list) => list.map((part) => (part.key === key ? { ...part, ...change } : part)));
    setLastEdited(key);
  }

  function discard() {
    leaving.current = true;
    goBack(fallback);
  }

  async function undoTo(previous: ProjectShare[]) {
    try {
      await saveShares(transactionId, previous);
      await invalidate(PROJECT_SPLIT_KEYS);
      toast.show({ message: "הפיצול הקודם חזר" });
    } catch {
      toast.show({ tone: "bad", message: "לא הצלחנו לבטל." });
    }
  }

  async function write(shares: ProjectShare[]): Promise<boolean> {
    if (busy) return false;
    if (onSave) {
      setSaving(true);
      try {
        const done = await onSave(shares);
        if (done === false) return false;
        if (done === "left") {
          leaving.current = true;
          return true;
        }
      } catch (error) {
        toast.show(hasCategorySplit(error)
          ? { tone: "bad", message: LINE_HAS_CATEGORY_SPLIT }
          : { tone: "bad", message: LINE_SPLIT_SAVE_FAILURE, action: "ניסיון חוזר", onAction: () => { void write(shares); } });
        return false;
      } finally {
        setSaving(false);
      }
      leaving.current = true;
      goBack(fallback);
      return true;
    }
    if (sample) {
      leaving.current = true;
      goBack(fallback);
      return true;
    }
    if (blockedPreview()) return false;
    setSaving(true);
    try {
      await saveShares(transactionId, shares);
    } catch (error) {
      setSaving(false);
      toast.show(hasCategorySplit(error)
        ? { tone: "bad", message: LINE_HAS_CATEGORY_SPLIT }
        : { tone: "bad", message: LINE_SPLIT_SAVE_FAILURE, action: "ניסיון חוזר", onAction: () => { void write(shares); } });
      return false;
    }
    setSaving(false);
    await invalidate(PROJECT_SPLIT_KEYS);
    const previous = undoShares;
    toast.show({
      message: "הפיצול נשמר",
      ...(previous != null && previous.length > 0 ? { action: "ביטול", onAction: () => { void undoTo(previous); } } : {}),
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
    if (invalid || check.shares == null) {
      if (!warned) {
        setWarned(true);
        return;
      }
      discard();
      return;
    }
    await write(check.shares);
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
    // The guard listens from App's load (split-pop.ts), before the router: this screen loads on demand.
    return holdSplitPop(onPop);
  }, []);

  function openPicker(next: PickTarget, opener: HTMLElement | null) {
    if (busy || zero) return;
    pickerOpener.current = next.kind === "new" ? addRef.current : opener;
    setTarget(next);
  }

  function pickProject(id: string) {
    if (id === "") return;
    if (target?.kind === "new") {
      const key = newProjectPartKey();
      setParts((list) => [...list, { key, projectId: id, unit: typedUnit, value: "" }]);
      setLastEdited(key);
      setFocusKey(key);
      setTarget({ kind: "part", key });
      return;
    }
    if (target?.kind === "rest") {
      setRestProjectId(id);
      return;
    }
    if (target?.kind === "part") update(target.key, { projectId: id });
  }

  // Picking a project closes the picker at once, before the new part's field exists; once it
  // renders, the sheet's focus return (which waits for the sheet to go) lands on it.
  useLayoutEffect(() => {
    if (focusKey == null) return;
    const part = parts.find((item) => item.key === focusKey);
    const field = part ? partField(part) : null;
    if (field) {
      pickerOpener.current = field;
      setFocusKey(null);
    }
  }, [focusKey, parts]);

  /** A part's picker hands focus to its value field, so the next tap types. */
  function closePicker() {
    if (target?.kind === "part") {
      const part = parts.find((item) => item.key === target.key);
      const field = part ? partField(part) : null;
      if (field) pickerOpener.current = field;
    }
    setTarget(null);
  }

  const holdText: string | null = check.overMinor > 0n
    ? lineSplitCopy("parts exceed the line", { currency, overMinor: check.overMinor })
    : check.restIssue === "no project"
      ? COPY.restProject
      : Object.values(check.issues).includes("same project twice")
        ? COPY.twice
        : Object.keys(check.issues).length > 0 ? COPY.missing : null;
  const showHold = warned && invalid && holdText != null;
  const targetPart = target?.kind === "part" ? parts.find((part) => part.key === target.key) : undefined;
  const pickerProjectId = target?.kind === "rest" ? (restProjectId ?? "") : (targetPart?.projectId ?? "");
  const restName = projectName(restProjectId);
  const restLabel = `השאר · ${restName ?? "בחירת פרויקט"}`;

  return (
    <>
      <form
        className="ui-split ui-lsplit ui-psplit"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void leave();
        }}
      >
        <ScreenHeader
          layout="stacked"
          title="פיצול בין פרויקטים"
          leading={<IconButton label="סגירה" disabled={sampleSaving} onClick={() => { void leave(); }}><CloseIcon /></IconButton>}
          trailing={example}
        />
        <div className="ui-lsplit-head">
          <p className="t-display">
            {income ? <span className="sr-only">הכנסה </span> : null}
            <BigNumber agorot={lineMinor} presentation="detail" currency={currency} income={income} size="display" />
          </p>
          {meta ? <p className="t-label ui-lsplit-meta"><bdi>{meta}</bdi></p> : null}
        </div>
        <fieldset className="ui-split-body" disabled={busy || zero}>
          <div className="ui-split-card ui-lsplit-card">
            {parts.map((part, index) => {
              const name = projectName(part.projectId) ?? "בחירת פרויקט";
              const issue = check.issues[part.key];
              const percent = part.unit === "percent" ? percentOf(part.value) : null;
              const amount = part.unit === "amount" ? amountOf(part.value) : null;
              const cents = check.minor[part.key];
              const over = check.overMinor > 0n && !showHold && (lastEdited === part.key || (lastEdited == null && index === parts.length - 1));
              const messageId = `psplit-msg-${part.key}`;
              const message = issue === "same project twice"
                ? COPY.twice
                : over ? lineSplitCopy("parts exceed the line", { currency, overMinor: check.overMinor }) : undefined;
              const fieldError = issue === "percent over" ? "עד 100%" : undefined;
              return (
                <div key={part.key} className="ui-lsplit-part" data-invalid={message != null || fieldError != null ? "" : undefined}>
                  <div className="ui-lsplit-text">
                    <button
                      type="button"
                      className="ui-lsplit-pick ui-hit"
                      aria-label={`${name}, שינוי`}
                      aria-describedby={message ? messageId : undefined}
                      onClick={(event) => { openPicker({ kind: "part", key: part.key }, event.currentTarget); }}
                    >
                      <span className="ui-lsplit-title">
                        {/* The full name is in the button's label. */}
                        <span className="ui-lsplit-name" data-clip-ok="">{name}</span>
                      </span>
                    </button>
                    <IconButton className="ui-lsplit-remove" label={`הסרת החלק ${name}`} onClick={() => {
                      setParts((list) => list.filter((item) => item.key !== part.key));
                      setLastEdited(null);
                    }}>
                      <CloseIcon size={18} />
                    </IconButton>
                  </div>
                  <div className="ui-lsplit-end ui-lsplit-end-entry">
                    <div className="ui-lsplit-entry">
                      <SegmentedControl
                        label={`יחידה, ${name}`}
                        showLabel={false}
                        radius="input"
                        value={part.unit}
                        options={[{ value: "percent", label: "%" }, { value: "amount", label: currency === "USD" ? "$" : "₪" }]}
                        disabled={busy}
                        onChange={(unit) => {
                          if (unit === part.unit) return;
                          // Keep the same money: the cents become the amount, or the share the percent.
                          const value = unit === "amount"
                            ? (cents != null ? amountText(cents) : "")
                            : (amount != null ? percentText(shareOfLine(amount, lineMinor)) : "");
                          update(part.key, { unit, value });
                          setTypedUnit(unit);
                        }}
                      />
                      {part.unit === "percent" ? (
                        <PercentField
                          hideLabel
                          id={`psplit-pct-${part.key}`}
                          label={`אחוז, ${name}`}
                          value={part.value}
                          decimals={2}
                          disabled={busy}
                          error={fieldError}
                          describedBy={message ? messageId : undefined}
                          enterKeyHint={index === parts.length - 1 ? "done" : "next"}
                          onValueChange={(value) => {
                            update(part.key, { value });
                            setTypedUnit(part.unit);
                          }}
                        />
                      ) : (
                        <MoneyField
                          hideLabel
                          id={`psplit-amt-${part.key}`}
                          label={`סכום, ${name}`}
                          prefix={currency === "USD" ? "$" : "₪"}
                          value={part.value}
                          disabled={busy}
                          describedBy={message ? messageId : undefined}
                          enterKeyHint={index === parts.length - 1 ? "done" : "next"}
                          onValueChange={(value) => {
                            update(part.key, { value });
                            setTypedUnit(part.unit);
                          }}
                        />
                      )}
                    </div>
                    <span className="ui-lsplit-resolved t-label" aria-live="polite">
                      {part.unit === "percent"
                        ? (percent != null ? <Amount minor={cents ?? percentPartsMinor([percent], lineMinor)[0] ?? 0n} currency={currency} /> : null)
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
              aria-label={`השאר, ${restName ?? "בלי פרויקט"}, שינוי`}
              aria-describedby={check.restIssue === "no project" && warned ? "psplit-rest-msg" : undefined}
              onClick={(event) => { openPicker({ kind: "rest" }, event.currentTarget); }}
            >
              <span className="ui-lsplit-text">
                <span className="ui-lsplit-pick">
                  <span className="ui-lsplit-title"><span className="ui-lsplit-name" data-clip-ok="">{restLabel}</span></span>
                  <span className="ui-lsplit-project">נשאר בשורה</span>
                </span>
              </span>
              <span className="ui-lsplit-end">
                {restMinor == null ? (
                  <span className="ui-lsplit-amount t-body">…</span>
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
            {check.restIssue === "no project" && warned ? <p id="psplit-rest-msg" className="ui-lsplit-msg ui-lsplit-rest-msg" role="status">{COPY.restProject}</p> : null}
            {parts.length === 0 ? <p className="t-hint ui-lsplit-empty">הוסיפו חלק כדי לפצל. מה שלא פוצל נשאר בשורה.</p> : null}
          </div>
        </fieldset>
        <div className="ui-split-cta ui-lsplit-foot" aria-busy={busy || undefined}>
          <div className="ui-lsplit-totals">
            <span className="ui-lsplit-add">
              <TextLink
                buttonRef={addRef}
                chevron={false}
                icon={<PlusIcon size={18} />}
                disabled={busy || zero || parts.length >= LINE_SPLIT_MAX_PARTS}
                onClick={() => { openPicker({ kind: "new" }, null); }}
              >
                הוספת חלק
              </TextLink>
            </span>
            <span className="ui-lsplit-sums">
              <span className="ui-lsplit-total">
                <span className="t-hint">פוצלו</span>
                <span className="t-body">
                  {busy ? <span className="ui-spinner" aria-hidden="true" /> : null}
                  {check.overMinor > 0n
                    ? <Amount minor={lineMinor + check.overMinor} currency={currency} />
                    : splitMinor != null ? <Amount minor={splitMinor} currency={currency} /> : "…"}
                </span>
              </span>
              <span className="ui-lsplit-total ui-lsplit-total-end">
                <span className="t-hint">{check.overMinor > 0n ? "עוברים את השורה" : "נשאר לשורה"}</span>
                <span className={check.overMinor > 0n ? "t-body ui-split-bad" : "t-body"}>
                  {check.overMinor > 0n
                    ? <Amount minor={-check.overMinor} currency={currency} />
                    : restMinor != null ? <Amount minor={restMinor} currency={currency} /> : "…"}
                </span>
              </span>
            </span>
          </div>
          {showHold ? (
            <HoldLine onDiscard={discard}>
              {/* The rest row's red line already says it: here only for screen readers (FLOW-343). */}
              {holdText === COPY.restProject ? <span className="sr-only">{holdText}</span> : holdText}
            </HoldLine>
          ) : null}
        </div>
      </form>
      <ChangeAssignment
        host="overlay"
        open={target != null}
        onOpenChange={(open) => { if (!open) closePicker(); }}
        contained
        start="project"
        supplier=""
        amount={money(lineMinor, currency)}
        direction={income ? "income" : "expense"}
        projects={projects}
        categories={[]}
        projectId={pickerProjectId}
        categoryId=""
        onProjectId={pickProject}
        onCategoryId={() => undefined}
        onCommitPick={() => Promise.resolve(undefined)}
        hideSplitLink
        returnFocusRef={pickerOpener}
        onSplit={() => { setTarget(null); }}
        onCreateProject={async (name) => {
          if (sample) {
            const created = { id: `psplit-added-${name}`, name, status: "active" as const };
            setExtraProjects((list) => [...list, created]);
            return created;
          }
          return saveNewProject(name, blockedPreview, toast, (project) => {
            setExtraProjects((list) => [...list, project]);
          }, invalidate);
        }}
      />
    </>
  );
}
