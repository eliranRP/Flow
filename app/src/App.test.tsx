import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";
import { HELP_EMAIL } from "./config";
import { getSupabase } from "./lib/supabase";
import { preloadScreens } from "./screen-loaders";

// FLOW-804: screens load on demand. With every screen (and the dev fixtures) fetched first, a
// few ticks settle a route.
beforeAll(async () => {
  await Promise.all([preloadScreens(), import("./dev-routes")]);
}, 60_000);

async function settle(): Promise<void> {
  for (let tick = 0; tick < 3; tick += 1) await act(async () => {});
}

async function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await settle();
  return view;
}

describe("App", () => {
  it("shows the first-run Home in preview, without a fake profit", async () => {
    await renderAt("/?preview=1");
    expect(screen.getByRole("heading", { name: "כאן יופיע הרווח של העסק" })).toBeInTheDocument();
    expect(screen.queryByText("שלום")).not.toBeInTheDocument();
    expect(screen.queryByText("Flow")).not.toBeInTheDocument();
    expect(screen.getByText("עוד אין נתונים")).toBeInTheDocument();
    expect(screen.getByText("הרווח יופיע כאן אחרי חיבור בנק או SUMIT.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "חיבור בנק או SUMIT" })).toHaveAttribute("href", "/settings/connections?preview=1");
    expect(screen.getByText("מצב תצוגה")).toBeInTheDocument();
    expect(screen.queryByText("נתוני דוגמה · Example data")).not.toBeInTheDocument();
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "ניווט ראשי" });
    const tabs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label") ?? link.textContent.trim());
    expect(tabs).toEqual(["בית", "פרויקטים", "הוספה", "לאישור", "הגדרות"]);
  });

  it("shows the offline error from preview=error, without the ui-band", async () => {
    await renderAt("/?preview=error");
    expect(screen.getByText("אין חיבור לאינטרנט")).toBeInTheDocument();
    expect(screen.getByText("בדקו את החיבור ונסו שוב. שום דבר לא נמחק.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toHaveClass("ui-btn-pill");
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).not.toHaveClass("ui-btn-retry");
    expect(document.querySelector(".ui-band")).toBeNull();
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
  });

  it("shows the server load error from preview=error-server", async () => {
    await renderAt("/?preview=error-server");
    expect(screen.getByText("לא הצלחנו לטעון את הנתונים")).toBeInTheDocument();
    expect(screen.getByText("נסו שוב בעוד רגע")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toHaveClass("ui-btn-pill");
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).not.toHaveClass("ui-btn-retry");
    expect(document.querySelector(".ui-band")).toBeNull();
  });

  it("sizes the project loading band to the loaded project lines", async () => {
    await renderAt("/projects/a?preview=loading");
    expect(document.querySelector(".ui-project-skel")).not.toBeNull();
    expect(document.querySelector(".ui-skel-project-title")).not.toBeNull();
    expect(document.querySelector(".ui-skel-project-period")).not.toBeNull();
    expect(document.querySelector(".ui-skel-project-label")).not.toBeNull();
    expect(document.querySelector(".ui-skel-project-num")).not.toBeNull();
    // FLOW-359: the loaded band ends at the figure, so the skeleton draws no figure pair under it.
    expect(document.querySelector(".ui-project-skel .ui-band-figures")).toBeNull();
    expect(document.querySelector(".ui-hero")).toBeNull();
  });

  it("shows the ld-01 loading skeleton from preview=loading", async () => {
    await renderAt("/?preview=loading");
    expect(screen.getByText("טוען…")).toBeInTheDocument();
    // FLOW-413: Home is the month's cash, so it loads as the band, three rows and the earlier months.
    expect(screen.getByRole("heading", { name: "חודשים קודמים" })).toBeInTheDocument();
    expect(document.querySelector(".ui-band")).not.toBeNull();
    expect(screen.getByText("מצב תצוגה")).toBeInTheDocument();
    expect(document.querySelectorAll(".ui-flow .ui-flow-line")).toHaveLength(6);
    expect(document.querySelector(".ui-project-skel")).toBeNull();
    expect(document.querySelector(".ui-band .ui-hero")).not.toBeNull();
    expect(document.querySelector(".ui-flow")).not.toBeNull();
    expect(screen.queryByText("Flow")).not.toBeInTheDocument();
  });

  it("opens Add as a sheet over Home and keeps the tab bar", async () => {
    await renderAt("/add?preview=1");
    const dialog = screen.getByRole("dialog", { name: "הוספה" });
    expect(dialog).toBeInTheDocument();
    // FLOW-331: quick actions that work today, all enabled, and no "coming later" line.
    for (const name of ["פרויקט חדש", "הלוואה חדשה", "חיבור בנק"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeEnabled();
    }
    expect(screen.queryByText(/צילום חשבונית/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "כאן יופיע הרווח של העסק", hidden: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "ניווט ראשי", hidden: true })).toBeInTheDocument();
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("opens the project sheet from + → פרויקט חדש, and Back does not reopen +", async () => {
    await renderAt("/add?preview=1");
    fireEvent.click(screen.getByRole("button", { name: /פרויקט חדש/ }));
    expect(await screen.findByRole("dialog", { name: "פרויקט" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "הוספה" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "פרויקטים", hidden: true })).toBeInTheDocument();
  });

  it("opens the project sheet again on a second + → פרויקט חדש from Projects", async () => {
    await renderAt("/projects?preview=1");
    for (let round = 0; round < 2; round += 1) {
      fireEvent.click(within(screen.getByRole("navigation", { name: "ניווט ראשי" })).getByRole("link", { name: "הוספה" }));
      fireEvent.click(await screen.findByRole("button", { name: /פרויקט חדש/ }));
      const dialog = await screen.findByRole("dialog", { name: "פרויקט" });
      fireEvent.click(within(dialog).getByRole("button", { name: "ביטול" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "פרויקט" })).not.toBeInTheDocument();
      });
    }
  });

  it("opens the new-loan sheet from + → הלוואה חדשה", async () => {
    await renderAt("/add?preview=1");
    fireEvent.click(screen.getByRole("button", { name: /הלוואה חדשה/ }));
    expect(await screen.findByRole("dialog", { name: "הלוואה" })).toBeInTheDocument();
  });

  it("opens the bank sheet on Connections from + → חיבור בנק", async () => {
    await renderAt("/add?preview=1");
    fireEvent.click(screen.getByRole("button", { name: /חיבור בנק/ }));
    expect(await screen.findByRole("heading", { name: "חיבורים", hidden: true })).toBeInTheDocument();
  });

  it("closes the add sheet on Escape after the exit animation", async () => {
    await renderAt("/add?preview=1");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "הוספה" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "כאן יופיע הרווח של העסק" })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute("aria-label", "הוספה");
    });
  });

  it("closes the add sheet back to the screen that opened it", async () => {
    await renderAt("/projects?preview=1");
    fireEvent.click(screen.getByRole("link", { name: "הוספה" }));
    expect(await screen.findByRole("dialog", { name: "הוספה" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "פרויקטים", hidden: true })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "כאן יופיע הרווח של העסק" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "הוספה" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "פרויקטים" })).toBeInTheDocument();
  });

  it("opens the review change sheet over the review ui-page", async () => {
    await renderAt("/review/change?preview=1");
    expect(screen.getByRole("dialog", { name: "שינוי שיוך" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "לאישור", hidden: true })).toBeInTheDocument();
  });

  it("leaves the tab bar off transaction detail", async () => {
    await renderAt("/transactions/1?preview=1");
    expect(screen.getByRole("heading", { name: "פרטי תנועה" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "ניווט ראשי" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "חזרה לבית" })).not.toBeInTheDocument();
  });

  it("shows the project empty state when there are no transactions", async () => {
    await renderAt("/projects/1?preview=1");
    expect(screen.getByText("אין עדיין תנועות")).toBeInTheDocument();
    expect(screen.getByText("חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן.")).toBeInTheDocument();
    // FLOW-331: no capture button until capture ships.
    expect(screen.queryByRole("link", { name: "צילום חשבונית" })).not.toBeInTheDocument();
  });

  it("offers sign-in help only after a failed attempt", async () => {
    await renderAt("/sign-in?error=popup_closed");
    expect(screen.queryByRole("link", { name: "צריך עזרה בכניסה?" })).not.toBeInTheDocument();
  });

  it("links a failed sign-in to help", async () => {
    await renderAt("/sign-in?error=server_error");
    expect(screen.getByRole("link", { name: "צריך עזרה בכניסה?" })).toHaveAttribute("href", "/help");
  });

  it("shows help as a title, one line, and a mailto", async () => {
    await renderAt("/help");
    expect(screen.getByRole("heading", { name: "עזרה" })).toBeInTheDocument();
    expect(screen.getByText("לעזרה בכניסה כותבים לנו.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: HELP_EMAIL })).toHaveAttribute("href", `mailto:${HELP_EMAIL}`);
    // FLOW-326: the shared Back chevron in the header bar, not a text link.
    const back = screen.getByRole("button", { name: "חזרה" });
    expect(back).toHaveClass("ui-icon-btn");
    expect(back).not.toHaveClass("ui-text-link");
    expect(back.closest(".ui-page-title-row")).not.toBeNull();
    expect(screen.getByRole("link", { name: HELP_EMAIL }).closest(".ui-page-pad")).not.toBeNull();
  });

  it("replaces a direct install visit so Back does not return to it", async () => {
    window.history.replaceState({}, "", "/help");
    window.history.pushState({}, "", "/install?preview=1");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>,
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/settings");
    });
    window.history.back();
    await waitFor(() => {
      expect(window.location.pathname).not.toBe("/install");
    });
    window.history.replaceState({}, "", "/");
  });

  it("routes Settings to the Connections and Loans pages under the הגדרות tab (FLOW-501)", async () => {
    const settings = await renderAt("/settings?preview=1");
    expect(screen.getByRole("link", { name: "חיבורים" })).toHaveAttribute("href", "/settings/connections?preview=1");
    expect(screen.getByRole("link", { name: "הלוואות" })).toHaveAttribute("href", "/settings/loans?preview=1");
    expect(screen.queryByRole("button", { name: "SUMIT" })).not.toBeInTheDocument();
    settings.unmount();

    const connections = await renderAt("/settings/connections?preview=1");
    expect(await screen.findByRole("heading", { name: "חיבורים" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SUMIT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mercury" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ספרים ובנק" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "עזרים" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "ניווט ראשי" });
    expect(within(nav).getByRole("link", { name: "הגדרות" })).toHaveAttribute("aria-current", "page");
    connections.unmount();

    await renderAt("/settings/loans?preview=1");
    expect(await screen.findByRole("heading", { name: "הלוואות" })).toBeInTheDocument();
    expect(screen.getByText("משכנתא אלון")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הלוואה חדשה" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "ניווט ראשי" })).getByRole("link", { name: "הגדרות" })).toHaveAttribute("aria-current", "page");
  });

  it("moves an old Settings sheet link to the Connections page with the sheet open", async () => {
    await renderAt("/settings?preview=1&sheet=sumit");
    expect(await screen.findByRole("dialog", { name: "חיבור SUMIT" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "חיבורים", hidden: true })).toBeInTheDocument();
  });

  it("sends Loans with no company back to Settings", async () => {
    await renderAt("/settings/loans?preview=empty");
    expect(await screen.findByRole("heading", { name: "הגדרות" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "הלוואות" })).not.toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign-in", async () => {
    await renderAt("/");
    expect(await screen.findByRole("heading", { name: "כניסה או הרשמה" })).toBeInTheDocument();
    expect(screen.getByText("הרווח וההפסד של העסק, בלי אקסלים")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "תנאי שימוש" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "מדיניות פרטיות" })).toBeInTheDocument();
    const google = screen.getByRole("button", { name: "המשך עם Google" });
    if (getSupabase()) expect(google).toBeEnabled();
    else expect(google).toBeDisabled();
  });
});
