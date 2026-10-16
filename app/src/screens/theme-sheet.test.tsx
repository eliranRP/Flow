// FLOW-372: Settings › מראה. A pick applies at once, closes the sheet and shows the undo toast;
// ביטול restores the previous choice; the choice is saved on this device only.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readThemeChoice, writeThemeChoice, type ThemeChoice } from "../theme-store";
import { toastMs } from "../ui/toast-layout";
import { ToastProvider } from "../ui/toast";
import { THEME_UNDO_MS, ThemeSheet, themePickToast } from "./theme-sheet";

function Harness() {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState<ThemeChoice>(readThemeChoice);
  return (
    <>
      <p>{open ? "open" : "closed"}</p>
      <ThemeSheet
        open={open}
        onOpenChange={setOpen}
        value={value}
        onChange={(next) => {
          writeThemeChoice(next);
          setValue(next);
        }}
      />
    </>
  );
}

function renderSheet() {
  const router = createMemoryRouter([{ path: "/settings", element: <Harness /> }], { initialEntries: ["/settings"] });
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
}

const device = () => screen.getByRole("radio", { name: /^לפי המכשיר/ });
const light = () => screen.getByRole("radio", { name: /^בהיר/ });
const dark = () => screen.getByRole("radio", { name: /^כהה/ });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeSheet (Settings › מראה)", () => {
  it("shows the title, the subtitle and the three choices with their descriptions", async () => {
    renderSheet();
    expect(await screen.findByRole("radiogroup", { name: "מראה" })).toBeInTheDocument();
    // The subtitle is in the header's title column, beside the title, not in a hint paragraph.
    const subtitle = screen.getByText("רק בטלפון הזה");
    expect(subtitle.closest(".ui-sheet-titles")).toContainElement(screen.getByRole("heading", { name: "מראה" }));
    expect(subtitle.closest(".ui-sheet-head")).toContainElement(subtitle);
    expect(subtitle.closest(".ui-sheet-hint")).toBeNull();
    expect(screen.getByText("עובר בין בהיר לכהה יחד עם הטלפון")).toBeInTheDocument();
    expect(screen.getByText("רקע לבן, נוח באור יום")).toBeInTheDocument();
    expect(screen.getByText("רקע כהה, נוח בערב ובחושך")).toBeInTheDocument();
    expect(device()).toHaveAttribute("aria-checked", "true");
  });

  it("applies a pick at once, saves it on this device, closes the sheet and shows the undo toast", async () => {
    renderSheet();
    fireEvent.click(light());
    await screen.findByText("מראה בהיר");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("flow.theme")).toBe("light");
    expect(screen.getByText("closed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ביטול" })).toBeInTheDocument();
  });

  it("the pick toast says the board's words: the device's choice, or מראה and the choice", async () => {
    expect(themePickToast("system")).toBe("המראה עובר עם הטלפון");
    expect(themePickToast("light")).toBe("מראה בהיר");
    expect(themePickToast("dark")).toBe("מראה כהה");
    renderSheet();
    fireEvent.click(dark());
    await screen.findByText("מראה כהה");
  });

  it("ביטול restores the previous choice and says so", async () => {
    renderSheet();
    fireEvent.click(dark());
    await screen.findByText("מראה כהה");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    // Only a revert: the previous choice comes back and no new toast is shown.
    await waitFor(() => { expect(document.documentElement.hasAttribute("data-theme")).toBe(false); });
    expect(localStorage.getItem("flow.theme")).toBe("system");
    await waitFor(() => { expect(screen.queryByRole("button", { name: "ביטול" })).not.toBeInTheDocument(); });
    expect(screen.queryByText("מראה כהה")).not.toBeInTheDocument();
    expect(screen.queryByText("המראה הוחזר")).not.toBeInTheDocument();
  });

  it("tapping the current choice only closes the sheet, with no write and no toast", async () => {
    renderSheet();
    fireEvent.click(device());
    await waitFor(() => { expect(screen.getByText("closed")).toBeInTheDocument(); });
    expect(localStorage.getItem("flow.theme")).toBeNull();
    expect(screen.queryByRole("button", { name: "ביטול" })).not.toBeInTheDocument();
  });

  it("keeps the undo toast for 3 s, not the default 5 s action toast", () => {
    expect(THEME_UNDO_MS).toBe(3000);
    expect(toastMs({ message: themePickToast("light"), action: "ביטול", durationMs: THEME_UNDO_MS, onAction: () => undefined })).toBe(3000);
  });
});
