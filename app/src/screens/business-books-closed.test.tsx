import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as supabaseModule from "../lib/supabase";
import { readBooksClosedThrough } from "../books-closed";
import { renderWithProviders } from "../test-render";
import { ViewerPreview } from "../use-is-viewer";
import { BusinessScreen } from "./business-screen";
import type { SettingsSample } from "./settings-screen";

// FLOW-1166 part 2c (the owner's decision of 2026-11-12, "Show it, read-only"): the business page shows
// the closed date in one read-only row when one is set, and nothing when the books are open.

const business: SettingsSample = {
  name: "סטודיו אלפא",
  connected: true,
  companyId: 1,
  lastError: null,
  basis: "cash",
};

function mockCompanies(answer: { data: unknown; error: { message: string } | null }) {
  const calls: Array<{ table: string; columns: string; id: unknown }> = [];
  vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (_column: string, id: unknown) => ({
          maybeSingle: () => {
            calls.push({ table, columns, id });
            return Promise.resolve(answer);
          },
        }),
      }),
    }),
  } as never);
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the books-closed row on the business page (FLOW-1166)", () => {
  it("shows the closed date as dd/mm/yyyy, with no control", () => {
    renderWithProviders(<BusinessScreen sample={{ ...business, booksClosedThrough: "2026-03-31" }} />, { route: "/settings/business" });
    expect(screen.getByText("הספרים סגורים עד")).toBeInTheDocument();
    expect(screen.getByText("31/03/2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /הספרים סגורים/ })).not.toBeInTheDocument();
  });

  it("shows nothing when no date is set", () => {
    renderWithProviders(<BusinessScreen sample={business} />, { route: "/settings/business" });
    expect(screen.queryByText("הספרים סגורים עד")).not.toBeInTheDocument();
  });

  it("shows the same row to a viewer", () => {
    renderWithProviders(
      <ViewerPreview>
        <BusinessScreen sample={{ ...business, booksClosedThrough: "2026-03-31" }} />
      </ViewerPreview>,
      { route: "/settings/business" },
    );
    expect(screen.getByText("31/03/2026")).toBeInTheDocument();
  });

  it("reads companies.books_closed_through of the company on screen", async () => {
    const calls = mockCompanies({ data: { books_closed_through: "2026-03-31" }, error: null });
    await expect(readBooksClosedThrough("company-a")).resolves.toBe("2026-03-31");
    expect(calls).toEqual([{ table: "companies", columns: "books_closed_through", id: "company-a" }]);
  });

  it("reads open books, an odd value and a missing row as no date, and fails on an error", async () => {
    mockCompanies({ data: { books_closed_through: null }, error: null });
    await expect(readBooksClosedThrough("company-a")).resolves.toBeNull();
    vi.restoreAllMocks();
    mockCompanies({ data: { books_closed_through: "31/03/2026" }, error: null });
    await expect(readBooksClosedThrough("company-a")).resolves.toBeNull();
    vi.restoreAllMocks();
    mockCompanies({ data: null, error: null });
    await expect(readBooksClosedThrough("company-a")).resolves.toBeNull();
    vi.restoreAllMocks();
    mockCompanies({ data: null, error: { message: "permission denied" } });
    await expect(readBooksClosedThrough("company-a")).rejects.toThrow("permission denied");
  });
});
