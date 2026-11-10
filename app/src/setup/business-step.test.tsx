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

/** The one onDone call: the run's start stamped (both fields, an ISO time) and the company it is for. */
function expectRunStarted(companyId: string) {
  const call = onDone.mock.calls[0] as [{ run_started_at?: string; flow_at?: string } | undefined, string | undefined] | undefined;
  expect(call?.[0]?.run_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(call?.[0]?.flow_at).toBe(call?.[0]?.run_started_at);
  expect(call?.[1]).toBe(companyId);
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

describe("setup step 1 · a setting refused after create_company", () => {
  function refusedBasisOnce() {
    return mockRpc((name, nth) => {
      if (name === "create_company") return { data: "company-1", error: null };
      if (name === "set_cash_basis" && nth === 1) return { data: null, error: { message: "refused" } };
      return ok;
    });
  }

  it("retries the follow-up settings for the company already created, without a second create", async () => {
    const calls = refusedBasisOnce();
    const button = show(null);
    fireEvent.click(button);
    expect(await screen.findByText(SAVE_ERROR)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expectRunStarted("company-1");
    expect(count(calls, "create_company")).toBe(1);
    expect(count(calls, "apply_starter_categories")).toBe(2);
  });

  it("renames the company on the retry when the name was edited after the create", async () => {
    const calls = refusedBasisOnce();
    const button = show(null);
    fireEvent.click(button);
    expect(await screen.findByText(SAVE_ERROR)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "שם העסק" }), { target: { value: "עסק אחר" } });
    fireEvent.click(button);
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(count(calls, "rename_company")).toBe(1);
    expect(count(calls, "create_company")).toBe(1);
  });

  it("keeps the same retry once the route has the company id", async () => {
    const calls = refusedBasisOnce();
    const initial = { name: "עסק לדוגמה", currency: "ILS" as const, basis: "paid" as const };
    const view = renderWithProviders(
      <StepBusiness companyId={null} initial={initial} onDone={onDone} onStamp={() => undefined} onSkipStep={() => undefined} onSkipAll={() => undefined} />,
      { route: "/setup/1?new=1" },
    );
    const button = screen.getByRole("button", { name: "המשך" });
    fireEvent.click(button);
    expect(await screen.findByText(SAVE_ERROR)).toBeInTheDocument();
    view.rerender(
      <StepBusiness companyId="company-1" initial={initial} onDone={onDone} onStamp={() => undefined} onSkipStep={() => undefined} onSkipAll={() => undefined} />,
    );
    fireEvent.click(button);
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expectRunStarted("company-1");
    expect(count(calls, "create_company")).toBe(1);
    expect(count(calls, "apply_starter_categories")).toBe(2);
  });
});

describe("setup step 1 · the other controls while it saves", () => {
  it("disables דילוג על הכל while create_company runs, so skip-all cannot create a second company", async () => {
    vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
      rpc: () => new Promise(() => undefined),
    } as never);
    const button = show(null);
    const skipAll = screen.getByRole("button", { name: "דילוג על הכל" });
    expect(skipAll).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => { expect(skipAll).toBeDisabled(); });
  });
});
