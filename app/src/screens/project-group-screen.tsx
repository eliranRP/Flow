import type { Dashboard } from "@flow/shared";
import { useParams } from "react-router-dom";
import { periodPhrase } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { findGroup, projectCountLabel } from "../project-groups";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { useBooks, useDashboardQuery } from "../use-books";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { ProjectsIcon } from "../ui/icons";
import { List } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { ListSkeleton } from "../ui/skeleton";
import { ProjectRowItem } from "./projects-screen";

export const GROUP_MISSING_TITLE = "הקבוצה לא נמצאה";

/**
 * FLOW-406 (proj-b-2): one project group's page. The group's projects, active first, from the same
 * read as the Projects tab, so its figures match the group's row there.
 */
export function ProjectGroupScreen({ sample, groupId: groupIdProp }: { sample?: Dashboard; groupId?: string } = {}) {
  const params = useParams();
  const groupId = groupIdProp ?? params.groupId ?? "";
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const dashboard = useDashboardQuery(sample == null);
  const books = useBooks();
  const phase: ScreenPhase = sample ? { kind: "ready" } : screenPhase(preview, dashboard);
  const data = sample ?? dashboard.data;
  const back = `/projects${search}`;
  const entry = data ? findGroup(data, groupId) : null;
  // Ready (or the empty preview) with no such group: a stale link gets the standard empty state, with a way back (FLOW-358).
  if ((phase.kind === "ready" || phase.kind === "empty") && entry == null) {
    return (
      <div>
        <ScreenHeader title="קבוצה" kicker="פרויקטים" backTo={back} />
        <EmptyState
          icon={<ProjectsIcon />}
          title={GROUP_MISSING_TITLE}
          body="ייתכן שנמחקה או שייכת לעסק אחר."
          action={<Button variant="pill" to={back}>לכל הפרויקטים</Button>}
        />
      </div>
    );
  }
  const projects = entry == null
    ? []
    : [...entry.projects.filter((project) => project.status !== "finished"), ...entry.projects.filter((project) => project.status === "finished")];
  return (
    <ScreenState
      title={entry?.group.name ?? "קבוצה"}
      kicker="פרויקטים"
      subtitle={entry ? `${projectCountLabel(entry.projects.length)} · רווח ${periodPhrase(books.period)}` : undefined}
      backTo={back}
      stacked
      phase={phase}
      onRetry={() => { void dashboard.refetch(); }}
      loading={<ListSkeleton />}
    >
      {projects.length === 0 ? (
        <p className="t-hint ui-page-pad">אין פרויקטים בקבוצה.</p>
      ) : (
        <List>
          {projects.map((project) => (
            <ProjectRowItem key={project.id} project={project} search={search} />
          ))}
        </List>
      )}
    </ScreenState>
  );
}
