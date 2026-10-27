import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import {
  cancelDisconnects,
  flushDisconnects,
  replayDisconnects,
  startDisconnect,
  useLeavingSlots,
  type ConnectorProvider,
  type DisconnectJob,
} from "./connection-undo";
import { getSupabase } from "./lib/supabase";
import { focusConnectionTitle } from "./ui/connection-page";
import { useTopToast } from "./ui/top-toast";
import { assertNoError } from "./use-write";

const GONE: Record<ConnectorProvider, string> = {
  mercury: "Mercury נותק. מה שכבר נכנס נשמר",
  sumit: "SUMIT נותק. מה שכבר נכנס נשמר",
};

/** The disconnect itself: SUMIT's one connection, or one Mercury connection by its slot. */
async function sendDisconnect(provider: ConnectorProvider, slot: number): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  if (provider === "sumit") assertNoError(await supabase.rpc("disconnect_sumit"));
  else assertNoError(await supabase.rpc("disconnect_connector", { p_provider: "mercury", p_slot: slot }));
}

/**
 * Decision 0223: a connection page's ניתוק. The connection leaves the page at once, and the toast under
 * the header offers ביטול; the disconnect is sent when that toast closes (or the app is left, or a new
 * key needs it out of the way). A sample (stories, dev routes) sends nothing: `sampleSend` drops it in
 * memory instead.
 */
export function useConnectorDisconnect({
  provider,
  companyId,
  live,
  readOnly,
  sampleSend,
}: {
  provider: ConnectorProvider;
  companyId: string | null;
  /** A live page reads and writes the server; a sample or a preview does not. */
  live: boolean;
  /** A viewer cannot disconnect; a role that turns read-only mid-wait cancels the wait. */
  readOnly: boolean;
  sampleSend?: (slot: number) => void;
}) {
  const toast = useTopToast();
  const client = useQueryClient();
  const leaving = useLeavingSlots(provider);

  // An owner who becomes a viewer while ביטול is on screen: nothing is sent.
  useEffect(() => {
    if (readOnly) cancelDisconnects(provider);
  }, [readOnly, provider]);

  // A disconnect a reload or a closed app left waiting is sent now, when it is fresh and for this company.
  useEffect(() => {
    if (!live || companyId == null || readOnly) return;
    replayDisconnects(companyId, (savedProvider, slot) => sendDisconnect(savedProvider, slot).then(() => {
      void client.invalidateQueries({ queryKey: [savedProvider] });
    }));
  }, [live, companyId, readOnly, client]);

  const disconnect = useCallback((slot: number) => {
    const job: DisconnectJob = {
      provider,
      slot,
      companyId,
      send: live ? () => sendDisconnect(provider, slot) : () => { sampleSend?.(slot); return Promise.resolve(); },
      onSent: () => { void client.invalidateQueries({ queryKey: [provider] }); },
      onFailed: () => {
        void client.invalidateQueries({ queryKey: [provider] });
        toast.show({
          tone: "bad",
          message: "לא הצלחנו לנתק.",
          action: "ניסיון חוזר",
          onAction: () => { void startDisconnect(job).end(); },
        });
      },
    };
    const hold = startDisconnect(job);
    const id = toast.show({
      message: GONE[provider],
      action: "ביטול",
      onAction: () => {
        if (!hold.cancel()) toast.show({ tone: "info", message: "החיבור כבר נותק" });
        focusConnectionTitle();
      },
      // The wait lasts exactly as long as ביטול is on screen: a hover or focus that pauses the toast keeps it.
      onClose: () => { void hold.end(); },
    });
    // Leaving the app ends the wait; the ביטול that can no longer work goes with it.
    hold.onEnd(() => { toast.dismiss(id); });
    // The tapped button goes away with the connection: focus goes to the page title, not to nothing.
    focusConnectionTitle();
  }, [provider, companyId, live, sampleSend, client, toast]);

  /** Before a new key is sent: an old disconnect still waiting would delete it, so it goes out first. */
  const beforeConnect = useCallback(() => flushDisconnects(provider), [provider]);

  return { leaving, disconnect, beforeConnect };
}
