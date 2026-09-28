import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { BackIcon, CheckIcon, PlusIcon, SplitIcon } from "./icons";
import { ListRow } from "./list-row";
import { RadioRow } from "./radio-row";
import { RouteSheet } from "./route-sheet";
import { SearchField } from "./search-field";
import { Sheet } from "./sheet";
import { Skeleton } from "./skeleton";
import { TextField } from "./text-field";
import { TextLink } from "./text-link";
import { Toggle } from "./toggle";

export const CHANGE_SAVE_FAILURE = "לא נשמר – אין חיבור";

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
  onSave: () => void;
  saving?: boolean;
  /** A split already has its projects. The sheet changes the category only. */
  categoryOnly?: boolean;
  onSplit: () => void;
  onCreateProject: (name: string) => Promise<ChangeChoice>;
  /** Story search text. A real open starts empty. */
  initialQuery?: string;
  loading?: boolean;
};

type Props = Shared & (
  | { host: "route"; closeTo: string }
  | { host: "overlay"; open: boolean; onOpenChange: (open: boolean) => void }
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

function shortSupplier(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function SuggestTag() {
  return <span className="ui-suggest-tag">הצעה</span>;
}

export function ChangeAssignment(props: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const income = props.direction === "income";
  const params = new URLSearchParams(location.search);
  const urlPick = params.get("pick");
  const [creatingNew, setCreatingNew] = useState(false);
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState("");
  const [creating, setCreating] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const projectBtn = useRef<HTMLButtonElement>(null);
  const categoryBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<"project" | "category">(urlPick === "category" ? "category" : "project");
  const pendingFocus = useRef<"project" | "category" | null>(null);
  const depth = useRef(0);
  const ignorePop = useRef(0);
  const afterPop = useRef<(() => void) | null>(null);
  const locationRef = useRef(location);
  locationRef.current = location;

  const view: ChangeView = creatingNew
    ? "new"
    : urlPick === "project" || urlPick === "category"
      ? urlPick
      : "summary";

  useEffect(() => {
    function onPop() {
      if (ignorePop.current > 0) {
        ignorePop.current -= 1;
        const run = afterPop.current;
        afterPop.current = null;
        run?.();
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
      titleRef.current?.focus();
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
    setCreatingNew(false);
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

  function back() {
    if (creatingNew) {
      setCreatingNew(false);
      return;
    }
    pendingFocus.current = view === "category" ? "category" : "project";
    closePickLevel();
  }

  function discardPicker() {
    setCreatingNew(false);
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

  function choose(kind: "project" | "category", id: string) {
    if (kind === "project") props.onProjectId(id);
    else props.onCategoryId(id);
    opener.current = kind;
    pendingFocus.current = kind;
    setCreatingNew(false);
    closePickLevel();
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
    try {
      const created = await props.onCreateProject(clean);
      props.onProjectId(created.id);
      opener.current = "project";
      pendingFocus.current = "project";
      setCreatingNew(false);
      closePickLevel();
    } catch {
      setCreating(false);
      return;
    }
    setCreating(false);
  }

  const projectName = props.projects.find((option) => option.id === props.projectId)?.name ?? "";
  const categoryName = props.categories.find((option) => option.id === props.categoryId)?.name ?? "";
  const projectSuggested = props.suggestionProjectId != null && props.suggestionProjectId !== "" && props.projectId === props.suggestionProjectId;
  const categorySuggested = props.suggestionCategoryId != null && props.suggestionCategoryId !== "" && props.categoryId === props.suggestionCategoryId;
  const pickerKind = view === "category" ? "category" : "project";
  const listed = ordered(
    pickerKind === "project" ? props.projects : props.categories,
    pickerKind === "project" ? (props.suggestionProjectId ?? "") : (props.suggestionCategoryId ?? ""),
    pickerKind === "project" ? props.projectId : props.categoryId,
    query,
    pickerKind,
  );
  const title = view === "project" ? "בחירת פרויקט" : view === "category" ? "בחירת קטגוריה" : view === "new" ? "פרויקט חדש" : "שינוי שיוך";
  const leading = view === "summary" ? undefined : (
    <IconButton label="חזרה" onClick={back}>
      <BackIcon />
    </IconButton>
  );
  const action = view === "summary" ? (
    <Button full iconEnd={<CheckIcon />} busy={props.saving} onClick={props.onSave}>
      שמירה ואישור
    </Button>
  ) : undefined;
  const showRemember = !income && props.remember != null && props.onRemember != null;

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
            {income || props.categoryOnly ? null : (
              <ListRow
                variant="button"
                buttonRef={projectBtn}
                eyebrow="פרויקט"
                title={projectName === "" ? "לא נבחר" : projectName}
                label={`פרויקט: ${projectName === "" ? "לא נבחר" : projectName}, שינוי`}
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
              label={`קטגוריה: ${categoryName === "" ? "לא נבחר" : categoryName}, שינוי`}
              tag={categorySuggested ? <SuggestTag /> : undefined}
              chevron
              onClick={() => {
                openPicker("category");
              }}
            />
          </div>
          {showRemember ? (
            <Toggle
              label="לזכור לספק הזה"
              checked={props.remember === true}
              onChange={props.onRemember ?? (() => undefined)}
              hint={
                <>
                  {shortSupplier(props.supplier)}
                  {" "}
                  <bdi dir="ltr">←</bdi>
                  {" "}
                  {projectName === "" ? "פרויקט" : projectName}
                  {" · "}
                  {categoryName === "" ? "קטגוריה" : categoryName}
                </>
              }
            />
          ) : null}
        </div>
      ) : null}
      {view === "project" || view === "category" ? (
        <Picker
          kind={pickerKind}
          query={query}
          onQuery={setQuery}
          loading={props.loading === true}
          listed={listed}
          selectedId={pickerKind === "project" ? props.projectId : props.categoryId}
          suggestionId={pickerKind === "project" ? (props.suggestionProjectId ?? "") : (props.suggestionCategoryId ?? "")}
          onSelect={(id) => {
            choose(pickerKind, id);
          }}
          onCreate={pickerKind === "project" ? () => {
            setNewName("");
            setNameError("");
            setCreatingNew(true);
          } : undefined}
          onSplit={pickerKind === "project" ? () => {
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
    action,
    titleRef,
    panelClassName: view === "summary" ? "ui-sheet-fit" : "ui-sheet-tall",
    footClassName: view === "summary" ? "ui-sheet-foot-safe" : undefined,
    onEscape: view === "summary" ? undefined : back,
    onBeforeClose: discardPicker,
    children: body,
  };

  if (props.host === "route") {
    return <RouteSheet closeTo={props.closeTo} {...chrome} />;
  }
  return <Sheet open={props.open} onOpenChange={props.onOpenChange} {...chrome} />;
}

function Picker({
  kind,
  query,
  onQuery,
  loading,
  listed,
  selectedId,
  suggestionId,
  onSelect,
  onCreate,
  onSplit,
}: {
  kind: "project" | "category";
  query: string;
  onQuery: (value: string) => void;
  loading: boolean;
  listed: ChangeChoice[];
  selectedId: string;
  suggestionId: string;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  onSplit?: () => void;
}) {
  const needle = query.trim();
  const empty = !loading && needle !== "" && listed.length === 0;
  return (
    <div className="ui-change-picker">
      <SearchField
        label={kind === "project" ? "חיפוש פרויקט" : "חיפוש קטגוריה"}
        value={query}
        onChange={onQuery}
        placeholder={kind === "project" ? "חיפוש פרויקט או קוד (P-12)" : "חיפוש קטגוריה"}
        autoFocus={false}
      />
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
          {listed.length > 0 ? (
            <div role="radiogroup" aria-label={kind === "project" ? "פרויקט" : "קטגוריה"}>
              {listed.map((option) => (
                <RadioRow
                  key={option.id}
                  layout="picker"
                  label={option.name}
                  code={option.code}
                  date={needle === "" ? option.recent : undefined}
                  tag={option.id === suggestionId ? "הצעה" : undefined}
                  selected={option.id === selectedId}
                  onSelect={() => {
                    onSelect(option.id);
                  }}
                />
              ))}
            </div>
          ) : null}
          {empty ? <p className="t-hint">{kind === "project" ? "לא נמצא פרויקט בשם הזה" : "לא נמצאה קטגוריה בשם הזה"}</p> : null}
        </>
      )}
      {kind === "project" && !loading ? (
        <div className="ui-change-links">
          <TextLink icon={<PlusIcon size={16} />} chevron={false} onClick={onCreate}>פרויקט חדש</TextLink>
          <TextLink icon={<SplitIcon size={16} />} chevron={false} onClick={onSplit}>פיצול בין פרויקטים</TextLink>
        </div>
      ) : null}
    </div>
  );
}
