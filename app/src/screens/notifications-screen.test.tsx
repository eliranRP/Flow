import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { NO_PREFS, prefsFromData, pushSupport, type NotificationPrefs } from "../push";
import { notificationsHint, NotificationsScreen } from "./notifications-screen";
import { IOS_HOME_NOTE, PUSH_QUESTION, ReviewPushPrompt } from "./review-push-prompt";
import { renderWithProviders } from "../test-render";
import { SAMPLE_DEVICES, SAMPLE_THIS_TAG } from "../push-devices-sample";
import { addedLabel, deviceName } from "../push-devices";

// FLOW-502 option A: the review card asked once. FLOW-516: Settings → התראות has this device's own
// row, the three shared switches and the connected devices.

function renderAt(ui: ReactNode, path = "/settings/notifications") {
  return renderWithProviders(ui, { route: path });
}

const evening: NotificationPrefs = { ...NO_PREFS, evening_reminder: true, prompt_answered: true, has_subscription: true };

describe("push prefs", () => {
  it("reads only true as on, and refuses a missing row", () => {
    expect(prefsFromData({ evening_reminder: true, weekly_summary: "yes" })).toEqual({ ...NO_PREFS, evening_reminder: true });
    expect(() => prefsFromData(null)).toThrow("validation");
  });

  it("says not-configured without a VAPID key, so nothing about push shows", () => {
    expect(pushSupport()).toBe("not-configured");
    const { unmount } = renderAt(<ReviewPushPrompt sample={NO_PREFS} />, "/review");
    expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
    unmount();
    renderAt(
      <Routes>
        <Route path="/settings/notifications" element={<NotificationsScreen />} />
        <Route path="/settings" element={<p>settings home</p>} />
      </Routes>,
    );
    expect(screen.getByText("settings home")).toBeInTheDocument();
  });

  it("names the count of switches on in the Settings hint, or כבויות", () => {
    expect(notificationsHint(NO_PREFS)).toBe("כבויות");
    expect(notificationsHint({ ...NO_PREFS, evening_reminder: true, weekly_summary: true })).toBe("2 פעילות");
  });
});

describe("the review reminder card", () => {
  it("asks once: לא עכשיו hides it, and an answered user never sees it", () => {
    const { unmount } = renderAt(<ReviewPushPrompt sample={NO_PREFS} support="ok" />, "/review");
    expect(screen.getByText(PUSH_QUESTION)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "לא עכשיו" }));
    expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
    unmount();
    renderAt(<ReviewPushPrompt sample={{ ...NO_PREFS, prompt_answered: true }} support="ok" />, "/review");
    expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
  });

  it("is hidden where the browser cannot push, and when the reminder is already on for this device", () => {
    const { unmount } = renderAt(<ReviewPushPrompt sample={NO_PREFS} support="unsupported" />, "/review");
    expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
    unmount();
    renderAt(<ReviewPushPrompt sample={{ ...evening, prompt_answered: false }} support="ok" device="subscribed" />, "/review");
    expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
  });

  it("still asks when the reminder is on only for another device", () => {
    renderAt(<ReviewPushPrompt sample={{ ...evening, prompt_answered: false }} support="ok" device="not-subscribed" />, "/review");
    expect(screen.getByText(PUSH_QUESTION)).toBeInTheDocument();
  });

  it("tells an iPhone tab to add Flow to the Home Screen, without recording an answer", () => {
    renderAt(<ReviewPushPrompt sample={NO_PREFS} support="ios-home-screen" />, "/review");
    fireEvent.click(screen.getByRole("button", { name: "כן" }));
    // The note replaces כן, so focus moves to its one button, which the note describes.
    const dismiss = screen.getByRole("button", { name: "הבנתי" });
    expect(dismiss).toHaveFocus();
    expect(dismiss).toHaveAccessibleDescription(IOS_HOME_NOTE);
    fireEvent.click(dismiss);
    expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
  });
});

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

