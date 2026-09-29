import { assertSumitUrl } from "./ledger.ts";
import { classifySumitStatus } from "./sumit-policy.ts";

const LIST_FOLDERS = "https://api.sumit.co.il/crm/schema/listfolders/";

/**
 * One listfolders read, then `write`. A non-zero Status throws and never calls `write`,
 * so sumit-connect cannot store a key that SUMIT already rejected.
 */
export async function connectValidated<T>(input: {
  companyId: number;
  apiKey: string;
  fetch: typeof fetch;
  write: () => Promise<T>;
}): Promise<T> {
  assertSumitUrl(LIST_FOLDERS);
  const response = await input.fetch(LIST_FOLDERS, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ Credentials: { CompanyID: input.companyId, APIKey: input.apiKey } }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error("connect_failed");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("connect_failed");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("connect_failed");
  const record = parsed as Record<string, unknown>;
  if (record.Status !== 0) {
    const userMessage = typeof record.UserErrorMessage === "string" ? record.UserErrorMessage : "";
    console.error("sumit-connect rejected", userMessage.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]").slice(0, 200));
    throw new Error(classifySumitStatus(userMessage));
  }
  return input.write();
}
