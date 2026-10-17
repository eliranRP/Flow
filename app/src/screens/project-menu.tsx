// The project's ⋯ menu (board Projects.dc.html, "פעולות על הפרויקט"): edit, the investment page, finish,
// and delete when the project has no lines. Its rows the board does not draw come after them, as named
// deviations. The menu's sheet is titled with the project's name.
import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useBlockedPreview } from "./screen-shared";
import { useProjectsCashMonth } from "../project-cash";
import type { ProjectCashRow } from "@flow/shared";
import { assertNoError, useWrite } from "../use-write";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { IconButton } from "../ui/icon-button";
import { BinIcon, FlagIcon, InvestIcon, MoreIcon, PencilIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { ProjectFormSheet } from "./project-form-sheet";
import { NO_GROUP, ProjectGroupSheets, type ProjectGroups } from "./project-group-sheets";

export function ProjectMenu({
  projectId,
  name,
  budget,
  finished,
  groups,
  sample = false,
  sampleRow,
  overhead,
  investmentTo,
}: {
  projectId: string;
  name: string;
  budget: bigint | null;
  finished: boolean;
  /** FLOW-360 A: the קבוצה row shows once the groups are read. */
  groups?: ProjectGroups;
  sample?: boolean;
  /** A sample project's month row (stories and the proof fixture); a live menu reads it from the month. */
  sampleRow?: ProjectCashRow;
  /** FLOW-340 C: the overhead switch left the page body for this menu. */
  overhead?: ReactNode;
  /** FLOW-340 C: set when the overview hides its השקעה row, so the data can still be added. */
  investmentTo?: string;
}) {
  const blocked = useBlockedPreview();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [groupView, setGroupView] = useState<"pick" | "new" | null>(null);
  const opener = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  // FLOW-445: the month's row for this project: the pending lines (the finish warning) and whether it can be deleted.
  const cash = useProjectsCashMonth(undefined, projectId);
  const row = sampleRow ?? cash.data?.projects.find((project) => project.id === projectId);
  const pending = row?.pending_count ?? 0;
  const deletable = row?.deletable === true;
  const action = finished ? "החזרה לפעיל" : "סיום הפרויקט";
  const save = useWrite({
    failure: "לא הצלחנו לעדכן את הפרויקט.",
    success: finished ? "הפרויקט חזר לפעיל" : `${name} סומן כהסתיים`,
    keys: ["dashboard", "project", "projects-cash"],
    onSuccess: () => {
      setConfirm(false);
      // A finish lands on the list with הסתיימו open (FLOW-445).
      if (!finished) void navigate("/projects", { state: { finishedOpen: true } });
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      // No p_type: upsert_project keeps the stored type when none is sent.
      assertNoError(await supabase.rpc("upsert_project", {
        p_id: projectId,
        p_name: name,
        ...(budget == null ? {} : { p_budget_agorot: Number(budget) }),
        p_status: finished ? "active" : "finished",
      }));
    },
  });
  const remove = useWrite({
    failure: (error) => (error.message.includes("in use") ? "יש בפרויקט תנועות, אז אי אפשר למחוק אותו." : "לא הצלחנו למחוק את הפרויקט."),
    success: `${name} נמחק`,
    keys: ["dashboard", "project", "projects-cash"],
    onSuccess: () => {
      setRemoving(false);
      void navigate("/projects");
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("delete_project", { p_id: projectId }));
    },
  });
  const pendingWarning = pending === 1
    ? "יש בו פריט אחד ממתין לאישור. כדאי לאשר אותו לפני הסיום."
    : `יש בו ${String(pending)} פריטים ממתינים לאישור. כדאי לאשר אותם לפני הסיום.`;
  return (
    <>
      <IconButton
        ref={opener}
        label="עוד"
        onBand
        onClick={() => {
          setMenu(true);
        }}
      >
        <MoreIcon />
      </IconButton>
      <Sheet open={menu} onOpenChange={setMenu} title={name} panelClassName="ui-sheet-wide ui-sheet-pad28 ui-project-menu">
        {/* FLOW-334: the menu's actions are rows, so "סיום הפרויקט" is not a second kind of control. */}
        <List className="ui-project-menu-list">
          {finished ? null : (
            <ListRow
              variant="button"
              title="עריכת פרטים"
              meta="שם, סוג ותקציב"
              icon={<PencilIcon />}
              chevron
              onClick={() => {
                setMenu(false);
                setEditing(true);
              }}
            />
          )}
          {investmentTo == null ? null : (
            <ListRow
              variant="item"
              title="השקעה והלוואות"
              meta="מחיר קנייה, ARV, שווי והלוואות"
              icon={<InvestIcon />}
              href={investmentTo}
              chevron
            />
          )}
          <ListRow
            variant="button"
            title={action}
            meta={finished ? "יחזור לרשימת הפעילים" : "יעבור ל״הסתיימו״. שום דבר לא נמחק"}
            icon={<FlagIcon />}
            onClick={() => {
              setMenu(false);
              setConfirm(true);
            }}
          />
          {deletable ? (
            <ListRow
              variant="button"
              title="מחיקת הפרויקט"
              meta="אין בו תנועות, אז אפשר למחוק אותו"
              icon={<BinIcon />}
              className="ui-project-menu-delete"
              onClick={() => {
                setMenu(false);
                setRemoving(true);
              }}
            />
          ) : null}
          {/* Named deviations (not on the board): the add-a-manual-entry row and the groups row follow the board's rows. */}
          {finished ? null : (
            <ListRow variant="item" title="הוספה לפרויקט" meta="תנועה ידנית לפרויקט הזה" href={`/add?project=${projectId}`} chevron />
          )}
          {groups == null ? null : (
            <ListRow
              variant="button"
              title="קבוצה"
              meta={groups.groups.find((group) => group.id === groups.currentId)?.name ?? NO_GROUP}
              chevron
              onClick={() => {
                setMenu(false);
                setGroupView("pick");
              }}
            />
          )}
        </List>
        {overhead}
      </Sheet>
      <ProjectFormSheet open={editing} onOpenChange={setEditing} project={{ id: projectId, name, type: row?.type ?? null, budget, status: row?.status ?? "active" }} />
      {groups == null ? null : (
        <ProjectGroupSheets
          projectId={projectId}
          groups={groups.groups}
          currentId={groups.currentId}
          view={groupView}
          onView={setGroupView}
          onBack={() => {
            setGroupView(null);
            setMenu(true);
          }}
          blocked={blocked}
          returnFocusRef={opener}
          sample={sample}
        />
      )}
      {/* Either way can be undone, so the confirm is neutral: no red and no bin (FLOW-341 rule). */}
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={finished ? "להחזיר את הפרויקט לפעיל?" : `לסיים את ${name}?`}
        consequenceSize="body"
        consequence={finished
          ? "הפרויקט יחזור לרשימת הפעילים, ואפשר לסיים אותו שוב בכל רגע."
          : "הפרויקט יעבור ל״הסתיימו״ ויצא מבחירת הפרויקטים בשיוך. התנועות, הרווח והמסמכים נשמרים, ואפשר להחזיר אותו לפעיל בכל רגע."}
        warning={!finished && pending > 0 ? pendingWarning : undefined}
        confirmLabel={action}
        returnFocusRef={opener}
        busy={save.isPending}
        onConfirm={() => {
          if (blocked()) return;
          save.mutate();
        }}
      />
      <ConfirmSheet
        open={removing}
        onOpenChange={setRemoving}
        title={`למחוק את ${name}?`}
        consequenceSize="body"
        consequence="אין בפרויקט תנועות, חשבוניות או מסמכים, אז שום מספר לא משתנה. אי אפשר לשחזר אחרי המחיקה."
        confirmLabel="מחיקה"
        destructive="outline"
        returnFocusRef={opener}
        busy={remove.isPending}
        onConfirm={() => {
          if (blocked()) return;
          remove.mutate();
        }}
      />
    </>
  );
}
