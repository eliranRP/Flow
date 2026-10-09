import { formatIls } from "@flow/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { useWriteGate } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import {
  activeProjects,
  allocate,
  basisToPercents,
  evenBasis,
  formatShare,
  incomeBasis,
  percentToBp,
  sharesForSave,
  splitIsValid,
  type SplitMethod,
  type SplitProject,
} from "../split-math";
import { useDashboardQuery, useInvalidateBooks, useTransactionQuery } from "../use-books";
import { assertNoError, useWrite } from "../use-write";
import { BigNumber } from "../ui/big-number";
import { CheckRow } from "../ui/check-row";
import { formatDisplay } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { HoldLine } from "../ui/hold-line";
import { useGoBack } from "../ui/back";
import { IconButton } from "../ui/icon-button";
import { CloseIcon, ProjectsIcon } from "../ui/icons";
import { ChangeAssignment, changeSaveFailure, COLLAPSE_PICK_HOLD, COLLAPSE_SPLIT_NOTE, ONE_PROJECT_DETAIL, ONE_PROJECT_OPTION, type ChangeChoice } from "../ui/change-sheet";
import { PercentField } from "../ui/money-field";
import { RadioRow } from "../ui/radio-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { hasCategorySplit, LINE_HAS_CATEGORY_SPLIT, projectSplitFailure } from "../line-split-copy";
import { collapseSplit, combinePhase, saveNewProject, useBlockedPreview } from "./screen-shared";
import { clearSplitDraft, evenSentence, percentWords, readSplitDraft, sameBasis, writeSplitDraft } from "./split-screen-draft";

type SplitPop = (event: PopStateEvent) => void;
let splitPop: SplitPop | null = null;
if (typeof window !== "undefined" && !(window as Window & { __flowSplitPop?: boolean }).__flowSplitPop) {
  (window as Window & { __flowSplitPop?: boolean }).__flowSplitPop = true;
  window.addEventListener("popstate", (event) => {
    splitPop?.(event);
  }, true);
}

