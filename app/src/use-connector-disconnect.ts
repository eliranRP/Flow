import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
  dropDisconnects,
  flushDisconnects,
  startDisconnect,
  useLeavingSlots,
  type ConnectorProvider,
  type DisconnectJob,
} from "./connection-undo";
import { getSupabase } from "./lib/supabase";
import type { MercuryState } from "./mercury-state";
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

/** The status after the disconnect, written before the wait ends, so the connection does not flicker back while the read runs. */
async function drawGone(client: QueryClient, provider: ConnectorProvider, slot: number): Promise<void> {
  if (provider === "sumit") {
    client.setQueriesData<Record<string, unknown>>({ queryKey: ["sumit"] }, (old) => (old == null ? old : { ...old, connected: false, last_error: null, syncing: false }));
  } else {
    client.setQueriesData<MercuryState>({ queryKey: ["mercury"] }, (old) => {
      if (old == null) return old;
      const connections = old.connections.filter((connection) => connection.slot !== slot);
      return { ...old, connections, connected: connections.some((connection) => connection.chosen && connection.keyWorks), syncing: false };
    });
  }
  await client.invalidateQueries({ queryKey: [provider] });
}

/**
 * Decision 0223: a connection page's ניתוק. The connection leaves the page at once, and the toast under
 * the header offers ביטול; the disconnect is sent when that toast closes (or the app is left, or a new
 * key needs it out of the way). A sample (stories, dev routes) sends nothing: `sampleSend` drops it in
 * memory instead.
 */
export function useConnectorDisconnect({
  provider,
  live,
  revoked,
  sampleSend,
}: {
  provider: ConnectorProvider;
  /** A live page writes the server; a sample or a preview does not. */
  live: boolean;
  /** The role is now one that cannot disconnect (viewer, editor); a role still loading is not. */
  revoked: boolean;
  sampleSend: (slot: number) => void;
}) {
  const toast = useTopToast();
  const client = useQueryClient();
  const leaving = useLeavingSlots(provider);
  const [connecting, setConnecting] = useState(false);

  // An owner who is now a viewer or an editor while ביטול is on screen: nothing is sent, and the page says why.
  useEffect(() => {
    if (!revoked) return;
    if (dropDisconnects(provider) > 0) toast.show({ tone: "info", message: "החיבור נשאר: אין לך הרשאה לנתק" });
  }, [revoked, provider, toast]);

  const disconnect = useCallback((slot: number) => {
    const job: DisconnectJob = {
      provider,
      slot,
      send: live ? () => sendDisconnect(provider, slot) : () => { sampleSend(slot); return Promise.resolve(); },
      onSent: live ? () => drawGone(client, provider, slot) : undefined,
      onRefused: () => { toast.show({ tone: "info", message: "הניתוק בוטל, עברת לעסק אחר" }); },
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
    // The wait ended another way (the app was left, a new key, a role that cannot disconnect): the ביטול goes with it.
    hold.onEnd(() => { toast.dismiss(id); });
    // The tapped button goes away with the connection: focus goes to the page title, not to nothing.
    focusConnectionTitle();
  }, [provider, live, sampleSend, client, toast]);

  /**
   * Sends a new key after the provider's waiting disconnects, which would otherwise delete it. Busy until
   * the key goes out, so a second tap does not send two.
   */
  const connectAfter = useCallback((connect: () => void) => {
    if (connecting) return;
    setConnecting(true);
    void flushDisconnects(provider).then(() => {
      setConnecting(false);
      connect();
    });
  }, [connecting, provider]);

  return { leaving, disconnect, connectAfter, connecting };
}
