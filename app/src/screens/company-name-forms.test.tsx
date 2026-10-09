import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as supabaseModule from "../lib/supabase";
import { StepBusiness } from "../setup/steps";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { OnboardingScreen } from "./flow-screens";
import { RENAME_CONTROL_CHAR, RENAME_TOO_LONG, RENAME_TOO_SHORT } from "./rename-company";

/** FLOW-606: the business step and onboarding check the create_company rule on the field. */

type Call = { name: string; args: unknown };

function mockRpc() {
  const calls: Call[] = [];
  vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve({ data: name === "create_company" ? "company-1" : null, error: null });
    },
  } as never);
  return calls;
}

function wrap(node: ReactNode, entry = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function onboarding(initialName?: string) {
  return wrap(
    <Routes>
      <Route path="/onboarding" element={<OnboardingScreen initialName={initialName} />} />
      <Route path="/" element={<h1>בית</h1>} />
    </Routes>,
    "/onboarding",
  );
}

function field(): HTMLInputElement {
  return screen.getByLabelText("שם העסק");
}

function creates(calls: Call[]): Call[] {
  return calls.filter((call) => call.name === "create_company");
}

afterEach(() => {
  vi.restoreAllMocks();
});

const forms = [
  ["onboarding", (initialName?: string) => onboarding(initialName)],
  ["setup business step", (initialName?: string) => wrap(<StepBusiness userId={null} onDone={() => undefined} initialName={initialName} />)],
] as const;

describe.each(forms)("%s company name", (_label, show) => {
  it("refuses a pasted tab on the field and does not call create_company", () => {
    const calls = mockRpc();
    show();
    fireEvent.change(field(), { target: { value: "אלפא\tבטא" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(screen.getByText(RENAME_CONTROL_CHAR)).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveFocus();
    expect(creates(calls)).toHaveLength(0);
  });

  it("marks the field invalid before it takes focus, so it is announced with the message", () => {
    mockRpc();
    show();
    fireEvent.change(field(), { target: { value: "אלפא\tבטא" } });
    let invalidAtFocus: string | null = null;
    field().addEventListener("focus", () => { invalidAtFocus = field().getAttribute("aria-invalid"); });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(invalidAtFocus).toBe("true");
  });

  it("refuses a short or a long name, and a typed change clears the error", () => {
    const calls = mockRpc();
    show();
    fireEvent.change(field(), { target: { value: "  א  " } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(screen.getByText(RENAME_TOO_SHORT)).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: "א".repeat(101) } });
    expect(screen.queryByText(RENAME_TOO_SHORT)).not.toBeInTheDocument();
    fireEvent.blur(field());
    expect(screen.getByText(RENAME_TOO_LONG)).toBeInTheDocument();
    expect(creates(calls)).toHaveLength(0);
  });

  it("opens on a given name with its error", () => {
    mockRpc();
    show("אלפא\u0085");
    expect(field()).toHaveValue("אלפא\u0085");
    expect(screen.getByText(RENAME_CONTROL_CHAR)).toBeInTheDocument();
  });

  it("sends the trimmed name once it fits the rule", async () => {
    const calls = mockRpc();
    show();
    fireEvent.change(field(), { target: { value: "  סטודיו אלפא 　" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => {
      expect(creates(calls)).toEqual([{ name: "create_company", args: { p_name: "סטודיו אלפא", p_vat_registered: true } }]);
    });
    expect(screen.queryByText(RENAME_CONTROL_CHAR)).not.toBeInTheDocument();
  });

  it("describes the business type with its own hint and sends the exempt choice (FLOW-506)", async () => {
    const calls = mockRpc();
    show();
    const exempt = screen.getByRole("radio", { name: "עוסק פטור" });
    fireEvent.click(exempt);
    expect(screen.getByText("עוסק פטור: בלי מע״מ.")).toBeInTheDocument();
    expect(screen.queryByText("עוסק מורשה: מע״מ 18%.")).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "סוג העסק" })).toHaveAccessibleDescription("עוסק פטור: בלי מע״מ.");
    fireEvent.change(field(), { target: { value: "סטודיו אלפא" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => {
      expect(creates(calls)).toEqual([{ name: "create_company", args: { p_name: "סטודיו אלפא", p_vat_registered: false } }]);
    });
  });
});
