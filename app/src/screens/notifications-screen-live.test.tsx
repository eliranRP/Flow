import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceInfo, NotificationPrefs, SubscribeOutcome } from "../push";
import { renderWithProviders } from "../test-render";

// FLOW-516: the live page with the browser steps mocked: the device row's on and off, every failure
// reason shown with its step, the busy state always clearing, and the test push.

const prefs: NotificationPrefs = { new_transaction: false, evening_reminder: true, weekly_summary: false, prompt_answered: true, has_subscription: true };
const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({ getSupabase: () => ({ rpc: (...args: unknown[]) => rpc(...args) as unknown }) }));

const subscribe = vi.fn<() => Promise<SubscribeOutcome>>();
const forget = vi.fn<() => Promise<void>>();
let device: DeviceInfo = { state: "not-subscribed", tag: null };
vi.mock("../push", async (original) => {
  const actual = await original<typeof import("../push")>();
  const { useQuery } = await import("@tanstack/react-query");
  return {
    ...actual,
    subscribeThisDevice: () => subscribe(),
    forgetThisDevice: () => forget(),
    useDevicePushQuery: (enabled: boolean) => useQuery({ queryKey: actual.DEVICE_PUSH_KEY, enabled, queryFn: () => Promise.resolve(device) }),
  };
});
const sendTestPush = vi.fn<() => Promise<string>>();
vi.mock("../push-test", async (original) => ({ ...await original<typeof import("../push-test")>(), sendTestPush: () => sendTestPush() }));

const { NotificationsScreen } = await import("./notifications-screen");

let devices: unknown[] = [];
beforeEach(() => {
  device = { state: "not-subscribed", tag: null };
  devices = [];
  subscribe.mockReset();
  forget.mockReset();
  sendTestPush.mockReset();
  rpc.mockReset();
  rpc.mockImplementation((name: string) => Promise.resolve({
    data: name === "list_my_push_devices" ? { devices } : prefs,
    error: null,
  }));
});

async function deviceSwitch() {
  renderWithProviders(<NotificationsScreen support="ok" />, { route: "/settings/notifications" });
  const here = await screen.findByRole("switch", { name: "המכשיר הזה מקבל התראות" });
  await waitFor(() => { expect(here).not.toHaveAttribute("aria-busy"); });
  return here;
}

