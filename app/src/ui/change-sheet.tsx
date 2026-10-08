import { useEffect, useId, useRef, useState, type RefObject, type SubmitEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { REVERSAL_HEADING, REVERSAL_HINT } from "../reversal";
import { isTransientWriteError, type WriteFailure } from "../use-write";
import { Button } from "./button";
import { HoldLine } from "./hold-line";
import { IconButton } from "./icon-button";
import { BackIcon, ChevronDownIcon, PlusIcon, SplitIcon } from "./icons";
import { ListRow } from "./list-row";
import { RadioRow } from "./radio-row";
import { RouteSheet } from "./route-sheet";
import { SearchField } from "./search-field";
import { ReversalTag, SuggestTag } from "./suggest-tag";
import { Sheet } from "./sheet";
import { Skeleton } from "./skeleton";
import { TextField } from "./text-field";
import { TextLink } from "./text-link";
import { Toggle } from "./toggle";

export const CHANGE_SAVE_FAILURE = "לא נשמר – אין חיבור";

/** A refusal the database will repeat. Not a connection problem. Decision 0072. */
export const CHANGE_SAVE_REFUSAL = "לא נשמר. בדקו את הפרטים ונסו שוב.";

/** The database refuses one project on a shared cost. Say where the split happens. */
export const SHARED_SPLIT_FAILURE = "עלות משותפת מחולקת במסך החלוקה.";

/** Decision 0076. The fourth split choice, and the note above the project picker. */
export const ONE_PROJECT_OPTION = "לפרויקט אחד";
export const ONE_PROJECT_DETAIL = "הסכום כולו עובר לפרויקט אחד";
export const COLLAPSE_SPLIT_NOTE = "החלוקה תרד, והסכום כולו יעבור לפרויקט הזה.";
export const COLLAPSE_PICK_HOLD = "בחרו פרויקט.";

export function changeSaveFailure(error: Error): WriteFailure {
  if (error.message.includes("shared costs are split")) {
    return { message: SHARED_SPLIT_FAILURE, retry: false, tone: "info", action: "לחלוקה" };
  }
  if (isTransientWriteError(error)) return CHANGE_SAVE_FAILURE;
  return { message: CHANGE_SAVE_REFUSAL, retry: false };
}

export type ChangeChoice = {
  id: string;
  name: string;
  code?: string;
  /** Relative last use. Recent rows keep the order they are given. */
  recent?: string;
  status?: "active" | "finished";
  /** Hidden categories stay out of the picker. The current row can still show. */
  hidden?: boolean;
};

type ChangeView = "summary" | "project" | "category" | "new";

type Shared = {
  supplier: string;
  amount: string;
  direction: "income" | "expense";
  projects: ChangeChoice[];
  categories: ChangeChoice[];
  projectId: string;
  categoryId: string;
  suggestionProjectId?: string;
  suggestionCategoryId?: string;
  onProjectId: (id: string) => void;
  onCategoryId: (id: string) => void;
  /** Omitted when the save cannot store a supplier rule. */
  remember?: boolean;
  onRemember?: (value: boolean) => void;
  /**
   * A project or category tap. Resolves after the write. Rejects to roll the check back.
   * "left" means the screen already navigated, so the picker must not pop history.
   * Omitted in a story, which only updates the local choice.
   */
  onCommitPick?: (kind: "project" | "category", id: string) => Promise<undefined | "left" | "hold">;
  /**
   * Runs on every close. Rejects with "incomplete" or "remember" to stay open.
   * It must not write. A write belongs in onCommitPending, and only when pending.
   */
  onCloseCheck?: () => Promise<void>;
  /** A pending edit that is not a pick, such as the remember switch. Rejects to stay open. */
  onCommitPending?: () => Promise<void>;
  /** True when leaving should write onCommitPending. An unchanged sheet is not pending. */
  pending?: boolean;
  /** False once the owner has chosen the category. A suggestion still shows הצעה. */
  categorySuggested?: boolean;
  /** An incomplete edit. Leaving stays open and this sentence shows on the summary. */
  hold?: string;
  /** The history pop of an overlay sheet. The same check as the backdrop and the X. */
  leave?: { current: () => Promise<boolean> };
  /** A split already has its projects. The sheet changes the category only. */
  categoryOnly?: boolean;
  /** Shown on the project row when the id is still empty, such as a split label. */
  projectTitle?: string;
  /** Shown above the project list. A split uses it to say the shares will go. */
  projectNote?: string;
  /** The picker stays in this component instead of the page URL. */
  contained?: boolean;
  /**
   * With contained, open straight onto that list. ✕, Escape, חזרה and Back then close
   * the sheet, with no stop at the summary.
   */
  start?: "summary" | "project" | "category";
  /** The one-project picker hides the link that only returns to the split screen. */
  hideSplitLink?: boolean;
  /** Throw away an incomplete edit. The sheet then closes. */
  onDiscard?: () => void;
  onSplit: () => void;
  onCreateProject: (name: string) => Promise<ChangeChoice>;
  /** Story search text. A real open starts empty. */
  initialQuery?: string;
  /**
   * The other kind's categories, for a bounced payment or a refund ([0103](../../../docs/decisions/0103-reversals-across-directions.md)).
   * Listed under their own heading in the category picker. Omitted on a split line.
   */
  reversals?: ChangeChoice[];
  loading?: boolean;
  /**
   * FLOW-325 local picks: a project row with id "" and this label tops the project list,
   * such as "בלי פרויקט". Omitted when a project is required (a reversal part).
   */
  noProjectLabel?: string;
  /** FLOW-325: a category pick moves on to the project list instead of closing. */
  chainProject?: boolean;
};

type Props = Shared & (
  | { host: "route"; closeTo: string; returnFocusRef?: RefObject<HTMLElement | null> }
  | { host: "overlay"; open: boolean; onOpenChange: (open: boolean) => void; returnFocusRef?: RefObject<HTMLElement | null> }
);

const skeletonKeys = ["a", "b", "c", "d", "e"] as const;

function searchOf(params: URLSearchParams): string {
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

function keptState(current: { readonly state: unknown }): unknown {
  return current.state;
}

function ordered(options: ChangeChoice[], suggestionId: string, currentId: string, query: string, kind: "project" | "category"): ChangeChoice[] {
  const active = options.filter((option) => {
    if (option.hidden && option.id !== currentId && option.id !== suggestionId) return false;
    return option.status !== "finished" || option.id === currentId || option.id === suggestionId;
  });
  const needle = query.trim();
  const matched = needle === ""
    ? active
    : active.filter((option) => option.name.includes(needle) || (option.code ?? "").toLowerCase().includes(needle.toLowerCase()));
  if (needle !== "") return matched;
  const suggestion = matched.find((option) => option.id === suggestionId);
  const rest = matched.filter((option) => option.id !== suggestionId);
  if (kind === "category") return suggestion ? [suggestion, ...rest] : rest;
  const recent = rest.filter((option) => option.recent);
  const others = rest.filter((option) => !option.recent);
  return [...(suggestion ? [suggestion] : []), ...recent, ...others];
}

export function ChangeAssignment(props: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const income = props.direction === "income";
  const params = new URLSearchParams(location.search);
  const urlPick = params.get("pick");
  const [creatingNew, setCreatingNew] = useState(false);
  const startView: ChangeView = props.start === "project" || props.start === "category" ? props.start : "summary";
  const [containedView, setContainedView] = useState<ChangeView>(startView);
  /** The contained picker the sheet opened on. Leaving it closes the sheet. */
  const [landed, setLanded] = useState(startView !== "summary");
  const [openSeen, setOpenSeen] = useState(props.host === "overlay" ? props.open : true);
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState("");
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [ownedCategory, setOwnedCategory] = useState(props.categorySuggested === false);
  const [reversalOpen, setReversalOpen] = useState(false);
  const settled = useRef(false);
  const inflight = useRef<Promise<boolean> | null>(null);
  const warned = useRef(false);
  const forceDiscard = useRef(false);
  const requestClose = useRef<(() => void) | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const projectBtn = useRef<HTMLButtonElement>(null);
  const categoryBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<"project" | "category">(urlPick === "category" ? "category" : "project");
  const pendingFocus = useRef<"project" | "category" | null>(null);
  const depth = useRef(0);
  const ignorePop = useRef(0);
  const afterPop = useRef<(() => void) | null>(null);
  const guardPop = useRef<((here: typeof location) => Promise<boolean>) | null>(null);
  const locationRef = useRef(location);
  locationRef.current = location;

  const urlView: ChangeView = urlPick === "project" || urlPick === "category" ? urlPick : "summary";
  const view: ChangeView = creatingNew
    ? "new"
    : props.contained
      ? containedView
      : urlView;
  const sheetOpen = props.host === "overlay" ? props.open : true;
  if (openSeen !== sheetOpen) {
    setOpenSeen(sheetOpen);
    // Set during render, so the first open frame already shows the start view.
    if (sheetOpen && props.contained) {
      setContainedView(startView);
      setLanded(startView !== "summary");
      setCreatingNew(false);
      setQuery("");
      setReversalOpen(false);
    }
  }

  useEffect(() => {
    if (!props.hold) warned.current = false;
  }, [props.hold]);

  useEffect(() => {
    if (props.categorySuggested === false) setOwnedCategory(true);
  }, [props.categorySuggested]);

  useEffect(() => {
    if (sheetOpen) {
      settled.current = false;
      forceDiscard.current = false;
    }
  }, [sheetOpen]);

  useEffect(() => {
    function onPop() {
      if (ignorePop.current > 0) {
        ignorePop.current -= 1;
        const run = afterPop.current;
        afterPop.current = null;
        run?.();
        return;
      }
      if (depth.current === 0 && guardPop.current) {
        const here = locationRef.current;
        void guardPop.current(here);
        return;
      }
      depth.current = Math.max(0, depth.current - 1);
      setCreatingNew(false);
    }
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    if (view !== "summary") {
      titleRef.current?.focus({ preventScroll: true });
      return;
    }
    const which = pendingFocus.current;
    if (!which) return;
    pendingFocus.current = null;
    const node = which === "project" ? projectBtn.current : categoryBtn.current;
    node?.focus();
  }, [view]);

  function go(search: string, replace: boolean) {
    const current = locationRef.current;
    void navigate(
      { pathname: current.pathname, search, hash: current.hash },
      { replace, state: keptState(current) },
    );
  }

  function pushPick(next: "project" | "category") {
    const current = locationRef.current;
    const nextParams = new URLSearchParams(current.search);
    nextParams.set("pick", next);
    depth.current += 1;
    void navigate(
      { pathname: current.pathname, search: searchOf(nextParams), hash: current.hash },
      { state: keptState(current) },
    );
  }

  function openPicker(next: "project" | "category") {
    opener.current = next;
    setQuery("");
    setReversalOpen(false);
    setCreatingNew(false);
    if (props.contained) {
      setLanded(false);
      setContainedView(next);
      return;
    }
    pushPick(next);
  }

  function closePickLevel() {
    if (depth.current > 0) {
      depth.current -= 1;
      ignorePop.current += 1;
      void navigate(-1);
      return;
    }
    const nextParams = new URLSearchParams(locationRef.current.search);
    nextParams.delete("pick");
    go(searchOf(nextParams), true);
  }

  /** A picker opened from a card line. from=line is that entry. A refreshed שינוי URL has no marker. */
  function landedOnPicker(): boolean {
    if (props.host !== "route" || props.contained) return false;
    if (depth.current > 0) return false;
    const search = new URLSearchParams(locationRef.current.search);
    const pick = search.get("pick");
    return search.get("from") === "line" && (pick === "project" || pick === "category");
  }

  /** A picker that was not opened from a card line. ✕ returns to the summary. */
  function summaryUnderPicker(): boolean {
    if (props.host !== "route" || props.contained) return false;
    const search = new URLSearchParams(locationRef.current.search);
    const pick = search.get("pick");
    if (pick !== "project" && pick !== "category") return false;
    return search.get("from") !== "line";
  }

  function back() {
    if (creatingNew) {
      setCreatingNew(false);
      if (props.contained && !landed) setContainedView("summary");
      return;
    }
    if (props.contained) {
      if (landed && props.host === "overlay") {
        props.onOpenChange(false);
        return;
      }
      pendingFocus.current = containedView === "category" ? "category" : "project";
      setLanded(false);
      setContainedView("summary");
      return;
    }
    if (landedOnPicker()) {
      requestClose.current?.();
      return;
    }
    pendingFocus.current = view === "category" ? "category" : "project";
    closePickLevel();
  }

  function discardPicker() {
    setCreatingNew(false);
    if (propsRef.current.contained) return;
    const steps = depth.current;
    if (steps === 0) return;
    depth.current = 0;
    ignorePop.current += 1;
    void navigate(-steps);
  }

  function afterHistory(run: () => void) {
    if (depth.current === 0) {
      run();
      return;
    }
    afterPop.current = run;
    depth.current -= 1;
    ignorePop.current += 1;
    void navigate(-1);
  }

  async function commitChoice(kind: "project" | "category", id: string, previous: string): Promise<"stay" | "left" | "hold"> {
    if (!props.onCommitPick) return "stay";
    setSavingId(id);
    const work = (async (): Promise<"stay" | "left" | "hold"> => {
      try {
        const outcome = await props.onCommitPick?.(kind, id);
        setSavingId(null);
        if (outcome === "left" || outcome === "hold") return outcome;
        return "stay";
      } catch {
        setSavingId(null);
        if (kind === "project") props.onProjectId(previous);
        else props.onCategoryId(previous);
        return "left";
      }
    })();
    const gate = work.then((outcome) => outcome !== "left");
    inflight.current = gate;
    try {
      return await work;
    } finally {
      if (inflight.current === gate) inflight.current = null;
    }
  }

  function finishPick(outcome: "stay" | "left" | "hold") {
    if (outcome === "left") return;
    if (outcome === "hold") {
      if (props.contained) {
        setLanded(false);
        setContainedView("summary");
      } else closePickLevel();
      return;
    }
    if (props.contained) {
      if (landed && props.host === "overlay") {
        props.onOpenChange(false);
        return;
      }
      setLanded(false);
      setContainedView("summary");
      return;
    }
    if (landedOnPicker()) {
      requestClose.current?.();
      return;
    }
    closePickLevel();
  }

  async function choose(kind: "project" | "category", id: string) {
    const previous = kind === "project" ? props.projectId : props.categoryId;
    if (kind === "project") props.onProjectId(id);
    else props.onCategoryId(id);
    opener.current = kind;
    pendingFocus.current = kind;
    setCreatingNew(false);
    const outcome = await commitChoice(kind, id, previous);
    if (kind === "category" && outcome !== "left") setOwnedCategory(true);
    if (kind === "category" && outcome === "stay" && props.contained && props.chainProject === true) {
      setQuery("");
      setContainedView("project");
      return;
    }
    finishPick(outcome);
  }

  async function submitNew(event: SubmitEvent) {
    event.preventDefault();
    const clean = newName.trim();
    if (clean.length < 2) {
      setNameError("השם קצר מדי");
      return;
    }
    setNameError("");
    setCreating(true);
    const previous = props.projectId;
    try {
      const created = await props.onCreateProject(clean);
      props.onProjectId(created.id);
      opener.current = "project";
      pendingFocus.current = "project";
      setCreatingNew(false);
      const outcome = await commitChoice("project", created.id, previous);
      setCreating(false);
      finishPick(outcome);
    } catch {
      setCreating(false);
      return;
    }
    setCreating(false);
  }

  const projectName = props.projects.find((option) => option.id === props.projectId)?.name ?? "";
  const projectLabel = projectName !== "" ? projectName : (props.projectTitle ?? "לא נבחר");
  const reversalOptions = props.reversals ?? [];
  const categoryReversal = reversalOptions.some((option) => option.id === props.categoryId);
  const categoryName = [...props.categories, ...reversalOptions].find((option) => option.id === props.categoryId)?.name ?? "";
  const projectSuggested = props.suggestionProjectId != null && props.suggestionProjectId !== "" && props.projectId === props.suggestionProjectId;
  const categorySuggestionId = ownedCategory ? "" : (props.suggestionCategoryId ?? "");
  const categorySuggested = categorySuggestionId !== "" && props.categoryId === categorySuggestionId;
  const pickerKind = view === "category" ? "category" : "project";
  const listed = ordered(
    pickerKind === "project" ? props.projects : props.categories,
    pickerKind === "project" ? (props.suggestionProjectId ?? "") : categorySuggestionId,
    pickerKind === "project" ? props.projectId : props.categoryId,
    query,
    pickerKind,
  );
  const title = view === "project" ? "בחירת פרויקט" : view === "category" ? "בחירת קטגוריה" : view === "new" ? "פרויקט חדש" : "שינוי שיוך";
  const leading = view === "summary" || landedOnPicker() ? undefined : (
    <IconButton label="חזרה" onClick={back}>
      <BackIcon />
    </IconButton>
  );
  const reversalListed = pickerKind === "category"
    ? ordered(reversalOptions, "", props.categoryId, query, "category")
    : [];
  const pickerTotal = ordered(
    pickerKind === "project" ? props.projects : props.categories,
    pickerKind === "project" ? (props.suggestionProjectId ?? "") : categorySuggestionId,
    pickerKind === "project" ? props.projectId : props.categoryId,
    "",
    pickerKind,
  ).length;
  const showRemember = !income && !categoryReversal && props.remember != null && props.onRemember != null;
  const propsRef = useRef(props);
  propsRef.current = props;

  function closeSheet(discard: boolean): boolean {
    forceDiscard.current = false;
    if (discard) propsRef.current.onDiscard?.();
    settled.current = true;
    discardPicker();
    return true;
  }

  function discardHeld() {
    forceDiscard.current = true;
    requestClose.current?.();
  }

  async function allowClose(): Promise<boolean> {
    if (settled.current) return true;
    if (forceDiscard.current) return closeSheet(true);
    const flight = inflight.current;
    if (flight) {
      try {
        await flight;
      } catch {
        // The write already toasted. The dismiss still closes.
      }
      if (landedOnPicker()) return closeSheet(true);
      return closeSheet(false);
    }
    if (landedOnPicker()) return closeSheet(true);
    if (summaryUnderPicker()) {
      closePickLevel();
      const current = propsRef.current;
      if (current.onCloseCheck) {
        try {
          await current.onCloseCheck();
        } catch (error) {
          const incomplete = error instanceof Error && (error.message === "incomplete" || error.message === "remember");
          if (incomplete) warned.current = true;
        }
      }
      return false;
    }
    const current = propsRef.current;
    if (current.hold) {
      if (!warned.current) {
        warned.current = true;
        return false;
      }
      return closeSheet(true);
    }
    if (current.onCloseCheck) {
      try {
        await current.onCloseCheck();
      } catch (error) {
        const incomplete = error instanceof Error && (error.message === "incomplete" || error.message === "remember");
        if (incomplete) warned.current = true;
        return false;
      }
    }
    if (current.pending && current.onCommitPending) {
      try {
        await current.onCommitPending();
      } catch (error) {
        const incomplete = error instanceof Error && (error.message === "incomplete" || error.message === "remember");
        if (incomplete) warned.current = true;
        return false;
      }
    }
    settled.current = true;
    discardPicker();
    return true;
  }

  if (props.leave) props.leave.current = allowClose;
  if (props.host === "route") {
    guardPop.current = async (here) => {
      const ok = await allowClose();
      if (ok) return true;
      void navigate(
        { pathname: here.pathname, search: here.search, hash: here.hash },
        { state: keptState(here) },
      );
      return false;
    };
  }

  const body = (
    <div key={view} className="ui-change-swap">
      {view === "summary" ? (
        <div className="ui-change-summary">
          <p className="ui-change-context t-label">
            {props.supplier}
            {props.supplier !== "" && props.amount !== "" ? " · " : null}
            {props.amount !== "" ? <bdi className="ui-num" dir="ltr">{props.amount}</bdi> : null}
          </p>
          <div className="ui-change-rows">
            {props.categoryOnly ? null : (
              <ListRow
                variant="button"
                buttonRef={projectBtn}
                eyebrow="פרויקט"
                title={projectLabel}
                label={`פרויקט: ${projectLabel}, שינוי`}
                tag={projectSuggested ? <SuggestTag /> : undefined}
                chevron
                onClick={() => {
                  openPicker("project");
                }}
              />
            )}
            <ListRow
              variant="button"
              buttonRef={categoryBtn}
              eyebrow="קטגוריה"
              title={categoryName === "" ? "לא נבחר" : categoryName}
              label={`קטגוריה: ${categoryName === "" ? "לא נבחר" : categoryName}${categoryReversal ? ", החזר" : ""}, שינוי`}
              tag={categorySuggested ? <SuggestTag /> : categoryReversal ? <ReversalTag /> : undefined}
              chevron
              onClick={() => {
                openPicker("category");
              }}
            />
          </div>
          {props.hold ? <HoldLine onDiscard={discardHeld}>{props.hold}</HoldLine> : null}
          {showRemember ? (
            <Toggle
              label="לזכור לספק הזה"
              checked={props.remember === true}
              onChange={props.onRemember ?? (() => undefined)}
              hint={
                <span className="ui-remember-line">
                  <span className="ui-remember-supplier">{props.supplier}</span>
                  <span className="ui-remember-dest">
                    {/* Only the arrow is LTR. A space inside the bdi lands on the wrong side in RTL (FLOW-328). */}
                    <bdi className="ui-remember-join" dir="ltr">←</bdi>
                    {"\u00A0\u2060"}
                    {projectName === "" ? "פרויקט" : projectName}
                    {" · "}
                    {categoryName === "" ? "קטגוריה" : categoryName}
                  </span>
                </span>
              }
            />
          ) : null}
        </div>
      ) : null}
      {view === "project" || view === "category" ? (
        <Picker
          kind={pickerKind}
          searchable={pickerKind === "project" || pickerTotal > 8}
          query={query}
          onQuery={setQuery}
          loading={props.loading === true}
          listed={listed}
          selectedId={pickerKind === "project" ? props.projectId : props.categoryId}
          suggestionId={pickerKind === "project" ? (props.suggestionProjectId ?? "") : categorySuggestionId}
          savingId={savingId}
          note={pickerKind === "project" ? props.projectNote : undefined}
          noneLabel={pickerKind === "project" ? props.noProjectLabel : undefined}
          reversal={pickerKind === "category" && reversalOptions.length > 0 ? {
            heading: REVERSAL_HEADING[props.direction],
            hint: REVERSAL_HINT[props.direction],
            listed: reversalListed,
            open: reversalOpen,
            onToggle: () => {
              setReversalOpen((open) => !open);
            },
          } : undefined}
          splitLink={pickerKind === "project" && props.hideSplitLink !== true}
          onSelect={(id) => {
            void choose(pickerKind, id);
          }}
          onCreate={pickerKind === "project" ? () => {
            setNewName("");
            setNameError("");
            setCreatingNew(true);
          } : undefined}
          onSplit={pickerKind === "project" && props.hideSplitLink !== true ? () => {
            afterHistory(props.onSplit);
          } : undefined}
        />
      ) : null}
      {view === "new" ? (
        <form className="ui-stack" onSubmit={(event) => { void submitNew(event); }}>
          <TextField
            label="שם"
            value={newName}
            error={nameError === "" ? undefined : nameError}
            onChange={(event) => {
              setNewName(event.target.value);
            }}
          />
          <Button type="submit" busy={creating}>שמירה</Button>
        </form>
      ) : null}
    </div>
  );

  const chrome = {
    title,
    leading,
    titleRef,
    panelClassName: view === "project" || view === "new" ? "ui-sheet-tall" : "ui-sheet-fit",
    onEscape: view === "summary" ? undefined : back,
    onBeforeClose: allowClose,
    onRequestClose: requestClose,
    children: body,
  };

  if (props.host === "route") {
    return <RouteSheet closeTo={props.closeTo} returnFocusRef={props.returnFocusRef} {...chrome} />;
  }
  return <Sheet open={props.open} onOpenChange={props.onOpenChange} returnFocusRef={props.returnFocusRef} {...chrome} />;
}

function Picker({
  kind,
  searchable,
  query,
  onQuery,
  loading,
  listed,
  selectedId,
  suggestionId,
  savingId,
  note,
  noneLabel,
  reversal,
  splitLink = true,
  onSelect,
  onCreate,
  onSplit,
}: {
  kind: "project" | "category";
  searchable: boolean;
  query: string;
  onQuery: (value: string) => void;
  loading: boolean;
  listed: ChangeChoice[];
  selectedId: string;
  suggestionId: string;
  savingId: string | null;
  note?: string;
  /** A first row with id "", such as "בלי פרויקט". Hidden while searching. */
  noneLabel?: string;
  /** The other kind's section. Shown only when it has categories. */
  reversal?: {
    heading: string;
    hint: string;
    listed: ChangeChoice[];
    open: boolean;
    onToggle: () => void;
  };
  splitLink?: boolean;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  onSplit?: () => void;
}) {
  const needle = query.trim();
  const sectionId = useId();
  const reversalListed = reversal?.listed ?? [];
  const empty = !loading && needle !== "" && listed.length === 0 && reversalListed.length === 0;
  // A checked reversal, or a search that finds one, keeps the section open so the match can be seen and reached.
  const reversalForced = reversalListed.some((option) => option.id === selectedId) || (needle !== "" && reversalListed.length > 0);
  const reversalShown = reversal != null && (reversal.open || reversalForced);
  const reversalVisible = reversal != null && (needle === "" || reversalListed.length > 0);
  function row(option: ChangeChoice) {
    return (
      <RadioRow
        key={option.id}
        layout="picker"
        label={option.name}
        code={option.code}
        date={needle === "" ? option.recent : undefined}
        tag={option.id === suggestionId}
        selected={option.id === selectedId}
        busy={option.id === savingId}
        disabled={savingId != null && option.id !== savingId}
        onSelect={() => {
          onSelect(option.id);
        }}
      />
    );
  }
  return (
    <div className="ui-change-picker">
      {searchable ? (
        <SearchField
          label={kind === "project" ? "חיפוש פרויקט" : "חיפוש קטגוריה"}
          value={query}
          onChange={onQuery}
          placeholder={kind === "project" ? "חיפוש פרויקט או קוד (P-12)" : "חיפוש קטגוריה"}
          autoFocus={false}
        />
      ) : null}
      {note ? <p className="t-hint ui-pick-note">{note}</p> : null}
      {loading ? (
        <div aria-busy="true">
          <p className="sr-only" role="status">טוען…</p>
          {skeletonKeys.map((key) => (
            <div className="ui-radio-row" key={key} aria-hidden="true">
              <Skeleton width="md" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {listed.length > 0 || (noneLabel != null && needle === "") ? (
            <div role="radiogroup" aria-label={kind === "project" ? "פרויקט" : "קטגוריה"}>
              {noneLabel != null && needle === "" ? (
                <RadioRow
                  key="none"
                  layout="picker"
                  label={noneLabel}
                  selected={selectedId === ""}
                  busy={savingId === ""}
                  disabled={savingId != null && savingId !== ""}
                  onSelect={() => {
                    onSelect("");
                  }}
                />
              ) : null}
              {listed.map(row)}
            </div>
          ) : null}
          {reversal && reversalVisible ? (
            <div className="ui-reversal">
              {reversalForced ? (
                <p className="t-label ui-reversal-head">{reversal.heading}</p>
              ) : (
                <TextLink
                  chevron={false}
                  expanded={reversalShown}
                  controls={sectionId}
                  trailing={<ChevronDownIcon size={16} />}
                  onClick={reversal.onToggle}
                >
                  {reversal.heading}
                </TextLink>
              )}
              <div id={sectionId} hidden={!reversalShown}>
                {reversalShown ? (
                  <>
                    <p className="t-hint ui-reversal-hint" id={`${sectionId}-hint`}>{reversal.hint}</p>
                    <div role="radiogroup" aria-label={reversal.heading} aria-describedby={`${sectionId}-hint`}>
                      {reversalListed.map(row)}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
          {empty ? <p className="t-hint">{kind === "project" ? "לא נמצא פרויקט בשם הזה" : "לא נמצאה קטגוריה בשם הזה"}</p> : null}
        </>
      )}
      {kind === "project" && !loading ? (
        <div className="ui-change-links">
          <TextLink icon={<PlusIcon size={16} />} chevron={false} onClick={onCreate}>פרויקט חדש</TextLink>
          {splitLink && onSplit ? <TextLink icon={<SplitIcon size={16} />} chevron={false} onClick={onSplit}>פיצול בין פרויקטים</TextLink> : null}
        </div>
      ) : null}
    </div>
  );
}
