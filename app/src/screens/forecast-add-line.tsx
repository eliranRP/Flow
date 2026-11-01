import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChoiceSheet } from "../ui/choice-sheet";
import { PlusIcon } from "../ui/icons";
import { GENERAL_NAME } from "../forecast-projects";

/** A project the line can go to: the dashboard's active projects, and the general costs (the overhead project). */
export type ForecastLineProject = { id: string; name: string };

/**
 * FLOW-1006 (owner, 2026-11-01: "add the button to add a forecast transaction", "like in project page"):
 * הוספת קטגוריה לצפי, the project צפי page's own add row, on the תזרים
 * צפוי screen. A line belongs to a project's forecast, so the sheet asks which project first (כללי is the
 * overhead project, as the company's צפי page groups it), then opens that project's add page for this month,
 * which comes back here. With one project there is nothing to ask.
 */
export function ForecastAddLine({ month, projects, search, back = "forecast", pace, label = "הוספת קטגוריה לצפי" }: {
  month: string;
  projects: readonly ForecastLineProject[];
  search: string;
  /** Where the add page comes back to: the תזרים צפוי screen, or קבועים (FLOW-1011). */
  back?: "forecast" | "recurring";
  /** FLOW-1011: the pace the add page starts at (קבועים adds a line every month). */
  pace?: "month";
  label?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const extra = search.startsWith("?") ? `&${search.slice(1)}` : "";
  const go = (projectId: string) => { void navigate(`/projects/${projectId}/profit/next/add?month=${month}&back=${back}${pace == null ? "" : `&pace=${pace}`}${extra}`); };
  const only = projects.length === 1 ? projects[0] : undefined;
  if (projects.length === 0) return null;
  return (
    <div className="ui-pn-edits">
      <button
        ref={button}
        type="button"
        className="ui-pn-add ui-hit m-press"
        onClick={() => { if (only != null) go(only.id); else setOpen(true); }}
      >
        <span className="ui-pn-add-mark" aria-hidden="true"><PlusIcon size={18} /></span>
        {label}
      </button>
      <ChoiceSheet
        copy={{
          historyKey: `${back}-add-project`,
          title: "לאיזה פרויקט",
          subtitle: "השורה נוספת לצפי של הפרויקט",
          choices: projects.map((project) => ({ value: project.id, label: project.name })),
        }}
        open={open}
        onOpenChange={setOpen}
        value=""
        saving={null}
        onPick={(choice, close) => { close(); go(choice); }}
        returnFocusRef={button}
      />
    </div>
  );
}

/** The sheet's projects: the active ones in the dashboard's order, the overhead project last as כללי. */
export function lineProjects(projects: ReadonlyArray<{ id: string; name: string; status?: string }>, overheadId: string | null): ForecastLineProject[] {
  const active = projects.filter((project) => project.status !== "finished" && project.id !== overheadId).map(({ id, name }) => ({ id, name }));
  return overheadId == null ? active : [...active, { id: overheadId, name: GENERAL_NAME }];
}

/**
 * Whether the add row can show: the projects are read, and the overhead project is known, so it is listed as
 * כללי and never under its own name for a moment. A failed overhead read does not hide the row: the projects
 * are listed as they are.
 */
export function addLineReady(live: boolean, projectsRead: boolean, overhead: { project: unknown; failed: boolean }): boolean {
  if (!live) return true;
  return projectsRead && (overhead.project !== undefined || overhead.failed);
}
