import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import { getSupabase } from "../lib/supabase";
import { useHomePreview } from "../preview";
import { assertNoError, useWrite } from "../use-write";
import { Button } from "../ui/button";
import { BackIcon, PlusIcon } from "../ui/icons";
import { IconButton } from "../ui/icon-button";
import { RadioRow } from "../ui/radio-row";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";

/** FLOW-360 A: the project's group, picked from its ⋯ menu. */
export type ProjectGroupChoice = { id: string; name: string };

export type ProjectGroups = { groups: readonly ProjectGroupChoice[]; currentId: string | null };

export const NO_GROUP = "בלי קבוצה";

/**
 * The company's groups and this project's own. Under the "project" key, so a move's refetch
 * reaches it; off in a preview and for a sample.
 */
export function useProjectGroups(projectId: string, active: boolean): ProjectGroups | undefined {
  const preview = useHomePreview();
  const read = useQuery({
    queryKey: ["project", "groups", projectId],
    enabled: active && preview === "off" && projectId !== "",
    queryFn: async (): Promise<ProjectGroups> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const [groups, project] = await Promise.all([
        supabase.rpc("list_project_groups"),
        supabase.from("projects").select("group_id").eq("id", projectId).maybeSingle(),
      ]);
      assertNoError(groups);
      assertNoError(project);
      const rows = Array.isArray(groups.data) ? groups.data as { id: string; name: string }[] : [];
      return { groups: rows.map(({ id, name }) => ({ id, name })), currentId: project.data?.group_id ?? null };
    },
  });
  return read.data;
}
export const GROUP_NAME_MIN = 2;
export const GROUP_NAME_MAX = 120;

export function groupNameError(value: string): string | undefined {
  const length = Array.from(value.trim()).length;
  if (length < GROUP_NAME_MIN) return `שם קצר מדי – לפחות ${String(GROUP_NAME_MIN)} תווים`;
  if (length > GROUP_NAME_MAX) return `שם ארוך מדי – עד ${String(GROUP_NAME_MAX)} תווים`;
  return undefined;
}

/** What the toast says after a move: into a group, or out of one. */
export function groupMoveMessage(after: string | null, before: string | null): string {
  if (after != null) return `הפרויקט עבר לקבוצה ${after}`;
  return before != null ? `הפרויקט הוצא מהקבוצה ${before}` : "הפרויקט בלי קבוצה";
}

function groupFailureText(error: Error): string {
  if ((error as Error & { code?: string }).code === "42501" || error.message.includes("forbidden")) {
    return "רק בעלי העסק יכולים לשנות קבוצה.";
  }
  if (error.message.includes("already exists")) return "כבר יש קבוצה בשם הזה.";
  if (error.message.includes("too short")) return `שם קצר מדי – לפחות ${String(GROUP_NAME_MIN)} תווים`;
  return "לא הצלחנו לשנות את הקבוצה.";
}

type Move = {
  /** The group to put the project in; null takes it out (or, with `create`, the new group). */
  to: string | null;
  create?: string;
  /** Where it was, for the toast and its undo. */
  from: string | null;
  undo?: boolean;
};

/**
 * The picker ("בלי קבוצה" and the company's groups, with "קבוצה חדשה") and the one-field new group
 * sheet. A pick saves at once and the toast offers ביטול, which puts the project back.
 */
