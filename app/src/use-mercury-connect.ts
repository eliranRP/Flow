import { hebrewMercuryError } from "./mercury-copy";
import { invokeEdge } from "./edge";
import { useWrite } from "./use-write";

export function useMercuryConnect({
  apiKey,
  setApiKey,
  onSuccess,
}: {
  apiKey: string;
  setApiKey: (value: string) => void;
  onSuccess?: () => void;
}) {
  return useWrite({
    failure: (error) => {
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
    },
  });
}
