// The project's ⋯ menu (board Projects.dc.html, "פעולות על הפרויקט"): edit, the investment page, finish
// (at once, with ביטול) or החזרה לפעילים, and delete when the project has no lines (the one that asks). The sheet is titled with the project's name. The overhead
// switch and the group live in the edit sheet; adding a line is the + sheet's job.
import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useBlockedPreview } from "./screen-shared";
import { useProjectsCashMonth } from "../project-cash";
import type { ProjectCashRow } from "@flow/shared";
import { assertNoError, useWrite } from "../use-write";
import { useToast } from "../ui/toast";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { IconButton } from "../ui/icon-button";
import { BinIcon, FlagIcon, InvestIcon, MoreIcon, PencilIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { ProjectFormSheet } from "./project-form-sheet";
import { NO_GROUP, ProjectGroupSheets, type ProjectGroups } from "./project-group-sheets";

/** How long a finish offers ביטול (FLOW-961, decision 0213). */
export const FINISH_UNDO_MS = 5000;

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
  hasInvestment,
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
  /** The overhead switch, drawn in the edit sheet. */
  overhead?: ReactNode;
  /** The investment and loans page the menu's second row opens. */
  investmentTo: string;
  /** The board shows the menu's השקעה והלוואות row only for a project with an investment figure or a loan; the edit sheet always has the way in. */
  hasInvestment: boolean;
}) {
  const blocked = useBlockedPreview();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [groupView, setGroupView] = useState<"pick" | "new" | null>(null);
  const opener = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  // FLOW-445: the month's row for this project: the pending lines (the finish warning) and whether it can be deleted.
  const cash = useProjectsCashMonth(undefined, projectId);
  const row = sampleRow ?? cash.data?.projects.find((project) => project.id === projectId);
  const pending = row?.pending_count ?? 0;
  const deletable = row?.deletable === true;
  const action = finished ? "החזרה לפעילים" : "סיום הפרויקט";
  const toast = useToast();
  // FLOW-961 (decision 0213): finishing can be undone, so it happens at once. The list opens with
  // הסתיימו, and a toast under the header offers ביטול for 5s. החזרה לפעילים needs no undo: it is one.
  const setStatus = useWrite<"active" | "finished">({
    failure: "לא הצלחנו לעדכן את הפרויקט.",
    place: "top",
    keys: ["dashboard", "project", "projects-cash"],
    onSuccess: (status) => {
      if (status === "finished") {
        void navigate("/projects", { state: { finishedOpen: true } });
        toast.show({
          message: `${name} עבר ל״הסתיימו״`,
          action: "ביטול",
          onAction: () => { setStatus.mutate("active"); },
          durationMs: FINISH_UNDO_MS,
          place: "top",
        });
        return;
      }
      toast.show({ message: `${name} חזר לפעילים`, place: "top" });
    },
    run: async (status) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      // No p_type: upsert_project keeps the stored type when none is sent.
      assertNoError(await supabase.rpc("upsert_project", {
        p_id: projectId,
        p_name: name,
        ...(budget == null ? {} : { p_budget_agorot: Number(budget) }),
        p_status: status,
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
  // What finishing leaves: the items still waiting wait on (they are named here, as the confirm used to).
  const finishHint = finished
    ? "יחזור לרשימה ולבחירת הפרויקטים בשיוך"
    : pending === 1
      ? "יש בו פריט אחד לאישור. הוא יחכה גם אחרי הסיום"
      : pending > 1
        ? `יש בו ${String(pending)} פריטים לאישור. הם יחכו גם אחרי הסיום`
        : "יעבור ל״הסתיימו״. אפשר לבטל מיד, ושום דבר לא נמחק";
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
      <Sheet open={menu} onOpenChange={setMenu} title={name} panelClassName="ui-sheet-wide ui-sheet-pad28 ui-project-menu" closeButton={false}>
        {/* FLOW-334: the menu's actions are rows, so "סיום הפרויקט" is not a second kind of control. */}
        <List className="ui-project-menu-list">
          {finished ? null : (
            <ListRow
              variant="button"
              title="עריכת פרטים"
              hint="שם, סוג ותקציב"
              icon={<PencilIcon />}
              chevron
              onClick={() => {
                setMenu(false);
                setEditing(true);
              }}
            />
          )}
          {hasInvestment ? (
            <ListRow
              variant="item"
              title="השקעה והלוואות"
              hint="מחיר קנייה, ARV, שווי והלוואות"
              icon={<InvestIcon />}
              href={investmentTo}
              chevron
            />
          ) : null}
          <ListRow
            variant="button"
            title={action}
            hint={finishHint}
            icon={<FlagIcon />}
            disabled={setStatus.isPending}
            onClick={() => {
              setMenu(false);
              if (blocked()) return;
              setStatus.mutate(finished ? "active" : "finished");
            }}
          />
          {deletable ? (
            <ListRow
              variant="button"
              title="מחיקת הפרויקט"
              hint="אין בו תנועות, אז אפשר למחוק אותו"
              icon={<BinIcon />}
              className="ui-project-menu-delete"
              onClick={() => {
                setMenu(false);
                setRemoving(true);
              }}
            />
          ) : null}
        </List>
      </Sheet>
      <ProjectFormSheet
        open={editing}
        onOpenChange={setEditing}
        project={{ id: projectId, name, type: row?.type ?? null, budget, status: row?.status ?? "active" }}
        extras={(
          <>
            {overhead}
            <List>
              <ListRow variant="item" title="נתוני השקעה" hint="מחיר קנייה, ARV, שווי והלוואות" href={investmentTo} chevron />
            </List>
            {groups == null ? null : (
              <List>
                <ListRow
                  variant="button"
                  title="קבוצה"
                  meta={groups.groups.find((group) => group.id === groups.currentId)?.name ?? NO_GROUP}
                  chevron
                  onClick={() => {
                    setEditing(false);
                    setGroupView("pick");
                  }}
                />
              </List>
            )}
          </>
        )}
      />
      {groups == null ? null : (
        <ProjectGroupSheets
          projectId={projectId}
          groups={groups.groups}
          currentId={groups.currentId}
          view={groupView}
          onView={setGroupView}
          onBack={() => {
            setGroupView(null);
            setEditing(true);
          }}
          blocked={blocked}
          returnFocusRef={opener}
          sample={sample}
        />
      )}
      <ConfirmSheet
        open={removing}
        onOpenChange={setRemoving}
        title={`למחוק את ${name}?`}
        consequenceSize="body"
        consequence="אין בפרויקט תנועות, חשבוניות או מסמכים, אז שום מספר לא משתנה. אי אפשר לשחזר אחרי המחיקה."
        confirmLabel="מחיקת הפרויקט"
        destructive="outline"
        returnFocusRef={opener}
        closeButton={false}
        panelClassName="ui-sheet-g14 ui-confirm-roomy"
        busy={remove.isPending}
        onConfirm={() => {
          if (blocked()) return;
          remove.mutate();
        }}
      />
    </>
  );
}
