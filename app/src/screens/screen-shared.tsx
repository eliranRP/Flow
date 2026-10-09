import { getSupabase } from "../lib/supabase";
import { useHomePreview, type HomePreview } from "../preview";
import { type ScreenPhase } from "../query-phase";
import { assertNoError } from "../use-write";
import { type ChangeChoice } from "../ui/change-sheet";
import { useToast } from "../ui/toast";

function blockedPreview(preview: HomePreview, tell: (message: string) => void): boolean {
  if (preview === "off") return false;
  tell("במצב תצוגה זה לא נשמר.");
  return true;
}

/** `place: "bar"` puts the toast above a screen's pinned action bar (decision 0137). */
export function useBlockedPreview(place?: "bar"): (mode?: HomePreview) => boolean {
  const preview = useHomePreview();
  const toast = useToast();
  return (mode?: HomePreview) => blockedPreview(mode ?? preview, (message) => {
    toast.show({ tone: "info", message, ...(place == null ? {} : { place }) });
  });
}

export async function collapseSplit(transactionId: string, projectId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase || transactionId === "" || projectId === "") throw new Error("supabase");
  const saved = await supabase.rpc("collapse_split", { p_id: transactionId, p_project_id: projectId });
  assertNoError(saved);
  return typeof saved.data === "string" ? saved.data : null;
}

export async function saveNewProject(
  name: string,
  blocked: () => boolean,
  toast: { show: (toast: { tone?: "bad" | "info"; message: string }) => void },
  remember: (project: ChangeChoice) => void,
  invalidate: (keys: readonly string[]) => Promise<void>,
): Promise<ChangeChoice> {
  if (blocked()) throw new Error("preview");
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  try {
    const saved = await supabase.rpc("upsert_project", { p_name: name, p_status: "active" });
    assertNoError(saved);
    if (typeof saved.data !== "string") throw new Error("supabase");
    const created = { id: saved.data, name, status: "active" as const };
    remember(created);
    await invalidate(["dashboard"]);
    toast.show({ message: "הפרויקט נשמר" });
    return created;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "preview") {
      toast.show({ tone: "bad", message: "לא הצלחנו לשמור את הפרויקט." });
    }
    throw error;
  }
}

export function ReservedMenuSlot() {
  return <span className="ui-menu-slot" aria-hidden="true" />;
}

export function invoiceDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

export function withChoice(options: ChangeChoice[], id: string, name: string | null | undefined): ChangeChoice[] {
  if (id === "" || name == null || name === "" || options.some((option) => option.id === id)) return options;
  return [{ id, name }, ...options];
}

export const KEPT_OUT = "לא נספר ברווח";
export const KEPT_OUT_SHORT = "לא נספר ברווח";
/** FLOW-124: a line split by category with some parts kept out. */
export const MIXED_SHORT = "חלקית ברווח";

export function combinePhase(left: ScreenPhase, right: ScreenPhase): ScreenPhase {
  if (left.kind === "error") return left;
  if (right.kind === "error") return right;
  if (left.kind === "loading" || right.kind === "loading") return { kind: "loading" };
  if (left.kind === "empty" || right.kind === "empty") return { kind: "empty" };
  return { kind: "ready" };
}
