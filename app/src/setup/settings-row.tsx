import { doneCount, firstNotDone, settingsEntryVisible } from "./model";
import { useSetupFacts } from "./facts";
import { useSetupStore } from "./store";

/** Settings › עוד › הגדרה ראשונה. Hidden until the run starts, and hidden again at 5 of 5. */
export function useSetupSettingsEntry(userId: string | null, companyId: string | null): { href: string; done: number } | null {
  const { store } = useSetupStore(userId, companyId);
  const facts = useSetupFacts(store.run_started_at != null);
  if (!settingsEntryVisible(store, facts)) return null;
  const step = firstNotDone(store, facts);
  if (step == null) return null;
  return { href: `/setup/${String(step)}?from=card`, done: doneCount(store, facts) };
}
