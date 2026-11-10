import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as supabaseModule from "../lib/supabase";
import { renderWithProviders } from "../test-render";
import { SAVE_ERROR } from "./copy";
import { StepBusiness } from "./steps";

/** FLOW-1160: the business step's save is one machine, so every way it ends frees the button. */

type Answer = { data: unknown; error: { message: string } | null };

function mockRpc(answer: (name: string, nth: number) => Answer) {
  const calls: string[] = [];
  vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
    rpc: (name: string) => {
      calls.push(name);
      return Promise.resolve(answer(name, calls.filter((call) => call === name).length));
    },
  } as never);
  return calls;
}

const ok: Answer = { data: null, error: null };
const onDone = vi.fn();

function show(companyId: string | null) {
  renderWithProviders(
    <StepBusiness
      companyId={companyId}
      initial={{ name: "עסק לדוגמה", currency: "ILS", basis: "paid" }}
      onDone={onDone}
      onStamp={() => undefined}
      onSkipStep={() => undefined}
      onSkipAll={() => undefined}
    />,
    { route: "/setup/1" },
  );
  return screen.getByRole("button", { name: "המשך" });
}

function count(calls: string[], name: string): number {
  return calls.filter((call) => call === name).length;
}

afterEach(() => {
  vi.restoreAllMocks();
  onDone.mockReset();
});

describe("setup step 1 · the save", () => {
  it("frees the button when create_company is refused, so a second tap tries again", async () => {
    const calls = mockRpc((name, nth) => {
      if (name !== "create_company") return ok;
      return nth === 1 ? { data: null, error: { message: "refused" } } : { data: "company-1", error: null };
    });
    const button = show(null);
    fireEvent.click(button);
    await waitFor(() => { expect(count(calls, "create_company")).toBe(1); });
    await waitFor(() => { expect(button).not.toHaveAttribute("aria-busy", "true"); });
    fireEvent.click(button);
    await waitFor(() => { expect(count(calls, "create_company")).toBe(2); });
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
  });

  it("sends one create_company for two taps in a row", async () => {
    const calls = mockRpc((name) => (name === "create_company" ? { data: "company-1", error: null } : ok));
    const button = show(null);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(count(calls, "create_company")).toBe(1);
  });

  it("says the save failed when a first setting is refused, and saves on the next tap", async () => {
    const calls = mockRpc((name, nth) => (name === "set_cash_basis" && nth === 1 ? { data: null, error: { message: "refused" } } : ok));
    const button = show("company-1");
    fireEvent.click(screen.getByRole("radio", { name: /חשבונית/ }));
    fireEvent.click(button);
    expect(await screen.findByText(SAVE_ERROR)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(screen.queryByText(SAVE_ERROR)).toBeNull();
    expect(count(calls, "set_cash_basis")).toBe(2);
  });
});
