import { hebrewMercuryError } from "./mercury-copy";
import { invokeEdge, isRecord } from "./edge";
import { useRef } from "react";
import { useToast } from "./ui/toast";
import { useWrite } from "./use-write";
import { topToast } from "./ui/top-toast";

/** What a successful connect says (FLOW-938): the connection's slot, and whether its accounts are to be chosen. */
export type MercuryConnected = { slot: number; chooseAccounts: boolean };

function connectedOf(response: unknown): MercuryConnected {
  const slot = isRecord(response) && typeof response.slot === "number" ? response.slot : 1;
  // An older server sends no flag: its connection syncs every account as before.
  const choose = isRecord(response) && response.choose_accounts === true;
  return { slot, chooseAccounts: choose };
}

/**
 * Sends a Mercury key (FLOW-938). `slot` is the connection a replaced key is for; without it the server
 * puts the key on the connection whose accounts it lists, or on a new connection. A new connection,
 * or a key for other accounts, goes on to the accounts step, so it says nothing yet.
 */
export function useMercuryConnect({
  apiKey,
  setApiKey,
  slot,
  onSuccess,
  onRejected,
}: {
  apiKey: string;
  setApiKey: (value: string) => void;
  slot?: number;
  onSuccess?: (connected: MercuryConnected) => void;
  /**
   * Mercury refused the key. The connection page says so under the field, so no toast, and its toasts sit
   * under the header (decision 0223); setup, which passes none, keeps its toast and its place.
   */
  onRejected?: () => void;
}) {
  const toast = useToast();
  const result = useRef<MercuryConnected>({ slot: 1, chooseAccounts: false });
  return useWrite({
    failure: (error) => {
      if (error.message === "auth") return "החיבור נכשל. בדקו את המפתח.";
      if (error.message === "transient" || error.message === "rate_limited") return "לא הצלחנו להתחבר. נסו שוב.";
      return hebrewMercuryError(error.message) ?? "לא הצלחנו להתחבר. נסו שוב.";
    },
    silent: (error) => error.message === "auth" && onRejected != null,
    onError: (error) => { if (error.message === "auth") onRejected?.(); },
    keys: ["mercury", "dashboard"],
    ...(onRejected == null ? {} : { place: "top" as const }),
    onSuccess: () => {
      const note = { message: "Mercury מחובר. המפתח נשאר בשרת." };
      if (!result.current.chooseAccounts) toast.show(onRejected == null ? note : topToast(note));
      setApiKey("");
      onSuccess?.(result.current);
    },
    run: async () => {
      let response: unknown;
      try {
        response = await invokeEdge("mercury-connect", { apiKey: apiKey.trim(), ...(slot == null ? {} : { slot }) });
      } finally {
        setApiKey("");
      }
      result.current = connectedOf(response);
    },
  });
}
