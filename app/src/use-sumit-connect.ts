import { hebrewSumitError } from "./sumit-copy";
import { invokeEdge } from "./edge";
import { useWrite } from "./use-write";

export function useSumitConnect({
  companyId,
  apiKey,
  setApiKey,
  onSuccess,
}: {
  companyId: string;
  apiKey: string;
  setApiKey: (value: string) => void;
  onSuccess?: () => void;
}) {
  return useWrite({
    failure: (error) => {
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
    },
  });
}