export function ProjectGroupSheets({
  projectId,
  groups,
  currentId,
  view,
  onView,
  onBack,
  blocked,
  returnFocusRef,
  sample = false,
}: {
  projectId: string;
  groups: readonly ProjectGroupChoice[];
  currentId: string | null;
  /** Which sheet is open, if any. */
  view: "pick" | "new" | null;
  onView: (view: "pick" | "new" | null) => void;
  /** The picker's Back: the ⋯ menu again. */
  onBack: () => void;
  /** A preview or a viewer: says why and returns true, so nothing is written. */
  blocked: () => boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Stories: no writes, the toast still shows. */
  sample?: boolean;
}) {
  const toast = useToast();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  // A group made in this sheet is not in `groups` until the dashboard read lands, so its name and
  // id stay here for the toast and its undo.
  const created = useRef<ProjectGroupChoice | null>(null);
  const nameOf = (id: string | null) =>
    id == null ? null : (created.current?.id === id ? created.current.name : groups.find((group) => group.id === id)?.name ?? null);
  const move = useWrite<Move>({
    failure: (failed) => groupFailureText(failed),
    keys: ["dashboard", "project"],
    onSuccess: (done) => {
      const to = done.create != null ? created.current?.id ?? null : done.to;
      setSavingId(null);
      onView(null);
      toast.show({
        message: groupMoveMessage(nameOf(to), nameOf(done.from)),
        ...(done.undo ? {} : {
          action: "ביטול",
          onAction: () => {
            move.mutate({ to: done.from, from: to, undo: true });
          },
        }),
      });
    },
    onError: () => {
      setSavingId(null);
    },
    run: async (change) => {
      if (change.create != null && sample) created.current = { id: "new", name: change.create.trim() };
      if (sample) return;
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      let to = change.to;
      if (change.create != null) {
        // The generated types say string, but the functions take null: a new group, or out of any group.
        const made = await supabase.rpc("upsert_project_group", { p_id: null as unknown as string, p_name: change.create.trim() });
        assertNoError(made);
        to = String(made.data);
        created.current = { id: to, name: change.create.trim() };
      }
      assertNoError(await supabase.rpc("set_project_group", { p_project_id: projectId, p_group_id: to as string }));
    },
  });

  useEffect(() => {
    if (view === "new") {
      setName("");
      setError(undefined);
    }
  }, [view]);

  const pick = (id: string | null) => {
    if (move.isPending) return;
    if (id === currentId) {
      onView(null);
      return;
    }
    if (blocked()) return;
    setSavingId(id ?? "");
    move.mutate({ to: id, from: currentId });
  };

  const create = () => {
    if (move.isPending) return;
    const problem = groupNameError(name);
    setError(problem);
    if (problem) return;
    const existing = groups.find((group) => group.name === name.trim());
    if (existing) {
      pick(existing.id);
      return;
    }
    if (blocked()) return;
    move.mutate({ to: null, create: name, from: currentId });
  };

  return (
    <>
      <Sheet
        open={view === "pick"}
        onOpenChange={(next) => {
          if (next) return true;
          if (move.isPending) return false;
          onView(null);
          return true;
        }}
        title="קבוצה"
        returnFocusRef={returnFocusRef}
        leading={(
          <IconButton label="חזרה" className="ui-back-btn" onClick={onBack}>
            <BackIcon />
          </IconButton>
        )}
        onEscape={onBack}
      >
        <div className="ui-change-picker">
          <div role="radiogroup" aria-label="קבוצה">
            {[{ id: null, name: NO_GROUP }, ...groups].map((group) => (
              <RadioRow
                key={group.id ?? "none"}
                layout="picker"
                label={group.name}
                selected={group.id === currentId}
                busy={savingId === (group.id ?? "")}
                disabled={savingId != null && savingId !== (group.id ?? "")}
                onSelect={() => {
                  pick(group.id);
                }}
              />
            ))}
          </div>
          <div className="ui-change-links">
            <TextLink
              icon={<PlusIcon size={16} />}
              chevron={false}
              disabled={move.isPending}
              onClick={() => {
                onView("new");
              }}
            >
              קבוצה חדשה
            </TextLink>
          </div>
        </div>
      </Sheet>
      <Sheet
        open={view === "new"}
        onOpenChange={(next) => {
          if (next) return true;
          if (move.isPending) return false;
          onView(null);
          return true;
        }}
        title="קבוצה חדשה"
        returnFocusRef={returnFocusRef}
        action={(
          <Button busy={move.isPending} onClick={create}>
            שמירה
          </Button>
        )}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <TextField
            label="שם הקבוצה"
            value={name}
            maxLength={GROUP_NAME_MAX * 2}
            error={error}
            disabled={move.isPending}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError(undefined);
            }}
            enterKeyHint="done"
          />
        </form>
      </Sheet>
    </>
  );
}
