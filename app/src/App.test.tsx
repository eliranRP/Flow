import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { HELP_EMAIL } from "./config";
import { getSupabase } from "./lib/supabase";

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
    expect(screen.getByText("שלום")).toBeInTheDocument();
    expect(screen.getByText("עוד אין נתונים")).toBeInTheDocument();
    expect(screen.getByText("מעלים דוח Excel מאפליקציית פועלים, ובונים ממנו רווח והפסד תוך דקה.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "חיבור SUMIT" })).toHaveAttribute("href", "/settings?preview=1");
    expect(screen.getByText("מצב תצוגה")).toBeInTheDocument();
    expect(screen.queryByText("נתוני דוגמה · Example data")).not.toBeInTheDocument();
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "ניווט ראשי" });
    const tabs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label") ?? link.textContent.trim());
    expect(tabs).toEqual(["בית", "פרויקטים", "הוספה", "לאישור", "הגדרות"]);
  });

  it("shows the offline error from preview=error, without the ui-band", () => {
    renderAt("/?preview=error");
    expect(screen.getByText("אין חיבור לאינטרנט")).toBeInTheDocument();
    expect(screen.getByText("בדקו את החיבור ונסו שוב. שום דבר לא נמחק.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toHaveClass("ui-btn-pill", "ui-btn-retry");
    expect(document.querySelector(".ui-band")).toBeNull();
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
  });

  it("shows the server load error from preview=error-server", () => {
    renderAt("/?preview=error-server");
    expect(screen.getByText("לא הצלחנו לטעון את הנתונים")).toBeInTheDocument();
    expect(screen.getByText("נסו שוב בעוד רגע")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toHaveClass("ui-btn-pill", "ui-btn-retry");
    expect(document.querySelector(".ui-band")).toBeNull();
  });

  it("shows the ld-01 loading skeleton from preview=loading", () => {
    renderAt("/?preview=loading");
    expect(screen.getByText("טוען…")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "פרויקטים מובילים" })).toBeInTheDocument();
    expect(document.querySelector(".ui-band")).not.toBeNull();
    expect(screen.getByText("מצב תצוגה")).toBeInTheDocument();
    expect(document.querySelectorAll(".ui-project-list .ui-row")).toHaveLength(3);
  });

  it("opens Add as a sheet over Home and keeps the tab bar", async () => {
    renderAt("/add?preview=1");
    const dialog = screen.getByRole("dialog", { name: "הוספה" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("בקרוב תוכלו להוסיף כאן הכנסה או הוצאה")).toBeInTheDocument();
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
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute("aria-label", "הוספה");
    });
  });

  it("closes the add sheet back to the screen that opened it", async () => {
    renderAt("/projects?preview=1");
    fireEvent.click(screen.getByRole("link", { name: "הוספה" }));
    expect(await screen.findByRole("dialog", { name: "הוספה" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "פרויקטים", hidden: true })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "הוספה" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "פרויקטים" })).toBeInTheDocument();
  });

  it("opens the review change sheet over the review ui-page", () => {
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

  it("shows the project empty state when there are no transactions", () => {
    renderAt("/projects/1?preview=1");
    expect(screen.getByText("אין עדיין תנועות")).toBeInTheDocument();
    expect(screen.getByText("חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "צילום חשבונית" })).toBeInTheDocument();
  });

  it("offers sign-in help only after a failed attempt", () => {
    renderAt("/sign-in?error=popup_closed");
    expect(screen.queryByRole("link", { name: "צריך עזרה בכניסה?" })).not.toBeInTheDocument();
  });

  it("links a failed sign-in to help", () => {
    renderAt("/sign-in?error=server_error");
    expect(screen.getByRole("link", { name: "צריך עזרה בכניסה?" })).toHaveAttribute("href", "/help");
  });

  it("shows help as a title, one line, and a mailto", () => {
    renderAt("/help");
    expect(screen.getByRole("heading", { name: "עזרה" })).toBeInTheDocument();
    expect(screen.getByText("לעזרה בכניסה כותבים לנו.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: HELP_EMAIL })).toHaveAttribute("href", `mailto:${HELP_EMAIL}`);
    const back = screen.getByRole("link", { name: "חזרה" });
    expect(back).toHaveClass("ui-text-link");
    expect(back).not.toHaveClass("ui-icon-btn");
    expect(back.closest(".ui-page-pad")).not.toBeNull();
    expect(screen.getByRole("link", { name: HELP_EMAIL }).closest(".ui-page-pad")).not.toBeNull();
  });

  it("sends a signed-out visitor to sign-in", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "כניסה או הרשמה" })).toBeInTheDocument();
    expect(screen.getByText("הרווח וההפסד של העסק, בלי אקסלים")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "תנאי שימוש" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "מדיניות פרטיות" })).toBeInTheDocument();
    const google = screen.getByRole("button", { name: "המשך עם Google" });
    if (getSupabase()) expect(google).toBeEnabled();
    else expect(google).toBeDisabled();
  });
});
