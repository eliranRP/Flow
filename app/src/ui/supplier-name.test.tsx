import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TransactionScreen } from "../screens/flow-screens";
import { UnpaidScreen } from "../screens/unpaid-screen";
import { BooksProvider } from "../use-books";
import { ChangeAssignment } from "./change-sheet";
import { ReviewCard } from "./review-card";
import { ToastProvider } from "./toast";

const longName = "א".repeat(30);

function wraps(node: Element) {
  const style = getComputedStyle(node);
  expect(style.overflowWrap).toBe("anywhere");
  expect(style.whiteSpace).not.toBe("nowrap");
}

describe("supplier names", () => {
  it("wraps a 30-letter review title, remember line, and transaction heading", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <BooksProvider>
          <MemoryRouter>
            <ReviewCard
              supplier={longName}
              sourceLine="חשבונית · 01/07/2026"
              netAgorot={-100n}
              vatLine="מע״מ ₪0"
            />
            <Remember supplier={longName} />
            <TransactionScreen
              sample={{
                id: "t-long",
                description: longName,
                direction: "expense",
                doc_date: "2026-07-01",
                amount_gross: -118n,
                amount_net: -100n,
                vat_amount: -18n,
                vat_status: "source",
                source: "sumit",
                pnl_role: "project",
                review_status: "approved",
                project_id: "p1",
                project_name: "פרויקט",
                category_id: "c1",
                category_name: "מלט",
                supplier_name: longName,
                customer_name: null,
                allocations: [],
              }}
            />
          </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const titles = screen.getAllByText(longName);
    expect(titles.length).toBeGreaterThanOrEqual(3);
    for (const title of titles) wraps(title);
    expect(titles.some((node) => node.classList.contains("ui-review-supplier"))).toBe(true);
    expect(titles.some((node) => node.classList.contains("ui-remember-supplier"))).toBe(true);
    expect(titles.some((node) => node.classList.contains("ui-party"))).toBe(true);
  });

  it("wraps a long customer name on the unpaid list up to two lines", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ToastProvider>
            <UnpaidScreen
              sample={[
                { id: "a", description: "חשבונית", doc_date: "2026-09-01", customer_name: longName, project_name: null, open_gross_agorot: 10_000n, open_net_agorot: 10_000n, document_url: null },
              ]}
            />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const title = screen.getByText(longName);
    expect(title.classList.contains("ui-row-title")).toBe(true);
    wraps(title);
    expect(getComputedStyle(title).webkitLineClamp).toBe("2");
  });

  it("keeps the review card name to three lines", () => {
    render(<ReviewCard supplier={longName} sourceLine="חשבונית · 01/07/2026" netAgorot={-100n} />);
    const title = screen.getByText(longName);
    wraps(title);
    expect(getComputedStyle(title).webkitLineClamp).toBe("3");
  });

  it("keeps the remember arrow's spaces outside its LTR bdi (FLOW-328)", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Remember supplier="חשמל לדוגמה" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const join = document.querySelector(".ui-remember-join");
    expect(join?.textContent).toBe("←");
    const dest = join?.closest(".ui-remember-dest");
    expect(dest?.textContent).toBe("←\u00A0\u2060פרויקט · מלט");
    // The summary values read at the row-title weight, like the transaction detail.
    for (const title of document.querySelectorAll(".ui-change-summary .ui-row-title")) {
      expect(getComputedStyle(title).fontWeight).toBe("var(--type-meta-weight)");
    }
    expect(document.querySelectorAll(".ui-change-summary .ui-row-title").length).toBeGreaterThan(0);
  });
});

function Remember({ supplier }: { supplier: string }) {
  const [projectId, setProjectId] = useState("p1");
  const [categoryId, setCategoryId] = useState("c1");
  const [remember, setRemember] = useState(true);
  return (
    <ChangeAssignment
      host="overlay"
      open
      onOpenChange={() => undefined}
      supplier={supplier}
      amount="₪1"
      direction="expense"
      projects={[{ id: "p1", name: "פרויקט" }]}
      categories={[{ id: "c1", name: "מלט" }]}
      projectId={projectId}
      categoryId={categoryId}
      onProjectId={setProjectId}
      onCategoryId={setCategoryId}
      remember={remember}
      onRemember={setRemember}
      onCommitPick={() => Promise.resolve(undefined)}
      onSplit={() => undefined}
      onCreateProject={(name) => Promise.resolve({ id: "new", name })}
    />
  );
}
