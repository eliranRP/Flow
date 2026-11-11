import { doneCount, settingsEntryTarget, settingsEntryVisible } from "./model";
import { useSetupFacts } from "./facts";
import { useSetupStore } from "./store";

/**
 * Settings › עוד › הגדרה ראשונה (FLOW-514). Visible once a run started, until every step is done.
 * The href opens the first step not done (a skipped one included), also after skip all (FLOW-1161).
 */
export function useSetupSettingsEntry(userId: string | null, companyId: string | null): { href: string; done: number } | null {
  const { store } = useSetupStore(userId, companyId);
  const facts = useSetupFacts(store.run_started_at != null);
  if (!settingsEntryVisible(store, facts)) return null;
  return { href: settingsEntryTarget(store, facts), done: doneCount(store, facts) };
}
