import { formatAmountText, type ReviewRow } from "@flow/shared";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { useHoldWrites, useWriteGate } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { useFlowSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useCategoriesQuery, useDashboardQuery, useInvalidateBooks, useReviewQuery } from "../use-books";
import { reviewFocusPath } from "../review-paths";
import { assertNoError, useWrite } from "../use-write";
import { useJevReview } from "./jev-review-card";
import { withJev } from "./jev-review";
import { CHANGE_SAVE_FAILURE, ChangeAssignment, changeSaveFailure, COLLAPSE_SPLIT_NOTE, type ChangeChoice } from "../ui/change-sheet";
import { ScreenState } from "../ui/screen-state";
import { RouteSheet } from "../ui/route-sheet";
import { useToast } from "../ui/toast";
import { reversalChoices } from "../reversal";
import { collapseSplit, combinePhase, saveNewProject, useBlockedPreview, withChoice } from "./screen-shared";
import { reviewE2e, reviewIsSplit, reviewLineFocus, reviewSplitTitle } from "./review-shared";

type ChangeSample = {
  supplier: string;
  amount: string;
  suggestionId?: string;
  suggestionCategoryId?: string;
  projectId?: string;
  categoryId?: string;
  projects: ChangeChoice[];
  categories: Array<{ id: string; name: string; hidden: boolean; kind?: string }>;
  direction?: "income" | "expense";
  initialQuery?: string;
  loading?: boolean;
  saveError?: boolean;
  /** A split in the queue. The sheet does not ask for a project. */
  split?: boolean;
  splitTitle?: string;
  /** False when the category is the owner's, so the sheet does not call it a suggestion. */
  categorySuggested?: boolean;
  /** False when the project is the owner's or a remembered rule, so it is not הצעה. */
  project_suggested?: boolean;
};