describe("the live device row", () => {
  it("prefs on and this device not subscribed: the row is off, and its tap subscribes at once", async () => {
    subscribe.mockResolvedValue({ result: "ok", step: "done" });
    const here = await deviceSwitch();
    expect(here).not.toBeChecked();
    expect(await screen.findByText("ההתראות לא נשלחות לאף מכשיר. אפשר לחבר את המכשיר הזה למעלה.")).toBeInTheDocument();
    device = { state: "subscribed", tag: "aaaaaaaaaaaaaaaa" };
    devices = [{ id: "d1", user_agent: "iPhone Safari/604.1", created_at: "2026-10-20T08:00:00.000Z", tag: "aaaaaaaaaaaaaaaa" }];
    fireEvent.click(here);
    // Called in the tap itself, before anything awaits.
    expect(subscribe).toHaveBeenCalledTimes(1);
    await waitFor(() => { expect(here).toBeChecked(); });
    expect(await screen.findByRole("button", { name: "שליחת התראת בדיקה" })).toBeInTheDocument();
    expect(screen.getByText("המכשיר הזה")).toBeInTheDocument();
  });

  const failures: Array<[SubscribeOutcome, string, string]> = [
    [{ result: "worker-timeout", step: "worker" }, "האפליקציה עוד לא מוכנה להתראות. אפשר לסגור את Flow, לפתוח שוב ולנסות.", "שלב אחרון: טעינת האפליקציה (worker-timeout)"],
    [{ result: "lookup-timeout", step: "lookup" }, "המכשיר לא ענה. אפשר לסגור את Flow, לפתוח שוב ולנסות.", "שלב אחרון: בדיקת הרשמה קיימת (lookup-timeout)"],
    [{ result: "unsubscribe-timeout", step: "unsubscribe", detail: "InvalidStateError: exists" }, "ההרשמה הישנה לא הוסרה. אפשר לסגור את Flow, לפתוח שוב ולנסות.", "שלב אחרון: הסרת הרשמה ישנה (unsubscribe-timeout · InvalidStateError: exists)"],
    [{ result: "subscribe-timeout", step: "subscribe" }, "ההרשמה להתראות לא הסתיימה. אפשר לנסות שוב.", "שלב אחרון: הרשמה במכשיר (subscribe-timeout)"],
    [{ result: "subscribe-threw", step: "subscribe", detail: "AbortError: Registration failed" }, "המכשיר לא אישר את ההרשמה להתראות. אפשר לנסות שוב.", "שלב אחרון: הרשמה במכשיר (subscribe-threw · AbortError: Registration failed)"],
    [{ result: "not-controlled", step: "subscribe" }, "צריך לסגור את Flow ולפתוח שוב, ואז להפעיל.", "שלב אחרון: הרשמה במכשיר (not-controlled)"],
    [{ result: "save-timeout", step: "save" }, "השמירה בשרת לא הסתיימה. אפשר לנסות שוב.", "שלב אחרון: שמירה בשרת (save-timeout)"],
    [{ result: "save-failed", step: "save", detail: "Error: invalid endpoint" }, "לא הצלחנו לשמור את המכשיר. אפשר לנסות שוב.", "שלב אחרון: שמירה בשרת (save-failed · Error: invalid endpoint)"],
    [{ result: "dismissed", step: "permission" }, "ההתראות לא אושרו. אפשר לנסות שוב.", "שלב אחרון: אישור התראות (dismissed)"],
  ];

  it.each(failures)("a turn-on that stops at %o says why, keeps the step on screen and clears busy", async (outcome, toast, diagnostic) => {
    let finish: (value: SubscribeOutcome) => void = () => undefined;
    subscribe.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const here = await deviceSwitch();
    fireEvent.click(here);
    await waitFor(() => { expect(here).toHaveAttribute("aria-busy", "true"); });
    await act(async () => { finish(outcome); await Promise.resolve(); });
    await waitFor(() => { expect(here).not.toHaveAttribute("aria-busy"); });
    expect(here).not.toBeChecked();
    expect(await screen.findByText(toast)).toBeInTheDocument();
    expect(screen.getByText(diagnostic)).toHaveAttribute("data-push-diagnostic");
    // A second tap tries again.
    subscribe.mockResolvedValue({ result: "ok", step: "done" });
    fireEvent.click(here);
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("off unsubscribes this device only (here and on the server), and the switches stay as they are", async () => {
    device = { state: "subscribed", tag: null };
    forget.mockResolvedValue(undefined);
    const here = await deviceSwitch();
    expect(here).toBeChecked();
    device = { state: "not-subscribed", tag: null };
    fireEvent.click(here);
    await waitFor(() => { expect(forget).toHaveBeenCalledTimes(1); });
    await waitFor(() => { expect(here).not.toBeChecked(); });
    expect(screen.getByRole("switch", { name: "תזכורת ערב" })).toBeChecked();
    expect(rpc).not.toHaveBeenCalledWith("set_notification_prefs", expect.anything());
  });

  it("a shared switch saves the prefs and never subscribes", async () => {
    await deviceSwitch();
    fireEvent.click(screen.getByRole("switch", { name: "תנועה חדשה" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("set_notification_prefs", expect.objectContaining({ p_new_transaction: true })); });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("the test push says what happened", async () => {
    device = { state: "subscribed", tag: null };
    devices = [{ id: "d1", user_agent: null, created_at: "2026-10-20T08:00:00.000Z", tag: "bbbbbbbbbbbbbbbb" }];
    sendTestPush.mockResolvedValueOnce("sent").mockResolvedValueOnce("limit");
    await deviceSwitch();
    const button = await screen.findByRole("button", { name: "שליחת התראת בדיקה" });
    fireEvent.click(button);
    expect(await screen.findByText("נשלחה התראת בדיקה")).toBeInTheDocument();
    await waitFor(() => { expect(button).toHaveAttribute("aria-busy", "false"); });
    fireEvent.click(button);
    expect(await screen.findByText("אפשר לשלוח עד 5 בדיקות בשעה.")).toBeInTheDocument();
  });
});
