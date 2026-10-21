import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { JEV_LABEL, NEXT } from "./copy";
import { buildDoneRows } from "./done";
import { emptyFacts } from "./model";
import { emptySetupStore } from "./storage";

// FLOW-940 (decision 0204): a new company starts with Jev on, auto, 90%. The setup's Jev step keeps
// that when the switch stays on, and the done card reads the stored row when the step did not save.

const save = vi.fn<(input: unknown) => Promise<void>>();
vi.mock("../screens/jev-settings", async (original) => ({
  ...await original<typeof import("../screens/jev-settings")>(),
  saveJevIntegration: (input: unknown) => save(input),
}));

const { StepJev } = await import("./steps");

const onDone = vi.fn();
function renderStep() {
  renderWithProviders(
    <StepJev onDone={onDone} onStamp={() => undefined} onSkipStep={() => undefined} onSkipAll={() => undefined} onBack={() => undefined} />,
    { route: "/setup/5" },
  );
}

beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue(undefined);
  onDone.mockReset();
});

describe("setup step 5 · Jev", () => {
  it("saves auto at 90% when the switch stays on", async () => {
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: NEXT }));
    await waitFor(() => { expect(onDone).toHaveBeenCalledWith({ jev_on: true }); });
    expect(save).toHaveBeenCalledWith({ enabled: true, mode: "auto", threshold: 0.9 });
  });

  it("saves off when the owner turns the switch off", async () => {
    renderStep();
    fireEvent.click(screen.getByRole("switch", { name: JEV_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: NEXT }));
    await waitFor(() => { expect(onDone).toHaveBeenCalledWith({ jev_on: false }); });
    expect(save).toHaveBeenCalledWith({ enabled: false, mode: "off", threshold: 0.9 });
  });
});

describe("done card · תיוג חכם", () => {
  const facts = (patch: Partial<ReturnType<typeof emptyFacts>>) => ({ ...emptyFacts(true), companyId: "c1", ...patch });
  const jevRow = (store: ReturnType<typeof emptySetupStore>, patch: Partial<ReturnType<typeof emptyFacts>>) =>
    buildDoneRows({ store, facts: facts(patch), businessName: "עסק", pendingLenders: 0 }).find((row) => row.label === "תיוג חכם");

  it("says פעיל from the stored row when the step was skipped", () => {
    const store = { ...emptySetupStore(), skipped: { ...emptySetupStore().skipped, "5": "2026-10-21T08:00:00.000Z" } };
    expect(jevRow(store, { jevSaved: true, jevOn: true })).toMatchObject({ value: "פעיל", done: true });
  });

  it("follows the step's own save over the stored row", () => {
    expect(jevRow({ ...emptySetupStore(), jev_on: false }, { jevSaved: true, jevOn: true })).toMatchObject({ value: "כבוי", done: false });
  });

  it("says כבוי for a company with no row", () => {
    expect(jevRow(emptySetupStore(), { jevSaved: false, jevOn: false })).toMatchObject({ value: "כבוי", done: false });
  });
});