export function SplitScreen({
  sampleProjects,
  sampleAmount,
  sampleMeta,
  sampleMethod,
  sampleShares,
  sampleChosen,
  sampleSaving = false,
  onSave,
  onOneProject,
  example,
  backTo,
}: {
  sampleProjects?: SplitProject[];
  sampleAmount?: bigint;
  /** Supplier · date under the amount. Stories pass the spec line. */
  sampleMeta?: string;
  sampleMethod?: SplitMethod | null;
  /** Manual percents, as typed. One decimal. */
  sampleShares?: Record<string, string>;
  /** Projects already ticked for the chosen-projects choice. */
  sampleChosen?: string[];
  /** The saving story. Rows, fields, the link, and ✕ stay disabled. */
  sampleSaving?: boolean;
  onSave?: (rows: Array<{ project_id: string; share_bp: number }>) => undefined | boolean | Promise<undefined | boolean>;
  /** One project. "left" means the caller already moved on, so this screen does not toast or go back. */
  onOneProject?: (projectId: string) => undefined | boolean | "left" | Promise<undefined | boolean | "left">;
  example?: ReactNode;
  /** Where back goes when this screen was opened directly. */
  backTo?: string;
} = {}) {
  const { transactionId = "" } = useParams();
  const writeGate = useWriteGate(`/transactions/${transactionId}`);
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const location = useLocation();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const invalidate = useInvalidateBooks();
  const goBack = useGoBack();
  const hereRef = useRef("");
  hereRef.current = `${location.pathname}${location.search}${location.hash}`;
  const dashboard = useDashboardQuery(sampleProjects == null);
  const txn = useTransactionQuery(sampleProjects ? "" : transactionId);
  const phase = sampleProjects ? ({ kind: "ready" } as const) : combinePhase(screenPhase(preview, dashboard), screenPhase(preview, txn));
  const projects: SplitProject[] = sampleProjects ?? (dashboard.data?.projects ?? []).map((project) => ({
    id: project.id,
    name: project.name,
    incomeAgorot: project.income_agorot,
    status: project.status,
  }));
  const active = activeProjects(projects);
  const draftId = sampleProjects != null ? `sample${location.search}` : transactionId;
  const restored = sampleMethod === undefined && sampleShares == null ? readSplitDraft(draftId) : null;
  const [method, setMethod] = useState<SplitMethod | null>(restored ? restored.method : (sampleMethod === undefined ? null : sampleMethod));
  const [oneProject, setOneProject] = useState(restored?.oneProject ?? "");
  const [oneOpen, setOneOpen] = useState(false);
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const oneSaved = useRef("");
  const collapseTarget = useRef("");
  const oneUndoId = useRef<string | null>(null);
  const [chosen, setChosen] = useState<string[]>(restored?.chosen ?? sampleChosen ?? []);
  const [manual, setManual] = useState<Record<string, string>>(restored?.manual ?? sampleShares ?? {});
  const [detail, setDetail] = useState(false);
  const [seeded, setSeeded] = useState(restored != null);
  const manualEdited = useRef(sampleShares != null || restored?.method === "manual");
  const priorMethod = useRef<SplitMethod | null>(sampleMethod === "manual" ? null : (sampleMethod ?? null));
  const rowsRef = useRef<Array<{ project_id: string; share_bp: number }>>([]);
  const fallback = backTo ?? `/transactions/${transactionId}${search}`;
  const activeKey = active.map((project) => `${project.id}:${String(project.incomeAgorot ?? 0n)}`).join("|");
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const active = activeRef.current;
    if (seeded || sampleProjects || !txn.data?.allocations?.length || active.length === 0) return;
    const saved: Record<string, number> = {};
    for (const row of txn.data.allocations) saved[row.project_id] = row.share_bp;
    const ids = active.map((project) => project.id);
    if (sameBasis(saved, evenBasis(ids))) {
      setMethod("equal");
      setSeeded(true);
      return;
    }
    if (active.some((project) => (project.incomeAgorot ?? 0n) > 0n) && sameBasis(saved, incomeBasis(active))) {
      setMethod("income");
      setSeeded(true);
      return;
    }
    const picked = ids.filter((id) => (saved[id] ?? 0) > 0);
    if (picked.length >= 2 && picked.length < ids.length && sameBasis(saved, evenBasis(picked))) {
      setChosen(picked);
      setMethod("chosen");
      setSeeded(true);
      return;
    }
    setManual(basisToPercents(ids, saved));
    setMethod("manual");
    manualEdited.current = true;
    setSeeded(true);
  }, [seeded, sampleProjects, txn.data, activeKey]);
  const amount = sampleAmount ?? absAgorot(txn.data?.amount_net ?? 0n);
  const hasIncome = active.some((project) => (project.incomeAgorot ?? 0n) > 0n);
  const evenParts = allocate(amount, active.map((project) => ({ id: project.id, bp: evenBasis(active.map((item) => item.id))[project.id] ?? 0 })));
  const picked = active.filter((project) => chosen.includes(project.id));
  const chosenParts = allocate(amount, picked.map((project) => ({ id: project.id, bp: evenBasis(picked.map((item) => item.id))[project.id] ?? 0 })));
  const incomeParts = allocate(amount, active.map((project) => ({ id: project.id, bp: incomeBasis(active)[project.id] ?? 0 })));
  const manualBasis = Object.fromEntries(active.map((project) => [project.id, percentToBp(manual[project.id] ?? "")]));
  const manualParts = allocate(amount, active.map((project) => ({ id: project.id, bp: manualBasis[project.id] ?? 0 })));
  const manualUsed = active.reduce((sum, project) => sum + (manualBasis[project.id] ?? 0), 0);
  const parts = method === "equal" ? evenParts : method === "chosen" ? chosenParts : method === "income" ? incomeParts : method === "manual" ? manualParts : [];
  const partById = new Map(parts.map((part) => [part.id, part]));
  const overRange = method === "manual" && active.some((project) => percentToBp(manual[project.id] ?? "") > 10000);
  const valid = method === "equal"
    ? evenParts.length > 0 && splitIsValid(evenParts)
    : method === "chosen"
      ? picked.length >= 2 && splitIsValid(chosenParts)
      : method === "income"
        ? hasIncome && splitIsValid(incomeParts)
        : method === "manual"
          ? !overRange && splitIsValid(manualParts)
          : method === "one"
            ? oneProject !== ""
            : false;
  rowsRef.current = sharesForSave(method === "one" ? [] : (valid ? parts : []));
  const baseline = useRef<string | null>(sampleProjects ? "[]" : null);
  if (seeded && baseline.current == null) baseline.current = JSON.stringify(rowsRef.current);
  const dirty = method === "one"
    ? oneProject !== "" && oneSaved.current !== oneProject
    : method != null && (!valid || JSON.stringify(rowsRef.current) !== (baseline.current ?? "[]"));
  const popLeave = useRef(false);
  const save = useWrite({
    failure: projectSplitFailure,
    success: "הפיצול נשמר",
    keys: ["dashboard", "txn", "project"],
    onSuccess: () => {
      clearSplitDraft(draftId);
      if (popLeave.current) return;
      goBack(fallback);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("save_split", { p_transaction_id: transactionId, p_shares: rowsRef.current }));
    },
  });
  const collapseOne = useWrite({
    failure: changeSaveFailure,
    keys: ["txn", "dashboard", "project", "project-category", "project-waiting", "review"],
    onSuccess: () => {
      oneSaved.current = collapseTarget.current;
      setOneProject(collapseTarget.current);
      const id = oneUndoId.current;
      clearSplitDraft(draftId);
      toast.show({
        message: "השיוך נשמר",
        ...(id ? { action: "ביטול", onAction: () => { void undoOne(id); } } : {}),
      });
      if (popLeave.current) return;
      goBack(fallback);
    },
    run: async () => {
      oneUndoId.current = await collapseSplit(transactionId, collapseTarget.current);
    },
  });
  const [saving, setSaving] = useState(false);
  const busy = sampleSaving || saving || save.isPending || collapseOne.isPending;
  const oneProjectRef = useRef(oneProject);
  oneProjectRef.current = oneProject;
  const gate = useRef({ method, valid, dirty, oneProject, manual, chosen });
  gate.current = { method, valid, dirty, oneProject, manual, chosen };
  const warned = useRef(false);
  const discardClose = useRef(false);
  const releasePop = useRef(false);
  const inflight = useRef<Promise<unknown> | null>(null);
  function rememberDraft() {
    const now = gate.current;
    writeSplitDraft(draftId, {
      method: now.method,
      manual: now.manual,
      chosen: now.chosen,
      oneProject: now.oneProject,
    });
  }
  function blockedChoice(): boolean {
    const now = gate.current;
    if (now.method == null) return false;
    if (now.method === "one") return now.oneProject === "";
    return !now.valid;
  }
  async function undoOne(id: string) {
    const supabase = getSupabase();
    if (!supabase) {
      toast.show({ tone: "bad", message: "לא הצלחנו לבטל את השיוך." });
      return;
    }
    const saved = await supabase.rpc("undo_reassign", { p_id: id });
    if (saved.error) {
      toast.show({ tone: "bad", message: "לא הצלחנו לבטל את השיוך." });
      return;
    }
    await invalidate(["txn", "dashboard", "project", "project-category", "project-waiting", "review"]);
    toast.show({ message: "השיוך הקודם חזר" });
  }
  async function collapseNow(projectId: string): Promise<undefined | "left"> {
    if (projectId === "") throw new Error("supabase");
    if (onOneProject) {
      const outcome = await onOneProject(projectId);
      if (outcome === false) throw new Error("save");
      oneSaved.current = projectId;
      setOneProject(projectId);
      return outcome === "left" ? "left" : undefined;
    }
    if (sampleProjects) {
      oneSaved.current = projectId;
      setOneProject(projectId);
      toast.show({
        message: "השיוך נשמר",
        action: "ביטול",
        onAction: () => {
          oneSaved.current = "";
          setOneProject("");
          setMethod(null);
        },
      });
      return undefined;
    }
    if (blocked()) throw new Error("preview");
    collapseTarget.current = projectId;
    await collapseOne.mutateAsync();
    return "left";
  }
  function abandon() {
    discardClose.current = true;
    clearSplitDraft(draftId);
    goBack(fallback);
  }
  async function leave() {
    if (sampleSaving) return;
    if (inflight.current) {
      try {
        await inflight.current;
      } catch {
        // The failure toast is already up. The dismiss still closes.
      }
      if (!discardClose.current) goBack(fallback);
      return;
    }
    if (!blockedChoice()) warned.current = false;
    if (blockedChoice()) {
      if (!warned.current) {
        warned.current = true;
        return;
      }
      abandon();
      return;
    }
    if (gate.current.method === "one") {
      if (oneSaved.current === gate.current.oneProject) {
        clearSplitDraft(draftId);
        goBack(fallback);
        return;
      }
      rememberDraft();
      try {
        const work = collapseNow(gate.current.oneProject);
        inflight.current = work;
        const outcome = await work;
        if (outcome !== "left" && oneSaved.current === gate.current.oneProject) {
          clearSplitDraft(draftId);
          goBack(fallback);
        }
      } catch {
        return;
      } finally {
        inflight.current = null;
      }
      return;
    }
    if (gate.current.dirty && gate.current.valid) {
      rememberDraft();
      if (onSave) {
        setSaving(true);
        try {
          const work = Promise.resolve(onSave(rowsRef.current));
          inflight.current = work;
          const saved = await work;
          if (saved === false) return;
        } catch (error) {
          if (hasCategorySplit(error)) {
            toast.show({ tone: "bad", message: LINE_HAS_CATEGORY_SPLIT });
            return;
          }
          toast.show({ tone: "bad", message: "הפיצול לא נשמר", action: "ניסיון חוזר", onAction: () => { void leave(); } });
          return;
        } finally {
          inflight.current = null;
          setSaving(false);
        }
        clearSplitDraft(draftId);
        baseline.current = JSON.stringify(rowsRef.current);
        gate.current = { ...gate.current, valid: true, dirty: false };
        return;
      }
      if (blocked()) return;
      if (sampleProjects) {
        clearSplitDraft(draftId);
        goBack(fallback);
        return;
      }
      try {
        const work = save.mutateAsync();
        inflight.current = work;
        await work;
      } catch {
        return;
      } finally {
        inflight.current = null;
      }
      return;
    }
    clearSplitDraft(draftId);
    goBack(fallback);
  }
  const popApi = useRef({
    blocked,
    draftId,
    onSave,
    sampleProjects,
    save,
    collapseNow,
    toast,
    rememberDraft,
    blockedChoice,
  });
  popApi.current = {
    blocked,
    draftId,
    onSave,
    sampleProjects,
    save,
    collapseNow,
    toast,
    rememberDraft,
    blockedChoice,
  };
  useEffect(() => {
    function holdPop(event: PopStateEvent, splitUrl: string) {
      event.stopImmediatePropagation();
      window.history.pushState(window.history.state, "", splitUrl);
    }
    function leavePop() {
      releasePop.current = true;
      window.history.back();
    }
    function onPop(event: PopStateEvent) {
      const api = popApi.current;
      if (releasePop.current) {
        releasePop.current = false;
        return;
      }
      const splitUrl = hereRef.current;
      if (discardClose.current) return;
      if (api.blockedChoice()) {
        if (!warned.current) {
          warned.current = true;
          holdPop(event, splitUrl);
          return;
        }
        clearSplitDraft(api.draftId);
        return;
      }
      const now = gate.current;
      if (!now.dirty || !now.valid) return;
      holdPop(event, splitUrl);
      api.rememberDraft();
      popLeave.current = true;
      const work = (async () => {
        try {
          if (now.method === "one") {
            await api.collapseNow(now.oneProject);
            clearSplitDraft(api.draftId);
            leavePop();
            return;
          }
          if (api.onSave) {
            const saved = await api.onSave(rowsRef.current);
            if (saved === false) {
              popLeave.current = false;
              return;
            }
            clearSplitDraft(api.draftId);
            leavePop();
            return;
          }
          if (api.sampleProjects || api.blocked()) return;
          await api.save.mutateAsync();
          clearSplitDraft(api.draftId);
          leavePop();
        } catch {
          popLeave.current = false;
          api.toast.show({ tone: "bad", message: "הפיצול לא נשמר" });
        }
      })();
      inflight.current = work;
      void work.finally(() => {
        if (inflight.current === work) inflight.current = null;
      });
    }
    // The module listener is already on window, so a later pop cannot miss it.
    splitPop = onPop;
    return () => {
      if (splitPop === onPop) splitPop = null;
    };
  }, []);
  function openManual() {
    if (busy) return;
    if (method !== "manual") priorMethod.current = method;
    if (!manualEdited.current && method && method !== "manual") {
      const source = method === "income" ? incomeBasis(active) : evenBasis((method === "chosen" ? picked : active).map((project) => project.id));
      const ids = (method === "chosen" ? picked : active).map((project) => project.id);
      setManual(basisToPercents(ids, source));
      manualEdited.current = true;
    }
    setMethod("manual");
  }
  function focusShare(event: { currentTarget: HTMLDivElement; target: EventTarget }) {
    if (busy) return;
    if (event.target instanceof HTMLElement && event.target.closest("input")) return;
    event.currentTarget.querySelector("input")?.focus();
  }
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  if (phase.kind !== "ready" || active.length === 0) {
    return (
      <ScreenState
        title="פיצול בין פרויקטים"
        backTo={fallback}
        phase={phase.kind === "ready" ? { kind: "empty" } : phase}
        onRetry={() => { void dashboard.refetch(); void txn.refetch(); }}
        empty={<EmptyState icon={<ProjectsIcon />} title="אין פרויקטים לפיצול" body="פיצול מחכה לפרויקט אחד לפחות." />}
      />
    );
  }
  const meta = sampleMeta ?? [txn.data?.supplier_name, txn.data?.doc_date ? formatDisplay(txn.data.doc_date) : ""].filter(Boolean).join(" · ");
  const allLine = evenSentence(evenParts, amount);
  const chosenLine = picked.length === 0 ? "בוחרים פרויקטים, והסכום מתפצל שווה" : evenSentence(chosenParts, amount);
  const manualLeft = 10000 - manualUsed;
  const manualStatus = manualLeft > 0
    ? `נשארו ${percentWords(manualLeft)}% לפצל`
    : manualLeft < 0
      ? `הסך ${percentWords(manualUsed)}%. צריך 100%.`
      : "הסך 100%";
  const oneName = [...active, ...extraProjects].find((project) => project.id === oneProject)?.name ?? "";
  const summary = !method
    ? "בחרו איך לפצל"
    : method === "one" && oneProject === ""
      ? COLLAPSE_PICK_HOLD
      : method === "one"
        ? `${oneName} · ${ONE_PROJECT_DETAIL}`
        : method === "chosen" && picked.length < 2
          ? "בחרו לפחות 2 פרויקטים"
          : method === "chosen"
            ? chosenLine
            : method === "manual" && !valid
              ? manualStatus
              : method === "manual"
                ? `פיצול ידני · ${String(manualParts.length)} פרויקטים`
                : method === "income"
                  ? `לפי הכנסות · ${String(incomeParts.length)} פרויקטים`
                  : allLine;
  const summaryIdle = method != null && !valid;
  const showDetail = method === "equal" || (method === "income" && hasIncome);
  const detailParts = method === "income" ? incomeParts : evenParts;
  const pickerProjects: ChangeChoice[] = [
    ...active.map((project) => ({ id: project.id, name: project.name, status: project.status })),
    ...extraProjects.filter((project) => !active.some((item) => item.id === project.id)),
  ];
  return (
    <>
    <form
      className="ui-split"
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
      <div className="ui-split-amount">
        <p className="t-display"><BigNumber agorot={amount} presentation="detail" currency={txn.data?.currency} /></p>
        {meta ? <p className="ui-split-meta t-label">{meta}</p> : null}
      </div>
      <h2 className="ui-split-question t-title-3">איך לפצל?</h2>
      <fieldset className="ui-split-body" disabled={busy}>
        <div className="ui-split-card" role="radiogroup" aria-label="איך לפצל?">
          {/* FLOW-343: a picked row whose sentence the footer already says drops its own copy. */}
          <RadioRow marker="start" label="שווה בין כל הפרויקטים" description={method === "equal" ? undefined : allLine} selected={method === "equal"} busy={busy && method === "equal"} disabled={busy && method !== "equal"} onSelect={() => { setMethod("equal"); }} />
          <RadioRow marker="start" label="שווה בין פרויקטים שאבחר" description={method === "chosen" ? undefined : chosenLine} selected={method === "chosen"} busy={busy && method === "chosen"} disabled={busy && method !== "chosen"} onSelect={() => { setMethod("chosen"); }} />
          <RadioRow
            marker="start"
            label="לפי הכנסות"
            description={hasIncome ? "לפי ההכנסות של כל פרויקט בתקופה" : undefined}
            disabledReason={hasIncome ? undefined : "אין הכנסות בתקופה הזו"}
            disabled={busy && method !== "income"}
            selected={method === "income"}
            busy={busy && method === "income"}
            onSelect={() => { setMethod("income"); }}
          />
          <RadioRow
            marker="start"
            label={ONE_PROJECT_OPTION}
            description={ONE_PROJECT_DETAIL}
            disabled={busy && method !== "one"}
            selected={method === "one"}
            busy={busy && method === "one"}
            onSelect={() => {
              setMethod("one");
              setOneOpen(true);
            }}
          />
        </div>
        {method === "chosen" ? (
          <div className="ui-split-card ui-split-detail">
            {active.map((project) => {
              const on = chosen.includes(project.id);
              const part = partById.get(project.id);
              return (
                <CheckRow
                  key={project.id}
                  label={project.name}
                  checked={on}
                  disabled={busy}
                  value={on && part ? formatShare(part.agorot) : undefined}
                  onChange={(next) => {
                    setChosen((current) => next ? [...current, project.id] : current.filter((id) => id !== project.id));
                  }}
                />
              );
            })}
          </div>
        ) : null}
        {showDetail ? (
          <div className="ui-split-detail">
            <p className="ui-split-link">
              <TextLink chevron={false} expanded={detail} disabled={busy} onClick={() => { setDetail((open) => !open); }}>
                {detail ? "הסתרת הפירוט" : "הצגת הפירוט"}
              </TextLink>
            </p>
            {detail ? (
              <div className="ui-split-card">
                {detailParts.map((part) => {
                  const project = active.find((item) => item.id === part.id);
                  if (!project) return null;
                  return <CheckRow key={part.id} readOnly label={project.name} value={formatShare(part.agorot)} />;
                })}
              </div>
            ) : null}
          </div>
        ) : null}
        {method === "manual" ? (
          <div className="ui-split-card ui-split-detail">
            {active.map((project, index) => {
              const raw = manual[project.id] ?? "";
              const bp = percentToBp(raw);
              const part = partById.get(project.id);
              return (
                <div
                  key={project.id}
                  className="ui-split-manual"
                  onMouseDown={(event) => {
                    if (event.target instanceof HTMLElement && event.target.closest("input")) return;
                    event.preventDefault();
                  }}
                  onClick={(event) => { focusShare(event); }}
                >
                  <span className="ui-row-title">{project.name}</span>
                  <span className="ui-split-manual-end">
                    <PercentField
                      hideLabel
                      id={`split-pct-${project.id}`}
                      name={`split-pct-${project.id}`}
                      label={`אחוז, ${project.name}`}
                      value={raw}
                      disabled={busy}
                      error={bp > 10000 ? "עד 100%" : undefined}
                      enterKeyHint={index === active.length - 1 ? "done" : "next"}
                      onValueChange={(next) => {
                        manualEdited.current = true;
                        setManual({ ...manual, [project.id]: next });
                      }}
                    />
                    {part ? <p className="ui-split-manual-money t-label">{formatShare(part.agorot)}</p> : null}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        <p className="ui-split-link">
          {method === "manual" ? (
            <TextLink chevron={false} disabled={busy} onClick={() => { setMethod(priorMethod.current); }}>חזרה לאפשרויות</TextLink>
          ) : (
            <TextLink chevron={false} disabled={busy} onClick={openManual}>פיצול ידני</TextLink>
          )}
        </p>
        {method === "manual" && valid ? <p className="ui-split-remain t-label">הסך 100%</p> : null}
      </fieldset>
      <div className="ui-split-cta">
        {summaryIdle ? (
          <HoldLine onDiscard={abandon}>
            {method === "manual" && manualLeft < 0 ? (
              <>
                {"הסך "}
                <bdi className="ui-split-bad" dir="ltr">{`${percentWords(manualUsed)}%`}</bdi>
                {". צריך 100%."}
              </>
            ) : summary}
          </HoldLine>
        ) : (
          <p className="ui-split-summary t-body">{summary}</p>
        )}
      </div>
    </form>
    <ChangeAssignment
      host="overlay"
      open={oneOpen}
      onOpenChange={setOneOpen}
      contained
      start="project"
      supplier=""
      amount={formatIls(amount)}
      direction="expense"
      projects={pickerProjects}
      categories={[]}
      projectId={oneProject}
      categoryId=""
      onProjectId={setOneProject}
      onCategoryId={() => undefined}
      projectNote={COLLAPSE_SPLIT_NOTE}
      hideSplitLink
      onCommitPick={(_kind, id) => collapseNow(id)}
      onSplit={() => { setOneOpen(false); }}
      onCreateProject={async (name) => {
        if (sampleProjects != null) {
          const created = { id: `split-extra-${String(extraProjects.length + 1)}`, name, status: "active" as const };
          setExtraProjects((list) => [...list, created]);
          return created;
        }
        return saveNewProject(name, blocked, toast, (project) => {
          setExtraProjects((list) => [...list, project]);
        }, invalidate);
      }}
    />
    </>
  );
}
