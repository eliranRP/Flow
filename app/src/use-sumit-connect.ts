import { hebrewSumitError } from "./sumit-copy";
import { invokeEdge } from "./edge";
import { IMPORT_FROM_FAILED, saveImportFrom } from "./import-from";
import { useRef } from "react";
import { useToast } from "./ui/toast";
import { useWrite } from "./use-write";

export function useSumitConnect({
  companyId,
  apiKey,
  setApiKey,
  onSuccess,
  importFrom,
}: {
  companyId: string;
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
      if (error.message === "sumit_auth") return "החיבור נכשל. בדקו את המזהה ואת המפתח.";
      return hebrewSumitError(error.message) ?? "לא הצלחנו להתחבר. נסו שוב.";
    },
    keys: ["sumit", "dashboard"],
    onSuccess: () => {
      toast.show({ message: dateFailed.current ? IMPORT_FROM_FAILED("SUMIT") : "SUMIT מחובר. המפתח נשאר בשרת." });
      setApiKey("");
      onSuccess?.();
    },
    run: async () => {
      await invokeEdge("sumit-connect", { companyId: Number(companyId), apiKey });
      setApiKey("");
      dateFailed.current = false;
      if (importFrom !== undefined) await saveImportFrom("sumit", importFrom).catch(() => { dateFailed.current = true; });
    },
  });
}
