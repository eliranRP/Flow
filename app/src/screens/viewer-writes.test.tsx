import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { ReviewRow } from "@flow/shared";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { CategoriesScreen, ReviewQueue, SettingsScreen } from "./flow-screens";

const reviewRow: ReviewRow = {
  id: "r1",
  transaction_id: "t1",
  description: "חשבונית",
  doc_date: "2026-09-21",
  amount_net: -10_000n,
  direction: "expense",
  reason: null,
  project_id: "p1",
  category_id: "c1",
  supplier_name: "אלפא",
  project_name: "פרויקט א",
  category_name: "חומרים",
  project_suggested: true,
  category_suggested: true,
};

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

describe("viewer write controls", () => {
  it("keeps approve on the queue for an owner", () => {
    renderScreen(<ReviewQueue rows={[reviewRow]} search="" sample />);
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "שינוי" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "דלג" })).toBeInTheDocument();
  });

  it("hides review writes and category edits", () => {
    renderScreen(
      <ViewerPreview>
        <ReviewQueue rows={[reviewRow]} search="" sample />
      </ViewerPreview>,
    );
    expect(screen.queryByRole("button", { name: "אישור" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "שינוי" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "דלג" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /פרויקט:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /קטגוריה:/ })).not.toBeInTheDocument();
    expect(screen.getByText("פרויקט א")).toBeInTheDocument();
  });

  it("hides a new category and the row menu", () => {
    renderScreen(
      <ViewerPreview>
        <CategoriesScreen
          sample={[{ id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, count: 1 }]}
        />
      </ViewerPreview>,
    );
    expect(screen.getByText("חומרים")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "קטגוריה חדשה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /עוד, חומרים/ })).not.toBeInTheDocument();
  });

  it("disables settings writes and connect", () => {
    renderScreen(
      <ViewerPreview>
        <SettingsScreen
          sample={{
            name: "אלפא",
            connected: false,
            companyId: null,
            lastError: null,
            email: "dana@example.com",
            assistant: { state: "empty" },
            jev: { enabled: false, mode: "shadow", threshold: 0.9, status: "ready" },
          }}
        />
      </ViewerPreview>,
    );
    expect(screen.getByText("SUMIT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /SUMIT/ })).not.toBeInTheDocument();
    expect(screen.getByText("עוזר AI")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /עוזר AI/ })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "רווח אחרי כלליות" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "תיוג חכם (Jev)" })).toBeDisabled();
  });
});
