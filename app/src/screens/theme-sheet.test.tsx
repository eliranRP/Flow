// FLOW-372: Settings › מראה. A pick applies at once, closes the sheet and shows the undo toast;
// ביטול restores the previous choice; the choice is saved on this device only.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readThemeChoice, writeThemeChoice, type ThemeChoice } from "../theme-store";
import { toastMs } from "../ui/toast-layout";
import { ToastProvider } from "../ui/toast";
import { THEME_SAVED, THEME_UNDO_MS, THEME_UNDONE, ThemeSheet } from "./theme-sheet";

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
    expect(screen.getByText("רק בטלפון הזה")).toBeInTheDocument();
    expect(screen.getByText("עובר בין בהיר לכהה יחד עם הטלפון")).toBeInTheDocument();
    expect(screen.getByText("רקע לבן, נוח באור יום")).toBeInTheDocument();
    expect(screen.getByText("רקע כהה, נוח בערב ובחושך")).toBeInTheDocument();
    expect(device()).toHaveAttribute("aria-checked", "true");
  });

  it("applies a pick at once, saves it on this device, closes the sheet and shows the undo toast", async () => {
    renderSheet();
    fireEvent.click(light());
    await screen.findByText(THEME_SAVED);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("flow.theme")).toBe("light");
    expect(screen.getByText("closed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ביטול" })).toBeInTheDocument();
  });

  it("ביטול restores the previous choice and says so", async () => {
    renderSheet();
    fireEvent.click(dark());
    await screen.findByText(THEME_SAVED);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await screen.findByText(THEME_UNDONE);
    await waitFor(() => { expect(document.documentElement.hasAttribute("data-theme")).toBe(false); });
    expect(localStorage.getItem("flow.theme")).toBe("system");
  });

  it("tapping the current choice only closes the sheet, with no write and no toast", async () => {
    renderSheet();
    fireEvent.click(device());
    await waitFor(() => { expect(screen.getByText("closed")).toBeInTheDocument(); });
    expect(localStorage.getItem("flow.theme")).toBeNull();
    expect(screen.queryByText(THEME_SAVED)).not.toBeInTheDocument();
  });

  it("keeps the undo toast for 3 s, not the default 5 s action toast", () => {
    expect(THEME_UNDO_MS).toBe(3000);
    expect(toastMs({ message: THEME_SAVED, action: "ביטול", durationMs: THEME_UNDO_MS, onAction: () => undefined })).toBe(3000);
  });
});
