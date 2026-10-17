import { shekelsToAgorot } from "@flow/shared";
import { useRef, useState, type SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { useCompanyCurrency } from "../company-currency";
import { useHoldWrites } from "../use-is-viewer";
import { assertNoError, useWrite } from "../use-write";
import { Button } from "../ui/button";
import { MoneyField } from "../ui/money-field";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { LOAN_CURRENCY_MARK } from "./loan-form";
import { useBlockedPreview } from "./screen-shared";

/** The project an edit sheet opens on. `type` is the owner's own text (or none); `budget` is in agorot. */
export type ProjectFormValues = { id: string; name: string; type: string | null; budget: bigint | null; status: string };

/**
 * FLOW-445: the new-project sheet (no project) and the edit sheet (a project). Both save through
 * upsert_project with the type, so an edit keeps or changes it on purpose. A new project opens its page.
 */
export function ProjectFormSheet({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: ProjectFormValues;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={project ? "עריכת פרויקט" : "פרויקט חדש"} panelClassName="ui-sheet-wide ui-sheet-g14 ui-sheet-pad28 ui-project-new">
      <ProjectForm key={project == null ? "new" : `${project.id}:${project.name}:${project.type ?? ""}:${String(project.budget)}`} project={project} onClose={() => { onOpenChange(false); }} />
    </Sheet>
  );
}

function shekelsText(agorot: bigint | null): string {
  return agorot == null ? "" : String(Number(agorot) / 100);
}

function ProjectForm({ project, onClose }: { project?: ProjectFormValues; onClose: () => void }) {
  const blocked = useBlockedPreview();
  const companyCurrency = useCompanyCurrency();
  // The budget is in the company currency, so its field shows that currency's mark.
  const mark = companyCurrency === "USD" ? LOAN_CURRENCY_MARK.USD : LOAN_CURRENCY_MARK.ILS;
  const holdWrites = useHoldWrites();
  const navigate = useNavigate();
  const [name, setName] = useState(project?.name ?? "");
  const [type, setType] = useState(project?.type ?? "");
  const [budget, setBudget] = useState(shekelsText(project?.budget ?? null));
  const createdId = useRef<string | null>(null);
  const trimmed = name.trim();
  const save = useWrite({
    failure: "לא הצלחנו לשמור את הפרויקט.",
    success: project ? "הפרטים נשמרו" : "הפרויקט נוצר",
    keys: ["dashboard", "project", "projects-cash"],
    onSuccess: () => {
      onClose();
      if (!project && createdId.current != null) void navigate(`/projects/${createdId.current}`);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const agorot = budget.trim() === "" ? null : Number(shekelsToAgorot(budget));
      const result = await supabase.rpc("upsert_project", {
        ...(project ? { p_id: project.id } : {}),
        p_name: trimmed,
        // An empty type clears it on an edit. When the stored type is not known (none, or not read yet), an empty field sends nothing, so it keeps the stored one.
        ...(project != null && project.type == null && type.trim() === "" ? {} : { p_type: type.trim() }),
        p_status: project?.status ?? "active",
        ...(agorot == null ? {} : { p_budget_agorot: agorot }),
      });
      assertNoError(result);
      createdId.current = typeof result.data === "string" ? result.data : null;
    },
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (holdWrites || blocked() || trimmed.length < 2) return;
    save.mutate();
  }

  return (
    <form className="ui-stack" onSubmit={submit}>
      <TextField
        label="שם הפרויקט"
        value={name}
        onChange={(event) => { setName(event.target.value); }}
        placeholder={project ? undefined : "למשל: Ashby Rd"}
        required
      />
      <TextField
        label="סוג (אופציונלי)"
        value={type}
        maxLength={40}
        onChange={(event) => { setType(event.target.value); }}
        placeholder="מה שמתאים לך: flip, השכרה, שיפוץ…"
      />
      <MoneyField label="תקציב (אופציונלי)" prefix={mark} value={budget} onValueChange={setBudget} />
      <p className="ui-muted">נראה כמה נוצל, ונסמן כשעוברים אותו.</p>
      <p className="ui-muted">רק השם חובה. פרויקטים מ־SUMIT נוספים לבד.</p>
      <Button type="submit" busy={save.isPending} disabled={holdWrites || trimmed.length < 2}>
        {project ? "שמירה" : "יצירת פרויקט"}
      </Button>
    </form>
  );
}
