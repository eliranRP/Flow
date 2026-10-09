import { hebrewSumitError } from "./sumit-copy";
import { invokeEdge } from "./edge";
import { IMPORT_FROM_FAILED, saveImportFrom } from "./import-from";
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
  return useWrite({
    failure: (error) => {
      if (error.message === "import_from") return IMPORT_FROM_FAILED("SUMIT");
      if (error.message === "sumit_auth") return "החיבור נכשל. בדקו את המזהה ואת המפתח.";
      return hebrewSumitError(error.message) ?? "לא הצלחנו להתחבר. נסו שוב.";
    },
    success: "SUMIT מחובר. המפתח נשאר בשרת.",
    keys: ["sumit", "dashboard"],
    onSuccess: () => {
      setApiKey("");
      onSuccess?.();
    },
    run: async () => {
      await invokeEdge("sumit-connect", { companyId: Number(companyId), apiKey });
      setApiKey("");
      if (importFrom !== undefined) await saveImportFrom("sumit", importFrom).catch(() => { throw new Error("import_from"); });
    },
  });
}
