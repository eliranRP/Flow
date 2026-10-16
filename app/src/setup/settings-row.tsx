import { doneCount, settingsEntryVisible } from "./model";
import { useSetupFacts } from "./facts";
import { useSetupStore } from "./store";

/**
 * Settings › עוד › הגדרה ראשונה (FLOW-514). Visible once a run started, until every step is done.
 * The href is the index, which opens the first step not done (a skipped one included).
 */
export function useSetupSettingsEntry(userId: string | null, companyId: string | null): { href: string; done: number } | null {
  const { store } = useSetupStore(userId, companyId);
  const facts = useSetupFacts(store.run_started_at != null);
  if (!settingsEntryVisible(store, facts)) return null;
  return { href: "/setup", done: doneCount(store, facts) };
}
