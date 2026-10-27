import type { ProjectWaitingRow, ReviewRow } from "@flow/shared";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { FiledTodayScreen } from "./filed-today-screen";
import { ProjectWaitingList, ReviewAllList, reviewAllSubtitle } from "./review-lists";

/** FLOW-971 (Review lists v2): the lists' heads, states and one filled button. Invented data. */

const row = (id: string, overrides: Partial<ReviewRow> = {}): ReviewRow => ({
  id,
  transaction_id: `t-${id}`,
  description: `Line ${id}`,
  doc_date: "2026-10-11",
  amount_net: -124_000n,
  direction: "expense",
  reason: "suggested",
  project_id: "p1",
  project_name: "פרויקט לדוגמה",
  category_id: "c1",
  category_name: "חומרים",
  supplier_name: `ספק ${id}`,
  ...overrides,
});

const waiting: ProjectWaitingRow = {
  review_id: null,
  transaction_id: "w1",
  description: "חשבונית 1",
  doc_date: "2026-10-05",
  amount_net: 100_000n,
  direction: "expense",
  reason: null,
  project_id: "p1",
  category_id: null,
  category_name: "חומרים",
  supplier_name: "ספק לדוגמה",
};

describe("Review lists v2 (FLOW-971)", () => {
  it("says the count and what is missing", () => {
    expect(reviewAllSubtitle(6, 1)).toBe("6 פריטים · 1 בלי פרויקט");
    expect(reviewAllSubtitle(1, 0)).toBe("פריט אחד");
  });

  it("puts the items under day heads with each day's signed total, and marks a line with no project", () => {
    renderWithProviders(
      <ReviewAllList
        rows={[row("a"), row("b", { doc_date: "2026-10-10", project_id: null, project_name: null }), row("c", { doc_date: "2026-10-10", amount_net: 50_000n, direction: "income" })]}
        search=""
        backTo="/review"
        now={new Date("2026-10-11T09:00:00Z")}
      />,
    );
    expect(screen.getByText("3 פריטים · 1 בלי פרויקט")).toBeInTheDocument();
    const heads = screen.getAllByRole("heading", { level: 2 }).map((head) => head.textContent);
    expect(heads).toEqual(["היום • 11/10", "אתמול • 10/10"]);
    const yesterday = screen.getByRole("region", { name: "אתמול • 10/10" });
    expect(yesterday.querySelector(".ui-review-group-meta")).toHaveTextContent("−₪740");
    const missing = screen.getByRole("link", { name: /ספק b/ });
    expect(missing.querySelector(".ui-review-all-missing")).toHaveTextContent("חסר פרויקט · חומרים");
    expect(screen.getByRole("link", { name: /לאישור הפריט הראשון/ })).toHaveTextContent("כדקה לכולם");
  });

  it("keeps the page on a failed read, with נסו שוב and the way to help", () => {
    const retry = vi.fn();
    renderWithProviders(<ReviewAllList rows={[]} search="" backTo="/review" state={{ failed: { offline: false, onRetry: retry } }} />);
    expect(screen.getByRole("heading", { name: "כל הפריטים לאישור" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "הפריטים לאישור לא נטענו" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("an empty list says so on the page, with one way on", () => {
    renderWithProviders(<ReviewAllList rows={[]} search="" backTo="/review" />);
    expect(screen.getByRole("heading", { name: "אין פריטים לאישור" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "לבית" })).toHaveAttribute("href", "/");
  });

  it("offline, says which moment the list is from", () => {
    renderWithProviders(<ReviewAllList rows={[row("a")]} search="" backTo="/review" state={{ offlineSince: Date.UTC(2026, 9, 11, 6, 41) }} />);
    expect(document.querySelector(".ui-page-offline")).toHaveTextContent("אין חיבור · מוצג המצב מ־09:41");
  });

  it("a project's waiting list names the project, its total, and opens the first line", () => {
    renderWithProviders(
      <ProjectWaitingList rows={[waiting, { ...waiting, transaction_id: "w2", amount_net: 50_000n }]} search="" backTo="/projects/p1" backText="פרויקט לדוגמה" projectName="פרויקט לדוגמה" />,
    );
    expect(screen.getByText("פרויקט לדוגמה · 2 הוצאות מחכות")).toBeInTheDocument();
    expect(document.querySelector(".ui-review-list-take")).toHaveTextContent("−₪1,500");
    expect(screen.getByRole("link", { name: /לאישור 2 הפריטים/ })).toHaveAttribute("href", "/transactions/w1");
    expect(screen.getByRole("group", { name: "אוקטובר" })).toHaveTextContent("2 תנועות");
  });

  it("שויכו היום says the day's count and that each can change; empty, it leads back to לאישור", () => {
    const { unmount } = renderWithProviders(
      <FiledTodayScreen sample={[{ id: "f1", description: "מלט", doc_date: "2026-10-11", amount_net: -350_000n, direction: "expense", supplier_name: "ספק", project_name: "פרויקט", category_name: "חומרים" }]} />,
    );
    expect(screen.getByText("שורה אחת שויכה היום · אפשר לשנות אותה")).toBeInTheDocument();
    unmount();
    renderWithProviders(<FiledTodayScreen sample={[]} />);
    expect(screen.getByRole("heading", { name: "עוד לא שויך כלום היום" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ללאישור" })).toHaveAttribute("href", "/review");
  });
});
