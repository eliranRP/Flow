import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NO_PREFS, prefsFromData, pushSupport, type NotificationPrefs } from "../push";
import { ToastProvider } from "../ui/toast";
import { notificationsHint, NotificationsScreen } from "./notifications-screen";
import { IOS_HOME_NOTE, PUSH_QUESTION, ReviewPushPrompt } from "./review-push-prompt";

// FLOW-502 option A: the review card asked once, and Settings → התראות with three switches.

function renderAt(ui: ReactNode, path = "/settings/notifications") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
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

  it("names the switches that are on in the Settings hint, or כבוי", () => {
    expect(notificationsHint(NO_PREFS)).toBe("כבוי");
    expect(notificationsHint({ ...NO_PREFS, evening_reminder: true, weekly_summary: true })).toBe("תזכורת ערב · סיכום שבועי");
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

  it("is hidden where the browser cannot push, and when the reminder is already on", () => {
    const { unmount } = renderAt(<ReviewPushPrompt sample={NO_PREFS} support="unsupported" />, "/review");
    expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
    unmount();
    renderAt(<ReviewPushPrompt sample={{ ...evening, prompt_answered: false }} support="ok" />, "/review");
    expect(screen.queryByText(PUSH_QUESTION)).not.toBeInTheDocument();
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

describe("Settings → התראות", () => {
  it("shows three switches with their hints, the evening reminder on, and flips one in a sample", () => {
    renderAt(<NotificationsScreen sample={evening} support="ok" />);
    expect(screen.getByRole("heading", { name: "התראות" })).toBeInTheDocument();
    const added = screen.getByRole("switch", { name: "תנועה חדשה" });
    expect(added).not.toBeChecked();
    expect(screen.getByText("כשנכנסת תנועה מהבנק")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "תזכורת ערב" })).toBeChecked();
    expect(screen.getByText("ראשון בבוקר")).toBeInTheDocument();
    fireEvent.click(added);
    expect(added).toBeChecked();
  });

  it("on an iPhone tab says to add Flow to the Home Screen and keeps off switches off", () => {
    renderAt(<NotificationsScreen sample={{ ...NO_PREFS, weekly_summary: true }} support="ios-home-screen" />);
    expect(screen.getByText(IOS_HOME_NOTE)).toBeInTheDocument();
    const off = screen.getByRole("switch", { name: "תנועה חדשה" });
    expect(off).toBeDisabled();
    expect(off).toHaveAccessibleDescription(`כשנכנסת תנועה מהבנק ${IOS_HOME_NOTE}`);
    // A switch that is on can still turn off.
    expect(screen.getByRole("switch", { name: "סיכום שבועי" })).toBeEnabled();
  });
});
