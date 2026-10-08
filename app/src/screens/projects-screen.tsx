import { shekelsToAgorot, type Dashboard, type ProjectRow } from "@flow/shared";
import { projectAmountFigures, projectMarginHint } from "../by-currency";
import { useState, type ReactNode, type SubmitEvent } from "react";
import { useHoldWrites } from "../use-is-viewer";
import { useOpenFromQuery } from "../open-from-query";
import { getSupabase } from "../lib/supabase";
import { periodLabel } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { useBooks, useDashboardQuery } from "../use-books";
import { assertNoError, useWrite } from "../use-write";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { PlusIcon, ProjectsIcon, SearchIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { MoneyField } from "../ui/money-field";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { SearchEntry } from "../ui/search-entry";
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
  const [open, setOpen] = useState(false);
  // FLOW-331: + → פרויקט חדש lands here with ?new=project.
  useOpenFromQuery("project", !holdWrites, () => { setOpen(true); });
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
        subtitle={data ? `${String(data.projects.filter((project) => project.status === "active").length)} פעילים · רווח ${periodLabel(books.period)}` : undefined}
        // FLOW-323: the search icon sits in the bar's end corner, as on Home; the title stacks under.
        // FLOW-331: פרויקט חדש moved to the + tab's quick actions; the empty state keeps its button.
        stacked
        trailing={(
          <span className="ui-head-actions">
            <SearchEntry to={`/search${search}`} />
          </span>
        )}
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
  query,
  setQuery,
  expanded,
  setExpanded,
  search,
}: {
  projects: Dashboard["projects"];
  query: string;
  setQuery: (value: string) => void;
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  search: string;
}) {
  const finished = projects.filter((project) => project.status === "finished");
  const active = projects.filter((project) => project.status !== "finished");
  const needle = query.trim();
  /** Every active project by default; a query searches finished ones too (after the active ones), so none is out of reach. */
  const shown = expanded || needle !== "" ? [...active, ...finished] : active;
  const visible = shown.filter((project) =>
    needle === ""
    || project.name.includes(needle)
    || (project.state_label ?? "").includes(needle)
    // The finished row shows הסתיים, so that word finds it too.
    || (project.status === "finished" && "הסתיים".includes(needle)));
  return (
    <>
      <div className="ui-page-pad ui-stack">
        <SearchField label="חיפוש פרויקט" value={query} onChange={setQuery} placeholder="חיפוש לפי שם או סטטוס" />
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title={`לא מצאנו ״${needle}״`}
          body="החיפוש הוא לפי שם או סטטוס. גם פרויקטים שהסתיימו נכללים."
          action={<Button variant="pill" onClick={() => { setQuery(""); }}>ניקוי החיפוש</Button>}
        />
      ) : (
        <List>
          {visible.map((project) => {
            const amounts = projectAmountFigures(project);
            const single = amounts.length === 1 ? amounts[0] : undefined;
            return (
            <ListRow
              key={project.id}
              variant="project"
              title={project.name}
              hint={project.status === "finished" ? "הסתיים" : (projectMargin(project) ?? project.state_label ?? undefined)}
              agorot={single?.minor ?? project.profit_agorot}
              currency={single?.currency}
              amounts={amounts.length > 1 ? amounts : undefined}
              loss={(single?.minor ?? project.profit_agorot) < 0n}
              href={`/projects/${project.id}${search}`}
            />
            );
          })}
        </List>
      )}
      {!expanded && needle === "" && finished.length > 0 ? (
        <p className="ui-page-pad">
          <TextLink tone="quiet" onClick={() => { setExpanded(true); }}>
            {finished.length === 1
              ? "עוד פרויקט אחד שהסתיים"
              : <>עוד <bdi dir="ltr">{String(finished.length)}</bdi> שהסתיימו</>}
          </TextLink>
        </p>
      ) : null}
    </>
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
