import { useEffect, useRef } from "react";
import { useAuth } from "../auth";
import { useHomePreview } from "../preview";
import { useToast } from "../ui/toast";
import { useDashboardQuery } from "../use-books";
import { SetupCard } from "./card";
import { COMPLETED_TOAST, DISMISS_TOAST } from "./copy";
import { useSetupFacts } from "./facts";
import { cardRows, cardVisible, doneCount, shouldShowCompletedToast, withPatch } from "./model";
import { useSetupStore } from "./store";
import { useSetupViewer } from "./viewer";

/** Home checklist. Hidden until this user has started a run, and hidden in preview. */
export function SetupHomeSlot({ emptyHome }: { emptyHome: boolean }) {
  const preview = useHomePreview();
  const { status, session } = useAuth();
  if (preview !== "off" || status !== "authed" || session?.user.id == null) return null;
  return <SetupHomeUser userId={session.user.id} emptyHome={emptyHome} />;
}

function SetupHomeUser({ userId, emptyHome }: { userId: string; emptyHome: boolean }) {
  const dashboard = useDashboardQuery();
  const companyId = dashboard.data?.company_id ?? null;
  const { store } = useSetupStore(userId, companyId);
  if (store.run_started_at == null) return null;
  return <SetupHomeReady userId={userId} companyId={companyId} emptyHome={emptyHome} />;
}

function SetupHomeReady({
  userId,
  companyId,
  emptyHome,
}: {
  userId: string;
  companyId: string | null;
  emptyHome: boolean;
}) {
  const facts = useSetupFacts();
  const viewer = useSetupViewer();
  const { store, update } = useSetupStore(userId, companyId);
  const toast = useToast();
  const toasted = useRef(false);
  const showCard = cardVisible(store, facts, viewer.viewer);
  const rows = cardRows(store, facts, emptyHome);

  useEffect(() => {
    if (viewer.viewer || !shouldShowCompletedToast(store, facts) || toasted.current) return;
    toasted.current = true;
    const at = new Date().toISOString();
    update((current) => withPatch(current, { completed_toast_at: at }));
    toast.show({ message: COMPLETED_TOAST, place: "tab" });
  }, [viewer.viewer, store, facts, toast, update]);

  if (!showCard) return null;
  return (
    <SetupCard
      done={doneCount(store, facts)}
      steps={rows}
      onDismiss={() => {
        const at = new Date().toISOString();
        update((current) => withPatch(current, { card_dismissed_at: at }));
        toast.show({
          message: DISMISS_TOAST,
          place: "tab",
          action: "ביטול",
          onAction: () => {
            update((current) => withPatch(current, { card_dismissed_at: null }));
          },
        });
      }}
    />
  );
}
