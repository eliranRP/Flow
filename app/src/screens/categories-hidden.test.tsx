import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { CategoriesScreen } from "./flow-screens";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
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

  it("saves unhide through set_category_hidden", async () => {
    rpc.calls.length = 0;
    renderScreen(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /מוסתרות/ }));
    fireEvent.click(await screen.findByRole("button", { name: "עוד, עבודה" }));
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
