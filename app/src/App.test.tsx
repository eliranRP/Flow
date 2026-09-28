import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App", () => {
  it("shows the first-run Home in preview, without a fake profit", () => {
    renderAt("/?preview=1");
    expect(screen.getByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק" })).toBeInTheDocument();
    expect(screen.getByText("שלום, …")).toBeInTheDocument();
    expect(screen.getByText("עוד אין נתונים")).toBeInTheDocument();
    expect(screen.getByText("הרווח יופיע כאן אחרי ש-SUMIT מחובר.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "חיבור SUMIT" })).toBeInTheDocument();
    expect(screen.getByText("מצב תצוגה")).toBeInTheDocument();
    expect(screen.queryByText("נתוני דוגמה · Example data")).not.toBeInTheDocument();
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "ניווט ראשי" });
    const tabs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label") ?? link.textContent.trim());
    expect(tabs).toEqual(["בית", "פרויקטים", "הוספה", "לאישור", "הגדרות"]);
  });

  it("shows the offline error from preview=error", () => {
    renderAt("/?preview=error");
    expect(screen.getByText("לא הצלחנו לטעון")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
  });

  it("shows the loading skeleton from preview=loading", () => {
    renderAt("/?preview=loading");
    expect(screen.getByText("טוען…")).toBeInTheDocument();
  });

  it("opens Add as a sheet over Home and keeps the tab bar", async () => {
    renderAt("/add?preview=1");
    const dialog = screen.getByRole("dialog", { name: "הוספה" });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק", hidden: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "ניווט ראשי", hidden: true })).toBeInTheDocument();
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("closes the add sheet on Escape after the exit animation", async () => {
    renderAt("/add?preview=1");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "הוספה" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק" })).toBeInTheDocument();
  });

  it("opens the review change sheet over the review page", () => {
    renderAt("/review/change?preview=1");
    expect(screen.getByRole("dialog", { name: "שינוי שיוך" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "לאישור", hidden: true })).toBeInTheDocument();
  });

  it("leaves the tab bar off transaction detail", () => {
    renderAt("/transactions/1?preview=1");
    expect(screen.getByRole("heading", { name: "פרטי תנועה" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "ניווט ראשי" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "חזרה לבית" })).not.toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign-in", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { name: "כניסה או הרשמה" })).toBeInTheDocument();
    expect(screen.getByText("הרווח וההפסד של העסק, בלי אקסלים")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "תנאי שימוש" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "מדיניות פרטיות" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "המשך עם Google" })).toBeDisabled();
  });
});
