import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeEdge, resetBackend } from "../screens/connection-page-test-backend";
import { renderWithProviders } from "../test-render";
import { StepConnect } from "./steps";

vi.mock("../lib/supabase", async () => (await import("../screens/connection-page-test-backend")).supabaseModule());
vi.mock("../edge", async () => (await import("../screens/connection-page-test-backend")).edgeModule());

afterEach(resetBackend);

const KEY = "sample-key-123";

function renderStep() {
  const onDone = vi.fn();
  renderWithProviders(
    <StepConnect mercuryConnected={false} sumitConnected={false} onDone={onDone} onStamp={() => undefined} onSkipStep={() => undefined} onSkipAll={() => undefined} onBack={() => undefined} />,
    { route: "/setup/2" },
  );
  return { onDone };
}

async function openSheet(name: "SUMIT" | "Mercury") {
  const row = screen.getAllByText(name).map((node) => node.closest<HTMLElement>(".ui-onb-conn")).find((found) => found != null);
  if (row == null) throw new Error("missing row");
  fireEvent.click(within(row).getByRole("button", { name: "חיבור" }));
  return screen.findByRole("dialog", { name: `חיבור ${name}` });
}

function fillSumit(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText("מספר חברה"), { target: { value: "1234567" } });
  fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: KEY } });
  fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
}

describe("setup step 2 connects through the shared hooks (FLOW-918)", () => {
  it("connects SUMIT, closes its sheet once, and keeps the step open", async () => {
    const { onDone } = renderStep();
    const dialog = await openSheet("SUMIT");
    fillSumit(dialog);
    expect(await screen.findByText("SUMIT מחובר. המפתח נשאר בשרת.")).toBeInTheDocument();
    expect(invokeEdge).toHaveBeenCalledOnce();
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ companyId: 1234567, apiKey: KEY, importFrom: undefined });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "חיבור SUMIT" })).not.toBeInTheDocument(); });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("keeps the sheet open with the typed SUMIT values on a failure, and the toast offers ניסיון חוזר", async () => {
    invokeEdge.mockRejectedValueOnce(new Error("failed to fetch"));
    renderStep();
    const dialog = await openSheet("SUMIT");
    fillSumit(dialog);
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר", hidden: true });
    expect(screen.getByRole("dialog", { name: "חיבור SUMIT" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("מספר חברה")).toHaveValue("1234567");
    expect(within(dialog).getByLabelText("מפתח API")).toHaveValue(KEY);
    fireEvent.click(retry);
    expect(await screen.findByText("SUMIT מחובר. המפתח נשאר בשרת.")).toBeInTheDocument();
    expect(invokeEdge).toHaveBeenCalledTimes(2);
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "חיבור SUMIT" })).not.toBeInTheDocument(); });
  });

  it("keeps the Mercury sheet open on a rejected key, with the key field cleared", async () => {
    invokeEdge.mockRejectedValueOnce(new Error("rejected"));
    const { onDone } = renderStep();
    const dialog = await openSheet("Mercury");
    const field = within(dialog).getByLabelText("מפתח API");
    fireEvent.change(field, { target: { value: "sample-token-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    expect(await screen.findByText("Mercury דחה את המפתח. צריך מפתח Read Only חדש.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "חיבור Mercury" })).toBeInTheDocument();
    expect(field).toHaveValue("");
    expect(onDone).not.toHaveBeenCalled();
  });
});
