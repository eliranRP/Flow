import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ReviewEmpty } from "../screens/flow-screens";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { SetupSampleReview } from "./sample-review";
import { setupStorageKey } from "./storage";

const USER = "11111111-1111-1111-1111-111111111111";
const COMPANY = "company-1";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("../auth", () => ({
  useAuth: () => ({
    status: "authed",
    session: { user: { id: USER } },
  }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc,
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  }),
}));

const DASHBOARD = {
  company_id: COMPANY,
  name: "אלפא",
  vat_registered: true,
  basis: "cash",
  from: "2026-10-01",
  to: "2026-10-31",
  income_agorot: 0,
  direct_agorot: 0,
  shared_agorot: 0,
  overhead_agorot: 0,
  expense_agorot: 0,
  net_profit_agorot: 0,
  prev_income_agorot: null,
  prev_expense_agorot: null,
  prev_net_agorot: null,
  active_projects: 0,
  review_count: 0,
  projects: [],
};

function LocationProbe() {
  const location = useLocation();
  return <p>{location.pathname}</p>;
}

function Harness() {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }));
  return (
    <QueryClientProvider client={client}>
      <BooksProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={["/review?setup=1"]}>
            <LocationProbe />
            <SetupSampleReview
              backTo="/setup/4"
              continueTo="/setup/5"
              empty={<ReviewEmpty search="" />}
            />
          </MemoryRouter>
        </ToastProvider>
      </BooksProvider>
    </QueryClientProvider>
  );
}

describe("setup sample review", () => {
  it("approves the sample card without writing the books", async () => {
    localStorage.clear();
    rpc.mockImplementation((name: string) => {
      if (name === "approve_review_item" || name === "approve_split_review" || name === "resolve_review") {
        return Promise.reject(new Error("wrote books"));
      }
      if (name === "get_dashboard") return Promise.resolve({ data: DASHBOARD, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    render(<Harness />);
    expect(screen.getByText("נתוני דוגמה · Example data")).toBeInTheDocument();
    expect(screen.getByText("ספק לדוגמה בע״מ")).toBeInTheDocument();
    const approve = await screen.findByRole("button", { name: "אישור" });
    await waitFor(() => {
      expect(approve).toBeEnabled();
    });
    fireEvent.click(approve);
    expect(await screen.findByText("הכל מאושר")).toBeInTheDocument();
    expect(screen.getByText("אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "לדף הבית" })).toBeInTheDocument();
    const stored = localStorage.getItem(setupStorageKey(USER, COMPANY));
    expect(stored).toContain("sample_review_at");
    expect(rpc.mock.calls.some((call) => call[0] === "approve_review_item")).toBe(false);
    expect(await screen.findByText("אישור ראשון. אפשר להמשיך בהגדרה.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(screen.getByText("/setup/5")).toBeInTheDocument();
    localStorage.clear();
  });
});