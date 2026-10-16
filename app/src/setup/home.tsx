import { useEffect, useRef } from "react";
import { useAuth } from "../auth";
import { useHomePreview } from "../preview";
import { useToast } from "../ui/toast";
import { useDashboardQuery } from "../use-books";
import { COMPLETED_TOAST } from "./copy";
import { useSetupFacts } from "./facts";
import { shouldShowCompletedToast, withPatch } from "./model";
import { useSetupStore } from "./store";
import { useSetupViewer } from "./viewer";

/** Home checklist. Hidden until this user has started a run, and hidden in preview. */
// HomeScreen still passes emptyHome; the card it fed is gone, so the prop is unread until #622.
export function SetupHomeSlot(_props: { emptyHome: boolean }) {
  const preview = useHomePreview();
  const { status, session } = useAuth();
  if (preview !== "off" || status !== "authed" || session?.user.id == null) return null;
  return <SetupHomeUser userId={session.user.id} />;
}

function SetupHomeUser({ userId }: { userId: string }) {
  const dashboard = useDashboardQuery();
  const companyId = dashboard.data?.company_id ?? null;
  // Wait for the server copy (FLOW-506): a stale local copy must not show the card, toast, or write.
  const { store, ready } = useSetupStore(userId, companyId);
  if (!ready || store.run_started_at == null) return null;
  return <SetupHomeReady userId={userId} companyId={companyId} />;
}

function SetupHomeReady({ userId, companyId }: { userId: string; companyId: string | null }) {
  const facts = useSetupFacts();
  const viewer = useSetupViewer();
  const { store, update } = useSetupStore(userId, companyId);
  const toast = useToast();
  const toasted = useRef(false);

  useEffect(() => {
    if (viewer.viewer || !shouldShowCompletedToast(store, facts) || toasted.current) return;
    toasted.current = true;
    const at = new Date().toISOString();
    update((current) => withPatch(current, { completed_toast_at: at }));
    toast.show({ message: COMPLETED_TOAST });
  }, [viewer.viewer, store, facts, toast, update]);

  // The Home card is gone (FLOW-514). The slot stays mounted by HomeScreen until #622.
  return null;
}