describe("Settings → התראות", () => {
  afterEach(() => { Reflect.deleteProperty(navigator, "userAgent"); });

  it("shows this device on, the test push next to it, the shared switches and the connected devices", () => {
    renderAt(<NotificationsScreen sample={evening} support="ok" device="subscribed" devices={SAMPLE_DEVICES} thisTag={SAMPLE_THIS_TAG} />);
    expect(screen.getByRole("heading", { name: "התראות" })).toBeInTheDocument();
    const here = screen.getByRole("switch", { name: "המכשיר הזה מקבל התראות" });
    expect(here).toBeChecked();
    expect(here).toHaveAccessibleDescription("התראות פעילות במכשיר הזה");
    expect(screen.getByRole("button", { name: "שליחת התראת בדיקה" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "מה לקבל · לכל המכשירים" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "מכשירים מחוברים" })).toBeInTheDocument();
    expect(screen.getByText("iPhone")).toBeInTheDocument();
    expect(screen.getByText("Chrome במחשב")).toBeInTheDocument();
    expect(screen.getByText("המכשיר הזה")).toBeInTheDocument();
    expect(screen.getByText("נוסף 09/10")).toBeInTheDocument();
  });

  it("flips a shared switch without touching this device", () => {
    renderAt(<NotificationsScreen sample={evening} support="ok" device="subscribed" devices={SAMPLE_DEVICES} />);
    const added = screen.getByRole("switch", { name: "תנועה חדשה" });
    expect(added).not.toBeChecked();
    expect(screen.getByText("כשנכנסת תנועה מהבנק")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "תזכורת ערב" })).toBeChecked();
    expect(screen.getByText("ראשון בבוקר")).toBeInTheDocument();
    fireEvent.click(added);
    expect(added).toBeChecked();
    expect(screen.getByRole("switch", { name: "המכשיר הזה מקבל התראות" })).toBeChecked();
  });

  it("with a switch on but this device not subscribed and no device connected, asks to connect this device", () => {
    renderAt(<NotificationsScreen sample={evening} support="ok" device="not-subscribed" />);
    const here = screen.getByRole("switch", { name: "המכשיר הזה מקבל התראות" });
    expect(here).not.toBeChecked();
    expect(here).toBeEnabled();
    expect(here).toHaveAccessibleDescription("ההתראות לא מגיעות למכשיר הזה");
    expect(screen.getByText("ההתראות לא נשלחות לאף מכשיר. אפשר לחבר את המכשיר הזה למעלה.")).toHaveAttribute("role", "status");
    expect(screen.getByRole("switch", { name: "תזכורת ערב" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "שליחת התראת בדיקה" })).not.toBeInTheDocument();
    expect(screen.getByText("אין מכשיר מחובר.")).toBeInTheDocument();
    fireEvent.click(here);
    expect(here).toBeChecked();
  });

  it("blocked on an iPhone points to the iOS Settings app, and the device row cannot turn on", () => {
    Object.defineProperty(navigator, "userAgent", { value: IPHONE_UA, configurable: true });
    renderAt(<NotificationsScreen sample={evening} support="ok" device="denied" devices={SAMPLE_DEVICES.slice(1)} />);
    const here = screen.getByRole("switch", { name: "המכשיר הזה מקבל התראות" });
    expect(here).toBeDisabled();
    expect(here).toHaveAccessibleDescription("ההתראות חסומות. אפשר לאשר אותן בהגדרות של האייפון › עדכונים › Flow.");
  });

  it("blocked in a desktop browser points to the browser's settings", () => {
    renderAt(<NotificationsScreen sample={evening} support="ok" device="denied" />);
    expect(screen.getByRole("switch", { name: "המכשיר הזה מקבל התראות" })).toHaveAccessibleDescription("ההתראות חסומות בדפדפן. אפשר לאשר אותן בהגדרות הדפדפן.");
  });

  it("on an iPhone tab says to add Flow to the Home Screen; the shared switches still work", () => {
    renderAt(<NotificationsScreen sample={{ ...NO_PREFS, weekly_summary: true }} support="ios-home-screen" />);
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === IOS_HOME_NOTE)).toBeInTheDocument();
    // "למסך הבית" leads to the install steps.
    expect(screen.getByRole("link", { name: "למסך הבית" })).toHaveAttribute("href", "/install");
    const here = screen.getByRole("switch", { name: "המכשיר הזה מקבל התראות" });
    expect(here).toBeDisabled();
    expect(here).toHaveAccessibleDescription(IOS_HOME_NOTE);
    expect(screen.getByRole("switch", { name: "תנועה חדשה" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "סיכום שבועי" })).toBeEnabled();
  });
});

describe("connected device names", () => {
  it("reads a short name from the stored user agent", () => {
    expect(deviceName(IPHONE_UA)).toBe("iPhone");
    expect(deviceName("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36")).toBe("Android");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0")).toBe("Edge במחשב");
    expect(deviceName("Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/140.0")).toBe("Firefox במחשב");
    expect(deviceName("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15")).toBe("Safari במחשב");
    expect(deviceName(null)).toBe("דפדפן");
    expect(addedLabel("2026-10-08T22:30:00.000Z")).toBe("נוסף 09/10");
  });
});
