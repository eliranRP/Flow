import { shekelsToAgorot, type Dashboard, type ProjectGroupRow, type ProjectRow } from "@flow/shared";
import { projectAmountFigures, projectMarginHint } from "../by-currency";
import { useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { useHoldWrites } from "../use-is-viewer";
import { useOpenFromQuery } from "../open-from-query";
import { getSupabase } from "../lib/supabase";
import { groupAsProjectRow, groupHref, projectCountLabel, splitByGroup, type ProjectGroupEntry } from "../project-groups";
import { periodPhrase } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { searchHref } from "../search";
import { useBooks, useDashboardQuery } from "../use-books";
import { assertNoError, useWrite } from "../use-write";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { PlusIcon, ProjectsIcon, SearchIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { MoneyField } from "../ui/money-field";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { SearchField } from "../ui/search-field";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { ListSkeleton } from "../ui/skeleton";
import { useBlockedPreview } from "./screen-shared";

/** `initialQuery` lets a story open on a search without moving focus off the title. */
export function ProjectsScreen({ sample, initialQuery = "" }: { sample?: Dashboard; initialQuery?: string } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const dashboard = useDashboardQuery(sample == null);
  const books = useBooks();
  const holdWrites = useHoldWrites();
  const [open, setOpenState] = useState(false);
  const adopt = useRef(false);
  // Back closes the sheet. A quick action opened over this page adopts its entry (one Back closes).
  const setOpen = useSheetHistory("project-new", open, setOpenState, undefined, adopt);
  // FLOW-331: + → פרויקט חדש lands here with ?new=project.
  useOpenFromQuery("project", !holdWrites, (sameEntry) => {
    adopt.current = sameEntry;
    setOpen(true);
  });
  const [query, setQuery] = useState(initialQuery);
  const [expanded, setExpanded] = useState(false);
  const phase: ScreenPhase = sample ? { kind: "ready" } : screenPhase(preview, dashboard);
  const data = sample ?? dashboard.data;
  const sheet = (
    <Sheet open={open} onOpenChange={setOpen} title="פרויקט">
      <ProjectForm onClose={() => { setOpen(false); }} />
    </Sheet>
  );
  const empty = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title="פרויקטים" />
      <EmptyState
        icon={<ProjectsIcon />}
        title="עוד אין פרויקטים"
        body={holdWrites ? "פרויקטים מגיעים מ־SUMIT." : "פרויקטים מגיעים מ־SUMIT, ואפשר גם לפתוח אחד כאן."}
        action={holdWrites ? undefined : <Button variant="pill" icon={<PlusIcon size={16} />} onClick={() => { setOpen(true); }}>פרויקט חדש</Button>}
      />
      {sheet}
    </div>
  );
  if (phase.kind === "empty" || (phase.kind === "ready" && (data?.projects.length ?? 0) === 0)) return empty;
  return (
    <>
      <ScreenState
        title="פרויקטים"
        subtitle={data ? `${String(data.projects.filter((project) => project.status === "active").length)} פעילים · רווח ${periodPhrase(books.period)}` : undefined}
        // FLOW-331: פרויקט חדש moved to the + tab's quick actions; the empty state keeps its button.
        // FLOW-342 (A): no header magnifier; the filter below is the page's one search, and a miss offers the transactions.
        // FLOW-356: a tab root, so the 34px title the other tabs and its own empty state use, not `stacked`.
        phase={phase}
        onRetry={() => { void dashboard.refetch(); }}
        loading={
          <>
            <div className="ui-page-pad ui-stack">
              <SearchField label="חיפוש פרויקט" value="" onChange={() => undefined} placeholder="חיפוש לפי שם או סטטוס" disabled />
            </div>
            <ListSkeleton />
          </>
        }
      >
        <ProjectsBody
          projects={data?.projects ?? []}
          groups={data?.groups ?? []}
          query={query}
          setQuery={setQuery}
          expanded={expanded}
          setExpanded={setExpanded}
          search={search}
        />
      </ScreenState>
      {sheet}
    </>
  );
}

function projectMargin(project: ProjectRow): ReactNode | undefined {
  const shown = projectMarginHint(project);
  if (shown == null) return undefined;
  return (
    <>
      רווחיות <bdi dir="ltr">{shown}</bdi>
    </>
  );
}

function ProjectsBody({
  projects,
  groups,
  query,
  setQuery,
  expanded,
  setExpanded,
  search,
}: {
  projects: Dashboard["projects"];
  groups: NonNullable<Dashboard["groups"]>;
  query: string;
  setQuery: (value: string) => void;
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  search: string;
}) {
  const needle = query.trim();
  // FLOW-406 (proj-b): a group is one row that opens its projects; a search reaches every project by name.
  const split = splitByGroup({ projects, groups });
  const pool = needle === "" ? split.loose : projects;
  const finished = pool.filter((project) => project.status === "finished");
  const active = pool.filter((project) => project.status !== "finished");
  // A group whose projects have all finished folds with the finished projects.
  const groupDone = (entry: ProjectGroupEntry) => entry.projects.every((project) => project.status === "finished");
  const activeGroups = needle === "" ? split.groups.filter((entry) => !groupDone(entry)) : split.groups.filter((entry) => entry.group.name.includes(needle));
  const finishedGroups = needle === "" ? split.groups.filter(groupDone) : [];
  /** Every active project by default; a query searches finished ones too (after the active ones), so none is out of reach. */
  const open = expanded || needle !== "";
  const matches = (project: ProjectRow) =>
    needle === ""
    || project.name.includes(needle)
    || (project.state_label ?? "").includes(needle)
    // The finished row shows הסתיים, so that word finds it too.
    || (project.status === "finished" && "הסתיים".includes(needle));
  const activeShown = active.filter(matches);
  const finishedShown = open ? finished.filter(matches) : [];
  const groupsShown = open ? [...activeGroups, ...finishedGroups] : activeGroups;
  const folded = finished.length + finishedGroups.length;
  const aligned = groupsShown.length > 0;
  const groupRow = ({ group, projects: members }: ProjectGroupEntry) => (
    <ProjectGroupRow key={`group-${group.id}`} group={group} count={members.length} search={search} />
  );
  const projectRow = (project: ProjectRow) => (
    <ProjectRowItem key={project.id} project={project} search={search} alignWithChevron={aligned} />
  );
  const nothing = activeShown.length === 0 && finishedShown.length === 0 && groupsShown.length === 0;
  return (
    <>
      <div className="ui-page-pad ui-stack">
        <SearchField label="חיפוש פרויקט" value={query} onChange={setQuery} placeholder="חיפוש לפי שם או סטטוס" />
      </div>
      {nothing && needle !== "" ? (
        // FLOW-342 (A): a name that is no project is likely a supplier or a line, so the miss is one row into search.
        <List>
          <ListRow
            variant="item"
            title={`חיפוש בתנועות: ${needle}`}
            icon={<SearchIcon />}
            chevron
            href={searchHref(needle, search)}
          />
        </List>
      ) : nothing ? null : (
        <List>
          {activeGroups.map(groupRow)}
          {activeShown.map(projectRow)}
          {open ? finishedGroups.map(groupRow) : null}
          {finishedShown.map(projectRow)}
        </List>
      )}
      {!expanded && needle === "" && folded > 0 ? (
        <p className="ui-page-pad">
          <TextLink tone="quiet" onClick={() => { setExpanded(true); }}>
            {folded === 1
              ? "עוד פרויקט אחד שהסתיים"
              : <>עוד <bdi dir="ltr">{String(folded)}</bdi> שהסתיימו</>}
          </TextLink>
        </p>
      ) : null}
    </>
  );
}

/** One project's row on the Projects tab and on a group's page. */
export function ProjectRowItem({ project, search, alignWithChevron = false }: { project: ProjectRow; search: string; alignWithChevron?: boolean }) {
  const amounts = projectAmountFigures(project);
  const single = amounts.length === 1 ? amounts[0] : undefined;
  return (
    <ListRow
      variant="project"
      title={project.name}
      hint={project.status === "finished" ? "הסתיים" : (projectMargin(project) ?? project.state_label ?? undefined)}
      agorot={single?.minor ?? project.profit_agorot}
      currency={single?.currency}
      amounts={amounts.length > 1 ? amounts : undefined}
      loss={(single?.minor ?? project.profit_agorot) < 0n}
      href={`/projects/${project.id}${search}`}
      // Beside a group row's chevron, the amounts keep one column (FLOW-408).
      chevronSpace={alignWithChevron}
    />
  );
}

/** FLOW-406 (proj-b): a group as one row, its profit summed by the server, opening the group's page. */
function ProjectGroupRow({ group, count, search }: { group: ProjectGroupRow; count: number; search: string }) {
  const amounts = projectAmountFigures(groupAsProjectRow(group));
  const single = amounts.length === 1 ? amounts[0] : undefined;
  return (
    <ListRow
      variant="project"
      title={group.name}
      hint={projectCountLabel(count)}
      agorot={single?.minor ?? group.profit_agorot}
      currency={single?.currency}
      amounts={amounts.length > 1 ? amounts : undefined}
      loss={(single?.minor ?? group.profit_agorot) < 0n}
      href={groupHref(group.id, search)}
      chevron
    />
  );
}

function ProjectForm({ onClose, projectId }: { onClose: () => void; projectId?: string }) {
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const save = useWrite({
    failure: "לא הצלחנו לשמור את הפרויקט.",
    success: "הפרויקט נשמר",
    keys: ["dashboard", "project"],
    onSuccess: onClose,
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const agorot = budget.trim() === "" ? null : Number(shekelsToAgorot(budget));
      assertNoError(await supabase.rpc("upsert_project", {
        p_name: name,
        p_status: "active",
        ...(projectId ? { p_id: projectId } : {}),
        ...(agorot == null ? {} : { p_budget_agorot: agorot }),
      }));
    },
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (holdWrites || blocked()) return;
    save.mutate();
  }

  return (
    <form className="ui-stack" onSubmit={submit}>
      <TextField label="שם" value={name} onChange={(event) => { setName(event.target.value); }} required />
      <MoneyField label="תקציב בשקלים, או ריק" value={budget} onValueChange={setBudget} />
      <Button type="submit" busy={save.isPending} disabled={holdWrites}>שמירה</Button>
      <Button variant="secondary" onClick={onClose}>ביטול</Button>
    </form>
  );
}
