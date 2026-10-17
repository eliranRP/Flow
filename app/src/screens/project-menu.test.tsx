import type { ProjectDetail } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { ProjectDetailScreen } from "./flow-screens";

function wrap(children: React.ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <BooksProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={["/projects/p1"]}>{children}</MemoryRouter>
        </ToastProvider>
      </BooksProvider>
    </QueryClientProvider>
  );
}

const project: NonNullable<ProjectDetail> = {
  id: "p1",
  name: "פרויקט לדוגמה",
  status: "active",
  state_label: "פעיל",
  budget_agorot: null,
  income_agorot: 0n,
  direct_agorot: 0n,
  shared_agorot: 0n,
  profit_agorot: 0n,
  categories: [],
  pending_count: 0,
  pending_agorot: 0n,
  transactions: [],
};
const groups = { groups: [{ id: "g1", name: "בניין לדוגמה" }], currentId: "g1" };

function openMenu() {
  render(wrap(<ProjectDetailScreen sample={project} sampleGroups={groups} sampleMenuRow={{ id: "p1", deletable: true } as never} />));
  fireEvent.click(screen.getByRole("button", { name: "עוד" }));
  return screen.getByRole("dialog", { name: "פרויקט לדוגמה" });
}

describe("the project's ⋯ menu matches the board", () => {
  it("lists edit, השקעה והלוואות (even with no investment data) and finish, with the hint under each title", () => {
    const menu = openMenu();
    expect(within(menu).getByRole("button", { name: /^עריכת פרטים/ })).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: /^השקעה והלוואות/ })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: /^סיום הפרויקט/ })).toBeInTheDocument();
    expect(menu.querySelector(".ui-row-hint")).not.toBeNull();
  });

  it("has no add row, group row, overhead switch or ✕, and shows delete for a deletable project", () => {
    const menu = openMenu();
    expect(within(menu).queryByText("הוספה לפרויקט")).not.toBeInTheDocument();
    expect(within(menu).queryByRole("button", { name: /קבוצה/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(menu).queryByRole("button", { name: "סגירה" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: /^מחיקת הפרויקט/ })).toBeInTheDocument();
  });

  it("keeps the overhead switch and the group in the edit sheet", () => {
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole("button", { name: /^עריכת פרטים/ }));
    const edit = screen.getByRole("dialog", { name: "עריכת פרויקט" });
    expect(within(edit).getByRole("switch", { name: "רווח אחרי הוצאות כלליות" })).toBeInTheDocument();
    expect(within(edit).getByRole("button", { name: /קבוצה/ })).toHaveTextContent("בניין לדוגמה");
  });

  it("the finish confirm has no ✕ either", () => {
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole("button", { name: /^סיום הפרויקט/ }));
    const confirm = screen.getByRole("dialog", { name: /^לסיים את/ });
    expect(within(confirm).queryByRole("button", { name: "סגירה" })).not.toBeInTheDocument();
    expect(within(confirm).getByRole("button", { name: "ביטול" })).toBeInTheDocument();
  });
});
