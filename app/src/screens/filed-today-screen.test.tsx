import { filedTodaySchema, type FiledTodayRow } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { FiledTodayScreen } from "./filed-today-screen";

const row: FiledTodayRow = {
  id: "t-ils",
  description: "מלט",
  doc_date: "2026-09-29",
  amount_net: 350_000n,
  direction: "expense",
  supplier_name: "ספק לדוגמה",
  project_name: "פרויקט לדוגמה",
  category_name: "חומרים",
};

describe("FiledTodayScreen (FLOW-408)", () => {
  it("keeps the line's currency from the server", () => {
    const [parsed] = filedTodaySchema.array().parse([{ ...row, amount_net: 350_000, currency: "USD" }]);
    expect(parsed?.currency).toBe("USD");
  });

  it("shows a dollar line in dollars", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <FiledTodayScreen sample={[{ ...row, id: "t-usd", description: "USD line", supplier_name: "USD supplier", currency: "USD" }, row]} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const usdRow = screen.getByText("USD supplier").closest("a");
    expect(usdRow?.textContent).toContain("$");
    expect(usdRow?.textContent).not.toContain("₪");
    expect(screen.getByText("ספק לדוגמה").closest("a")?.textContent).toContain("₪");
  });
});
