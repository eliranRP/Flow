import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CategoriesScreen } from "./flow-screens";
import { renderWithProviders } from "../test-render";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  /** A set_category_hidden answer the test holds back, so the row can be seen before the write answers. */
  hidden: null as Promise<{ data: unknown; error: { message: string } | null }> | null,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      if (name === "set_category_hidden" && rpc.hidden != null) return rpc.hidden;
      if (name === "list_categories") {
        return Promise.resolve({
          data: [
            { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true },
            { id: "c4", name: "עבודה", kind: "expense", hidden: true, is_default: true },
            { id: "c5", name: "תקבול", kind: "income", hidden: false, is_default: true },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const sample = [
  { id: "c1", name: "חומרים", kind: "expense" as const, hidden: false, is_default: true, count: 42 },
  { id: "c4", name: "עבודה", kind: "expense" as const, hidden: true, is_default: true, count: 1 },
  { id: "c5", name: "תקבול", kind: "income" as const, hidden: false, is_default: true, count: 3 },
];

function renderScreen(node: ReactNode) {
  return renderWithProviders(node);
}

describe("categories hidden footer", () => {
  it("keeps hidden categories out of the list until the segment link opens them", () => {
    renderScreen(<CategoriesScreen sample={sample} />);
    expect(screen.queryByText("סוג")).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "סוג" })).toBeInTheDocument();
    expect(screen.getByText("חומרים")).toBeInTheDocument();
    expect(screen.queryByText("עבודה")).not.toBeInTheDocument();
    expect(screen.queryByText("מוסתרת")).not.toBeInTheDocument();

    const hidden = screen.getByRole("button", { name: /מוסתרות/ });
    expect(hidden).toHaveAttribute("aria-expanded", "false");
    expect(hidden).toHaveAttribute("aria-controls", "categories-hidden");
    expect(hidden.querySelector(".ui-num")).toHaveTextContent("1");

    fireEvent.click(hidden);
    expect(screen.getByText("עבודה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /מוסתרות/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("עבודה").className).toContain("ui-row-title-muted");

    fireEvent.click(screen.getByRole("radio", { name: "הכנסות" }));
    expect(screen.queryByRole("button", { name: /מוסתרות/ })).not.toBeInTheDocument();
    expect(screen.queryByText("עבודה")).not.toBeInTheDocument();
  });

  it("opens a leaf category's sheet from its row (FLOW-513: the board has no ⋯)", async () => {
    renderScreen(<CategoriesScreen sample={sample} />);
    fireEvent.click(screen.getByRole("button", { name: /^חומרים/ }));
    expect(await screen.findByRole("dialog", { name: "חומרים" })).toBeInTheDocument();
  });

  it("saves unhide through set_category_hidden", async () => {
    rpc.calls.length = 0;
    renderScreen(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /מוסתרות/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^עבודה/ }));
    fireEvent.click(await screen.findByRole("button", { name: "החזרה לרשימה" }));
    fireEvent.click(await screen.findByRole("button", { name: "החזרה לרשימה" }));
    await waitFor(() => {
      expect(rpc.calls).toContainEqual({
        name: "set_category_hidden",
        args: { p_id: "c4", p_hidden: false },
      });
    });
  });
});

describe("categories hide at once (decision 0180)", () => {
  it("moves the row before set_category_hidden answers, and puts it back when the write fails", async () => {
    rpc.calls.length = 0;
    let answer: (result: { data: unknown; error: { message: string } | null }) => void = () => undefined;
    rpc.hidden = new Promise((resolve) => { answer = resolve; });
    renderScreen(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /מוסתרות/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^עבודה/ }));
    fireEvent.click(await screen.findByRole("button", { name: "החזרה לרשימה" }));
    fireEvent.click(await screen.findByRole("button", { name: "החזרה לרשימה" }));
    // The row is back in the list at once: no hidden categories are left, so the hidden footer is gone.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /מוסתרות/ })).not.toBeInTheDocument();
    });
    expect(screen.getByText("עבודה")).toBeInTheDocument();
    expect(rpc.calls).toContainEqual({ name: "set_category_hidden", args: { p_id: "c4", p_hidden: false } });
    answer({ data: null, error: { message: "Failed to fetch" } });
    // The failure puts the row back among the hidden ones, with the failure toast and ניסיון חוזר.
    expect(await screen.findByRole("button", { name: /מוסתרות/ })).toBeInTheDocument();
    expect(await screen.findByText("לא הצלחנו לעדכן את הקטגוריה.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    rpc.hidden = null;
  });
});

describe("categories focus return (FLOW-310)", () => {
  it("returns focus to קטגוריה חדשה after Escape on its sheet, with the ring marked", async () => {
    renderScreen(<CategoriesScreen sample={sample} />);
    fireEvent.click(screen.getByRole("button", { name: "קטגוריה חדשה" }));
    fireEvent.keyDown(await screen.findByRole("dialog", { name: "קטגוריה חדשה" }), { key: "Escape" });
    const opener = screen.getByRole("button", { name: "קטגוריה חדשה", hidden: true });
    await waitFor(() => { expect(opener).toHaveFocus(); });
    expect(opener).toHaveAttribute("data-focus-ring");
  });
});
