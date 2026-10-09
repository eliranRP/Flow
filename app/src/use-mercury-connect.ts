import { hebrewMercuryError } from "./mercury-copy";
import { invokeEdge } from "./edge";
import { IMPORT_FROM_FAILED, saveImportFrom } from "./import-from";
import { useRef } from "react";
import { useToast } from "./ui/toast";
import { useWrite } from "./use-write";

export function useMercuryConnect({
  apiKey,
  setApiKey,
  onSuccess,
  importFrom,
}: {
  apiKey: string;
  setApiKey: (value: string) => void;
  onSuccess?: () => void;
  /** "ייבוא מ" (FLOW-505), saved once the connection exists. Undefined leaves it as it is. */
  importFrom?: string | null;
}) {
  const toast = useToast();
  // The connection stands even when only the date fails, so the write still succeeds.
  const dateFailed = useRef(false);
  return useWrite({
    failure: (error) => {
      if (error.message === "auth") return "החיבור נכשל. בדקו את המפתח.";
      if (error.message === "rejected") return hebrewMercuryError("rejected") ?? "לא הצלחנו להתחבר. נסו שוב.";
      if (error.message === "transient" || error.message === "rate_limited") return "לא הצלחנו להתחבר. נסו שוב.";
      return hebrewMercuryError(error.message) ?? "לא הצלחנו להתחבר. נסו שוב.";
    },
    keys: ["mercury", "dashboard"],
    onSuccess: () => {
      toast.show(dateFailed.current ? { message: IMPORT_FROM_FAILED("Mercury"), tone: "info" } : { message: "Mercury מחובר. המפתח נשאר בשרת." });
      setApiKey("");
      onSuccess?.();
    },
    run: async () => {
      try {
        await invokeEdge("mercury-connect", { apiKey: apiKey.trim() });
      } finally {
        setApiKey("");
      }
      dateFailed.current = false;
      if (importFrom !== undefined) await saveImportFrom("mercury", importFrom).catch(() => { dateFailed.current = true; });
    },
  });
}
