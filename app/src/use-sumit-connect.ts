import { hebrewSumitError } from "./sumit-copy";
import { invokeEdge } from "./edge";
import { IMPORT_FROM_FAILED, importFromAfterConnect } from "./import-from";
import { useRef } from "react";
import { useToast } from "./ui/toast";
import { useWrite } from "./use-write";
import { connectionToast } from "./connection-toast";

export function useSumitConnect({
  companyId,
  apiKey,
  setApiKey,
  onSuccess,
  onRejected,
  importFrom,
}: {
  companyId: string;
  apiKey: string;
  setApiKey: (value: string) => void;
  onSuccess?: () => void;
  /**
   * SUMIT refused the key. The connection page says so under the field, so no toast, and its toasts sit
   * under the header (decision 0223); setup, which passes none, keeps its toast and its place.
   */
  onRejected?: () => void;
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
    silent: (error) => error.message === "sumit_auth" && onRejected != null,
    onError: (error) => { if (error.message === "sumit_auth") onRejected?.(); },
    keys: ["sumit", "dashboard"],
    ...(onRejected == null ? {} : { place: "top" as const }),
    onSuccess: () => {
      const note = dateFailed.current ? { message: IMPORT_FROM_FAILED("SUMIT"), tone: "info" as const } : { message: "SUMIT מחובר. המפתח נשאר בשרת." };
      toast.show(onRejected == null ? note : connectionToast(note));
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
