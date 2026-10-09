import { hebrewSumitError } from "./sumit-copy";
import { invokeEdge } from "./edge";
import { IMPORT_FROM_FAILED, importFromAfterConnect } from "./import-from";
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
  /** "ייבוא מ" (FLOW-505), sent with the connect call. Undefined leaves it as it is. */
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
      toast.show(dateFailed.current ? { message: IMPORT_FROM_FAILED("SUMIT"), tone: "info" } : { message: "SUMIT מחובר. המפתח נשאר בשרת." });
      setApiKey("");
      onSuccess?.();
    },
    run: async () => {
      const response = await invokeEdge("sumit-connect", { companyId: Number(companyId), apiKey, importFrom });
      setApiKey("");
      dateFailed.current = !(await importFromAfterConnect("sumit", importFrom, response));
    },
  });
}