export function ChangeForm({ sample: given }: { sample?: ChangeSample } = {}) {
  const [params] = useSearchParams();
  const sample: ChangeSample | undefined = given ?? (reviewE2e != null && params.get("e2e") === "list" ? reviewE2e.e2eChangeSample : undefined);
  const search = useFlowSearch();
  const preview = useHomePreview();
  const navigate = useNavigate();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const writeGate = useWriteGate("/review");
  const invalidate = useInvalidateBooks();
  const dashboard = useDashboardQuery(sample == null);
  const categories = useCategoriesQuery(sample == null);
  const review = useReviewQuery(sample == null);
  const item = params.get("item") ?? "";
  const live = (review.data ?? []).find((entry) => entry.id === item);
  const [kept, setKept] = useState<ReviewRow | null>(null);
  useEffect(() => {
    if (live) setKept(live);
  }, [live]);
  const row = live ?? (kept?.id === item ? kept : null);
  const jev = useJevReview(
    sample || preview !== "off" ? null : (row?.transaction_id ?? null),
    sample == null && preview === "off",
  );
  const [projectId, setProjectId] = useState(sample?.projectId ?? sample?.suggestionId ?? "");
  const [categoryId, setCategoryId] = useState(sample?.categoryId ?? sample?.suggestionCategoryId ?? "");
  const [remember, setRemember] = useState(true);
  const [hold, setHold] = useState("");
  const [leaveNote, setLeaveNote] = useState("");
  const [savedRemember, setSavedRemember] = useState(true);
  const wroteReview = useRef(false);
  const closedReview = useRef(false);
  closedReview.current = wroteReview.current || (kept != null && live == null);
  const picked = useRef({ projectId, categoryId, remember });
  const sharedTx = useRef<string | null>(null);
  sharedTx.current = row?.transaction_id ?? null;
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const seeded = useRef(false);
  const baseline = useRef({ projectId: "", categoryId: "", remember: true });
  const toasted = useRef(false);
  const phase = sample
    ? ({ kind: "ready" } as const)
    : combinePhase(combinePhase(screenPhase(preview, dashboard), screenPhase(preview, categories)), screenPhase(preview, review));
  const direction = sample?.direction ?? row?.direction ?? "expense";
  const formPhase = phase.kind === "ready" && sample == null && row == null ? ({ kind: "empty" } as const) : phase;
  const income = direction === "income";
  const splitReview = sample?.split === true || reviewIsSplit(row);
  useEffect(() => {
    if (hold === "") return;
    const complete = splitReview ? categoryId !== "" : projectId !== "" && categoryId !== "";
    if (complete) setHold("");
  }, [hold, splitReview, projectId, categoryId]);
  useEffect(() => {
    if (leaveNote !== "" && remember === savedRemember) setLeaveNote("");
  }, [leaveNote, remember, savedRemember]);
  useEffect(() => {
    if (sample || !row || seeded.current) return;
    if (jev.loading) return;
    seeded.current = true;
    const filled = withJev(row, jev);
    const nextProject = filled.project_id ?? "";
    const nextCategory = filled.category_id ?? "";
    // FLOW-703: a category seeded from Jev's guess is not a supplier rule until the owner says so.
    const jevSeeded = filled.category_id !== row.category_id;
    baseline.current = { projectId: nextProject, categoryId: nextCategory, remember: !jevSeeded };
    setProjectId(nextProject);
    setCategoryId(nextCategory);
    if (jevSeeded) {
      setRemember(false);
      setSavedRemember(false);
    }
  }, [sample, row, jev]);
  useEffect(() => {
    if (!sample?.saveError || toasted.current) return;
    toasted.current = true;
    toast.show({
      tone: "bad",
      message: CHANGE_SAVE_FAILURE,
      action: "ניסיון חוזר",
      onAction: () => undefined,
    });
  }, [sample?.saveError, toast]);
  const filledRow = row ? withJev(row, jev) : row;
  const suggestionProjectId = sample
    ? (sample.project_suggested === false ? "" : (sample.suggestionId ?? ""))
    : (filledRow?.project_suggested === true ? (filledRow.project_id ?? "") : "");
  const suggestionCategoryId = sample?.suggestionCategoryId ?? sample?.categoryId ?? filledRow?.category_id ?? "";
  const projectOptions = withChoice(
    [...(sample?.projects ?? (dashboard.data?.projects ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
    }))), ...extraProjects],
    projectId,
    row?.project_name,
  );
  const reversalOptions = splitReview ? [] : reversalChoices(sample?.categories ?? categories.data ?? [], income ? "income" : "expense", sample?.categoryId ?? row?.category_id);
  const isReversalId = (id: string) => reversalOptions.some((option) => option.id === id);
  // The switch is hidden on a reversal, so it must not hold the sheet open.
  const rememberDirty = !income && !splitReview && !isReversalId(categoryId) && remember !== savedRemember;
  const categoryOptions = withChoice(
    (sample?.categories ?? categories.data ?? []).filter((category) => {
      if (category.hidden) return false;
      return income ? category.kind === "income" : category.kind !== "income";
    }).map((category) => ({ id: category.id, name: category.name })),
    isReversalId(categoryId) ? "" : categoryId,
    row?.category_name,
  );
  const save = useWrite({
    failure: changeSaveFailure,
    success: "השיוך נשמר",
    keys: ["review", "dashboard", "project", "project-category", "project-waiting"],
    onSplit: () => {
      if (!row?.transaction_id) return;
      void navigate(`/transactions/${row.transaction_id}/split${search}`, { replace: true });
    },
    onSuccess: () => {
      setSavedRemember(picked.current.remember);
      setProjectId(picked.current.projectId);
      setCategoryId(picked.current.categoryId);
      wroteReview.current = true;
    },
    run: async () => {
      const supabase = getSupabase();
      const next = picked.current;
      if (!supabase || item === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: item,
        p_action: "changed",
        p_project_id: next.projectId,
        p_category_id: next.categoryId,
        p_remember: next.remember,
      }));
    },
  });
  const lineField = useRef(false);
  const setSharedCategory = useWrite({
    failure: changeSaveFailure,
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      setCategoryId(picked.current.categoryId);
      toast.show({
        message: "השיוך נשמר",
        ...(lineField.current ? { place: "page" as const } : {}),
      });
    },
    run: async () => {
      const supabase = getSupabase();
      const transactionId = sharedTx.current;
      const nextCategory = picked.current.categoryId;
      if (!supabase || transactionId == null || nextCategory === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("set_transaction_category", {
        p_id: transactionId,
        p_category_id: nextCategory,
        ...(lineField.current ? { p_resolve: false } : {}),
      }));
    },
  });
  const fieldSave = useRef<{ kind: "project" | "category"; id: string } | null>(null);
  const saveField = useWrite({
    failure: changeSaveFailure,
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      const pickedField = fieldSave.current;
      if (pickedField?.kind === "project") setProjectId(pickedField.id);
      else if (pickedField) setCategoryId(pickedField.id);
      toast.show({ message: "השיוך נשמר", place: "page" });
    },
    run: async () => {
      const supabase = getSupabase();
      const next = fieldSave.current;
      if (!supabase || item === "" || next == null) throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: item,
        p_action: "changed",
        p_resolve: false,
        ...(next.kind === "project" ? { p_project_id: next.id } : { p_category_id: next.id }),
      }));
    },
  });
  const sharedUndoId = useRef<string | null>(null);
  const undoShared = useWrite({
    failure: "לא הצלחנו לבטל את השיוך.",
    success: "השיוך הקודם חזר",
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase || sharedUndoId.current == null) throw new Error("supabase");
      assertNoError(await supabase.rpc("undo_reassign", { p_id: sharedUndoId.current }));
    },
  });
  const reassignClosed = useWrite({
    failure: changeSaveFailure,
    success: "השיוך נשמר",
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      setProjectId(picked.current.projectId);
      setCategoryId(picked.current.categoryId);
      baseline.current = { ...baseline.current, projectId: picked.current.projectId, categoryId: picked.current.categoryId };
    },
    run: async () => {
      const supabase = getSupabase();
      const next = picked.current;
      const transactionId = sharedTx.current;
      if (!supabase || transactionId == null || next.categoryId === "") throw new Error("supabase");
      if (next.projectId === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("reassign_transaction", {
        p_id: transactionId,
        p_project_id: next.projectId,
        p_category_id: next.categoryId,
      }));
    },
  });
  const collapseShared = useWrite({
    failure: changeSaveFailure,
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      setProjectId(picked.current.projectId);
      const id = sharedUndoId.current;
      toast.show({
        message: "השיוך נשמר",
        ...(id ? { action: "ביטול", onAction: () => { undoShared.mutate(); } } : {}),
      });
    },
    run: async () => {
      sharedUndoId.current = await collapseSplit(sharedTx.current ?? "", picked.current.projectId);
    },
  });

  async function createProject(name: string): Promise<ChangeChoice> {
    if (holdWrites) throw new Error("preview");
    return saveNewProject(name, blocked, toast, (project) => {
      setExtraProjects((list) => [...list, project]);
    }, invalidate);
  }

  const fromList = (params.get("from") === "all" || params.get("list") === "all") && item !== "";
  const closeTo = fromList ? reviewFocusPath(search, item) : `/review${search}`;
  const linePick = params.get("from") === "line" ? params.get("pick") : null;
  const returnFocusRef = linePick === "project"
    ? reviewLineFocus.project
    : linePick === "category"
      ? reviewLineFocus.category
      : undefined;
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  if (formPhase.kind !== "ready") {
    return (
      <RouteSheet title="שינוי שיוך" closeTo={closeTo} returnFocusRef={returnFocusRef}>
        <ScreenState title="שינוי שיוך" phase={formPhase} onRetry={() => { void dashboard.refetch(); void categories.refetch(); void review.refetch(); }} />
      </RouteSheet>
    );
  }

  return (
    <ChangeAssignment
      host="route"
      closeTo={closeTo}
      returnFocusRef={returnFocusRef}
      supplier={sample?.supplier ?? row?.supplier_name ?? row?.description ?? ""}
      amount={sample?.amount ?? (row ? formatAmountText(absAgorot(row.amount_net), row.currency, {
        direction: income ? "income" : "expense",
        detail: true,
      }) : "")}
      direction={income ? "income" : "expense"}
      projects={projectOptions}
      categories={categoryOptions}
      reversals={reversalOptions}
      projectId={projectId}
      categoryId={categoryId}
      suggestionProjectId={suggestionProjectId}
      suggestionCategoryId={suggestionCategoryId}
      onProjectId={setProjectId}
      onCategoryId={setCategoryId}
      {...(income || splitReview ? {} : { remember, onRemember: setRemember })}
      categorySuggested={sample ? sample.categorySuggested !== false : filledRow?.category_suggested !== false}
      hold={hold || leaveNote}
      pending={rememberDirty && !wroteReview.current && !closedReview.current}
      projectNote={splitReview ? COLLAPSE_SPLIT_NOTE : undefined}
      projectTitle={sample?.splitTitle ?? (splitReview && row ? reviewSplitTitle(row) : undefined)}
      initialQuery={sample?.initialQuery}
      loading={sample?.loading}
      onDiscard={() => {
        setProjectId(baseline.current.projectId);
        setCategoryId(baseline.current.categoryId);
        setRemember(baseline.current.remember);
        setSavedRemember(baseline.current.remember);
        setHold("");
        setLeaveNote("");
      }}
      onCommitPick={async (kind, id) => {
        if (sample || holdWrites) return undefined;
        if (blocked()) throw new Error("preview");
        const nextProject = kind === "project" ? id : projectId;
        const nextCategory = kind === "category" ? id : categoryId;
        // A supplier rule never learns a reversal: the next line from this supplier is the usual kind.
        picked.current = { projectId: nextProject, categoryId: nextCategory, remember: remember && !isReversalId(nextCategory) };
        const fromLine = params.get("from") === "line";
        if (splitReview) {
          if (kind === "project") {
            if (!row?.transaction_id || id === "") throw new Error("supabase");
            await collapseShared.mutateAsync();
            return undefined;
          }
          if (!row?.transaction_id) throw new Error("supabase");
          lineField.current = fromLine;
          await setSharedCategory.mutateAsync();
          return undefined;
        }
        if (fromLine) {
          fieldSave.current = { kind, id };
          await saveField.mutateAsync();
          return undefined;
        }
        const complete = nextProject !== "" && nextCategory !== "";
        if (!complete) {
          setHold("בחרו פרויקט וקטגוריה.");
          return "hold";
        }
        setHold("");
        if (closedReview.current) {
          await reassignClosed.mutateAsync();
          return undefined;
        }
        await save.mutateAsync();
        return undefined;
      }}
      onCloseCheck={() => {
        if (sample) return Promise.resolve();
        if (blocked()) return Promise.reject(new Error("preview"));
        const complete = splitReview ? categoryId !== "" : projectId !== "" && categoryId !== "";
        if (!complete) {
          setHold(splitReview ? "בחרו קטגוריה." : "בחרו פרויקט וקטגוריה.");
          return Promise.reject(new Error("incomplete"));
        }
        if (rememberDirty && (wroteReview.current || closedReview.current)) {
          setLeaveNote("הזכירה נשמרת עם השיוך. החזירו את המתג כדי לסגור.");
          return Promise.reject(new Error("remember"));
        }
        return Promise.resolve();
      }}
      onCommitPending={async () => {
        if (sample || holdWrites) return;
        if (blocked()) throw new Error("preview");
        setHold("");
        picked.current = { projectId, categoryId, remember: remember && !isReversalId(categoryId) };
        await save.mutateAsync();
      }}
      onSplit={() => {
        if (row?.transaction_id) {
          void navigate(`/transactions/${row.transaction_id}/split${search}`, { replace: true });
          return;
        }
        toast.show({ message: "הפיצול נעשה ממסך התנועה, אחרי השיוך." });
      }}
      onCreateProject={createProject}
    />
  );
}
