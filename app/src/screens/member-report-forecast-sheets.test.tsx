import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ForecastAssumptionsSheet } from "./member-report-forecast-sheets";

function renderSheet(onSave = vi.fn(() => Promise.resolve(true))) {
  const router = createMemoryRouter([{
    path: "/r",
    element: <ForecastAssumptionsSheet open onOpenChange={() => undefined} canEdit projection={undefined} onSave={onSave} costCategories={[]} />,
  }], { initialEntries: ["/r"] });
  render(<ToastProvider><RouterProvider router={router} /></ToastProvider>);
  return onSave;
}

describe("ForecastAssumptionsSheet (FLOW-1148)", () => {
  it("a bad value says so under its field once left, and שמירה stays enabled", async () => {
    const onSave = renderSheet();
    const sheet = within(await screen.findByRole("dialog", { name: "הנחות התחזית" }));
    const capex = sheet.getByLabelText("רזרבה ל־CapEx");
    fireEvent.change(capex, { target: { value: "abc" } });
    // Not while typing: only once the field is left.
    expect(capex).not.toHaveAttribute("aria-invalid");
    fireEvent.blur(capex);
    expect(capex).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(capex.getAttribute("aria-describedby") ?? "")).toHaveTextContent("ערך לא תקין");
    expect(sheet.getByRole("button", { name: "שמירה" })).toBeEnabled();
    fireEvent.change(capex, { target: { value: "6" } });
    expect(capex).not.toHaveAttribute("aria-invalid");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("שמירה with a bad year opens that series' years and moves the focus to the first bad field", async () => {
    const onSave = renderSheet();
    const sheet = within(await screen.findByRole("dialog", { name: "הנחות התחזית" }));
    const toggle = sheet.getByRole("button", { name: "ביטוח: שינוי שונה לשנה מסוימת" });
    fireEvent.click(toggle);
    fireEvent.change(sheet.getByLabelText("שנה 4"), { target: { value: "x" } });
    fireEvent.click(toggle);
    expect(sheet.queryByLabelText("שנה 4")).toBeNull();
    fireEvent.change(sheet.getByLabelText("ריבית (%)"), { target: { value: "y" } });
    fireEvent.click(sheet.getByRole("button", { name: "שמירה" }));
    expect(onSave).not.toHaveBeenCalled();
    const year = sheet.getByLabelText("שנה 4");
    expect(sheet.getByRole("button", { name: "ביטוח: שינוי שונה לשנה מסוימת · יש שנים שונות · ערך לא תקין" })).toHaveAttribute("aria-expanded", "true");
    expect(year).toHaveAttribute("aria-invalid", "true");
    expect(year).toHaveFocus();
    expect(sheet.getByLabelText("ריבית (%)")).toHaveAttribute("aria-invalid", "true");
  });
});
