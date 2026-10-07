import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { CategoriesScreen } from "./flow-screens";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  failPnl: false,
  holdPnl: null as Promise<void> | null,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      if (name === "list_categories") {
        return Promise.resolve({
          data: [
            { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: false },
            { id: "c2", name: "פיקדונות", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: true },
            { id: "c3", name: "תשלומי הלוואה", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: true },
            { id: "c4", name: "ריבית משכנתא", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: false },
            { id: "c5", name: "תקבול", kind: "income", hidden: false, is_default: true, excluded_from_pnl: false },
          ],
          error: null,
        });
      }
      if (name === "set_category_excluded_from_pnl" && rpc.holdPnl) {
        return rpc.holdPnl.then(() => ({ data: null, error: null }));
      }
      if (name === "set_category_excluded_from_pnl" && rpc.failPnl) {
        return Promise.resolve({ data: null, error: { message: "category not found", code: "P0001" } });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

function renderScreen(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter>{node}</MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function pnlCalls() {
  return rpc.calls.filter((call) => call.name === "set_category_excluded_from_pnl").map((call) => call.args);
}

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.failPnl = false;
  rpc.holdPnl = null;
});

describe("categories kept out of the P&L", () => {
  it("marks kept-out rows and shows the legend", async () => {
    renderScreen(<CategoriesScreen />);
    await screen.findByText("חומרים");
    expect(screen.getAllByRole("img", { name: "מחוץ לרווח והפסד" })).toHaveLength(2);
    expect(screen.getByText("פיקדונות").className).not.toContain("ui-row-title-muted");
    expect(screen.getByText("מחוץ לרווח והפסד", { selector: "p" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "הכנסות" }));
    expect(screen.queryByRole("img", { name: "מחוץ לרווח והפסד" })).not.toBeInTheDocument();
    expect(screen.queryByText("מחוץ לרווח והפסד", { selector: "p" })).not.toBeInTheDocument();
  });

  it("keeps a category out on tap, and ביטול puts it back", async () => {
    renderScreen(<CategoriesScreen />);
    const more = await screen.findByRole("button", { name: "עוד, חומרים" });
    fireEvent.click(more);
    const sheet = await screen.findByRole("dialog", { name: "חומרים" });
    expect(within(sheet).getByText("הכסף נשאר בתזרים, ולא נספר כהכנסה או הוצאה.")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "מחוץ לרווח והפסד" }));

    await waitFor(() => {
      expect(pnlCalls()).toEqual([{ p_id: "c1", p_excluded: true }]);
    });
    expect(await screen.findByText("חומרים · מחוץ לרווח והפסד")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "חומרים" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "עוד, חומרים" })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(pnlCalls()).toEqual([
        { p_id: "c1", p_excluded: true },
        { p_id: "c1", p_excluded: false },
      ]);
    });
    expect(await screen.findByText("חומרים · ברווח והפסד")).toBeInTheDocument();
  });

  it("brings a kept-out category back into the P&L", async () => {
    renderScreen(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "עוד, פיקדונות" }));
    const sheet = await screen.findByRole("dialog", { name: "פיקדונות" });
    fireEvent.click(within(sheet).getByRole("button", { name: "החזרה לרווח והפסד" }));
    await waitFor(() => {
      expect(pnlCalls()).toEqual([{ p_id: "c2", p_excluded: false }]);
    });
  });

  it("shows a fixed line instead of the button on loan categories", async () => {
    renderScreen(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "עוד, תשלומי הלוואה" }));
    let sheet = await screen.findByRole("dialog", { name: "תשלומי הלוואה" });
    expect(within(sheet).getByText("קטגוריית הלוואה · תמיד מחוץ לרווח והפסד")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /רווח והפסד/ })).not.toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "תשלומי הלוואה" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "עוד, ריבית משכנתא" }));
    sheet = await screen.findByRole("dialog", { name: "ריבית משכנתא" });
    expect(within(sheet).getByText("חלק מתשלום הלוואה · תמיד ברווח והפסד")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /רווח והפסד/ })).not.toBeInTheDocument();
  });

  it("keeps the sheet open and says so when the save fails", async () => {
    rpc.failPnl = true;
    renderScreen(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "עוד, חומרים" }));
    const sheet = await screen.findByRole("dialog", { name: "חומרים" });
    fireEvent.click(within(sheet).getByRole("button", { name: "מחוץ לרווח והפסד" }));
    expect(await screen.findByText("לא הצלחנו לעדכן את הקטגוריה.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "חומרים" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "מחוץ לרווח והפסד" })).toBeEnabled();
  });

  it("waits for the save when the sheet is dismissed mid-write", async () => {
    let release: () => void = () => undefined;
    rpc.holdPnl = new Promise<void>((resolve) => { release = resolve; });
    renderScreen(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "עוד, חומרים" }));
    const sheet = await screen.findByRole("dialog", { name: "חומרים" });
    const action = within(sheet).getByRole("button", { name: "מחוץ לרווח והפסד" });
    expect(action).toHaveAccessibleDescription("הכסף נשאר בתזרים, ולא נספר כהכנסה או הוצאה.");
    fireEvent.click(action);
    expect(await within(sheet).findByText("מעדכן…")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "הסתרה" })).toBeDisabled();
    fireEvent.keyDown(sheet, { key: "Escape" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("dialog", { name: "חומרים" })).toBeInTheDocument();
    release();
    expect(await screen.findByText("חומרים · מחוץ לרווח והפסד")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "חומרים" })).not.toBeInTheDocument();
    });
  });

  it("shows the mark to a viewer, with no row menu", () => {
    renderScreen(
      <ViewerPreview>
        <CategoriesScreen
          sample={[{ id: "c2", name: "פיקדונות", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: true, count: 3 }]}
        />
      </ViewerPreview>,
    );
    expect(screen.getByRole("img", { name: "מחוץ לרווח והפסד" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /עוד, פיקדונות/ })).not.toBeInTheDocument();
  });
});
