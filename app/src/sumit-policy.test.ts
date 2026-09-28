import { describe, expect, it } from "vitest";
import { classifySumitStatus } from "../../supabase/functions/_shared/sumit-policy";

describe("classifySumitStatus", () => {
  it.each([
    ["API is restricted due to exceeding the ActionsBilling obligo", "sumit_rejected"],
    ["invalid api key", "sumit_auth"],
    ["wrong company id", "sumit_auth"],
    ["מפתח API שגוי", "sumit_auth"],
    ["מזהה חברה לא תואם", "sumit_auth"],
    ["מזהה מסמך לא קיים", "sumit_rejected"],
    ["permission denied for document", "sumit_rejected"],
    ["unauthorized", "sumit_auth"],
  ] as const)("classifies %s as %s", (message, code) => {
    expect(classifySumitStatus(message)).toBe(code);
  });
});
