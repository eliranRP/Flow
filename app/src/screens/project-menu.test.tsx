import type { ProjectDetail } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { ProjectDetailScreen } from "./flow-screens";
import type { ProjectInvestment } from "./project-investment-data";

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

const investment: ProjectInvestment = {
  isOverhead: false,
  figures: {
    currency: "ILS",
    purchaseMinor: 18_500_000n,
    arvMinor: null,
    valueMinor: null,
    valueDate: null,
    rehabMinor: 0n,
    rehabOther: [],
    loanMinor: 0n,
    loanOther: [],
    forcedEquityMinor: null,
    currentEquityMinor: null,
  },
  categories: [],
  loans: [],
};

function openMenu(withInvestment = false) {
  render(wrap(<ProjectDetailScreen sample={project} sampleGroups={groups} sampleInvestment={withInvestment ? investment : undefined} sampleMenuRow={{ id: "p1", deletable: true } as never} />));
  fireEvent.click(screen.getByRole("button", { name: "עוד" }));
  return screen.getByRole("dialog", { name: "פרויקט לדוגמה" });
}

describe("the project's ⋯ menu matches the board", () => {
  it("lists edit, השקעה והלוואות (a project with an investment figure) and finish, with the hint under each title", () => {
    const menu = openMenu(true);
    expect(within(menu).getByRole("button", { name: /^עריכת פרטים/ })).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: /^השקעה והלוואות/ })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: /^סיום הפרויקט/ })).toBeInTheDocument();
    expect(menu.querySelector(".ui-row-hint")).not.toBeNull();
  });

  it("hides the השקעה והלוואות row for a project with no investment data, and the edit sheet still opens the page", () => {
    const menu = openMenu();
    expect(within(menu).queryByRole("link", { name: /^השקעה והלוואות/ })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("button", { name: /^עריכת פרטים/ }));
    const edit = screen.getByRole("dialog", { name: "עריכת פרויקט" });
    expect(within(edit).getByRole("link", { name: /^נתוני השקעה/ })).toHaveAttribute("href", expect.stringMatching(/^\/projects\/p1\/investment/));
  });

  it("shows the השקעה והלוואות row for a project with a loan and no investment figure, opening the investment page", () => {
    const withLoan = { ...project, loans: [{ id: "l1", name: "הלוואת גישור", currency: "ILS", balance_minor: 80_000_000n, status: "open" }] };
    render(wrap(<ProjectDetailScreen sample={withLoan} sampleGroups={groups} sampleMenuRow={{ id: "p1", deletable: true } as never} />));
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    const menu = screen.getByRole("dialog", { name: "פרויקט לדוגמה" });
    expect(within(menu).getByRole("link", { name: /^השקעה והלוואות/ })).toHaveAttribute("href", expect.stringMatching(/^\/projects\/p1\/investment/));
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
