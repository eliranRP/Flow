import { invokeEdge, isRecord } from "./edge";

/**
 * FLOW-516: "שליחת התראת בדיקה". push-send's "test" kind sends one push to the caller's own
 * devices; the server names the user from the JWT and allows 5 an hour (decision 0201).
 */
export type TestPushResult = "sent" | "no-device" | "limit" | "failed";

export async function sendTestPush(): Promise<TestPushResult> {
  let data: unknown;
  try {
    data = await invokeEdge("push-send", { kind: "test" });
  } catch (error) {
    return error instanceof Error && error.message === "push_test_limit" ? "limit" : "failed";
  }
  if (!isRecord(data) || typeof data.sent !== "number") return "failed";
  if (data.sent > 0) return "sent";
  // No device, or every device the server had is gone: this one needs turning on again.
  return data.devices === 0 || data.gone === data.devices ? "no-device" : "failed";
}

export const TEST_PUSH_COPY: Record<TestPushResult, string> = {
  sent: "נשלחה התראת בדיקה",
  "no-device": "אין מכשיר רשום. אפשר להפעיל שוב במכשיר הזה.",
  limit: "אפשר לשלוח עד 5 בדיקות בשעה.",
  failed: "לא הצלחנו לשלוח התראת בדיקה.",
};
