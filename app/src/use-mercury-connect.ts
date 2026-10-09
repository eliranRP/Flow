import { hebrewMercuryError } from "./mercury-copy";
import { invokeEdge } from "./edge";
import { IMPORT_FROM_FAILED, saveImportFrom } from "./import-from";
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
  return useWrite({
    failure: (error) => {
      if (error.message === "import_from") return IMPORT_FROM_FAILED("Mercury");
      if (error.message === "auth") return "החיבור נכשל. בדקו את המפתח.";
      if (error.message === "rejected") return hebrewMercuryError("rejected") ?? "לא הצלחנו להתחבר. נסו שוב.";
      if (error.message === "transient" || error.message === "rate_limited") return "לא הצלחנו להתחבר. נסו שוב.";
      return hebrewMercuryError(error.message) ?? "לא הצלחנו להתחבר. נסו שוב.";
    },
    success: "Mercury מחובר. המפתח נשאר בשרת.",
    keys: ["mercury", "dashboard"],
    onSuccess: () => {
      setApiKey("");
      onSuccess?.();
    },
    run: async () => {
      try {
        await invokeEdge("mercury-connect", { apiKey: apiKey.trim() });
      } finally {
        setApiKey("");
      }
      if (importFrom !== undefined) await saveImportFrom("mercury", importFrom).catch(() => { throw new Error("import_from"); });
    },
  });
}
