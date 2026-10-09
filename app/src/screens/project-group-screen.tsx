import type { Dashboard } from "@flow/shared";
import { useParams } from "react-router-dom";
import { periodLabel } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { findGroup, projectCountLabel } from "../project-groups";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { useBooks, useDashboardQuery } from "../use-books";
import { List } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { ListSkeleton } from "../ui/skeleton";
import { ProjectRowItem } from "./projects-screen";

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
  if (phase.kind === "ready" && data != null && entry == null) {
    return <ScreenHeader title="קבוצה" kicker="פרויקטים" subtitle="הקבוצה לא נמצאה." backTo={back} />;
  }
  const projects = entry == null
    ? []
    : [...entry.projects.filter((project) => project.status !== "finished"), ...entry.projects.filter((project) => project.status === "finished")];
  return (
    <ScreenState
      title={entry?.group.name ?? "קבוצה"}
      kicker="פרויקטים"
      subtitle={entry ? `${projectCountLabel(entry.projects.length)} · רווח ${periodLabel(books.period)}` : undefined}
      backTo={back}
      stacked
      phase={phase.kind === "empty" ? { kind: "ready" } : phase}
      onRetry={() => { void dashboard.refetch(); }}
      loading={<ListSkeleton />}
    >
      <List>
        {projects.map((project) => (
          <ProjectRowItem key={project.id} project={project} search={search} />
        ))}
      </List>
    </ScreenState>
  );
}
