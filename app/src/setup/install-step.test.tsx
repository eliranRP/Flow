import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscribeOutcome } from "../push";
import { renderWithProviders } from "../test-render";
import { INSTALL_FINISH } from "./copy";

// FLOW-516: step 7's notifications switch says what happened when the turn-on stops.

const subscribe = vi.fn<() => Promise<SubscribeOutcome>>();
vi.mock("../push", async (original) => ({
  ...await original<typeof import("../push")>(),
  pushSupport: () => "ok",
  subscribeThisDevice: () => subscribe(),
}));

const { StepInstall } = await import("./steps");

const onDone = vi.fn();
function renderStep() {
  renderWithProviders(
    <StepInstall onDone={onDone} onStamp={() => undefined} onSkipStep={() => undefined} onSkipAll={() => undefined} onBack={() => undefined} initialMode="android-steps" />,
    { route: "/setup/7" },
  );
}

beforeEach(() => {
  subscribe.mockReset();
  onDone.mockReset();
});

describe("setup step 7 · notifications", () => {
  it("finishes once this device is subscribed", async () => {
    subscribe.mockResolvedValue({ result: "ok", step: "done" });
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: INSTALL_FINISH }));
    expect(subscribe).toHaveBeenCalledTimes(1);
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
  });

  it("stays and says why when the turn-on stops, then finishes on the next tap without asking again", async () => {
    subscribe.mockResolvedValue({ result: "subscribe-threw", step: "subscribe", detail: "AbortError: Registration failed" });
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: INSTALL_FINISH }));
    expect(await screen.findByText("המכשיר לא אישר את ההרשמה להתראות. אפשר לנסות שוב.")).toBeInTheDocument();
    expect(screen.getByText("שלב אחרון: הרשמה במכשיר (subscribe-threw · AbortError: Registration failed)")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: INSTALL_FINISH }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
