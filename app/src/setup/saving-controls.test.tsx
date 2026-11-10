import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as supabaseModule from "../lib/supabase";
import { renderWithProviders } from "../test-render";
import { BACK, NEXT, SKIP_ALL, SKIP_STEP, projectsPrimary, PROJECT_ADD, PROJECT_PLACEHOLDER } from "./copy";

/** FLOW-1161: while a step saves, הקודם, דילוג על הכל and דילוג על השלב are disabled. */

const hold = vi.fn<() => Promise<void>>();
vi.mock("../screens/jev-settings", async (original) => ({
  ...await original<typeof import("../screens/jev-settings")>(),
  saveJevIntegration: () => hold(),
}));

const { StepJev, StepProjects } = await import("./steps");

afterEach(() => {
  vi.restoreAllMocks();
  hold.mockReset();
});

function expectSaveControlsLocked() {
  expect(screen.getByRole("button", { name: BACK })).toBeDisabled();
  expect(screen.getByRole("button", { name: SKIP_ALL })).toBeDisabled();
  expect(screen.getByRole("button", { name: SKIP_STEP })).toBeDisabled();
}

describe("setup steps 3 and 5 · skip and back while saving", () => {
  it("step 5 locks the controls while the Jev save runs", () => {
    hold.mockReturnValue(new Promise<void>(() => undefined));
    renderWithProviders(
      <StepJev onDone={() => undefined} onStamp={() => undefined} onSkipStep={() => undefined} onSkipAll={() => undefined} onBack={() => undefined} />,
      { route: "/setup/5" },
    );
    expect(screen.getByRole("button", { name: BACK })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: NEXT }));
    expect(hold).toHaveBeenCalledOnce();
    expectSaveControlsLocked();
  });

  it("step 3 locks the controls while the project saves run", () => {
    const supabase = {
      rpc: (name: string) => (name === "upsert_project" ? new Promise(() => undefined) : Promise.resolve({ data: null, error: null })),
    };
    vi.spyOn(supabaseModule, "getSupabase").mockReturnValue(supabase as never);
    renderWithProviders(
      <StepProjects
        companyId="company-1"
        bankConnected={false}
        existingNames={[]}
        onDone={() => undefined}
        onStamp={() => undefined}
        onSkipStep={() => undefined}
        onSkipAll={() => undefined}
        onBack={() => undefined}
      />,
      { route: "/setup/3" },
    );
    fireEvent.change(screen.getByRole("textbox", { name: PROJECT_PLACEHOLDER }), { target: { value: "פרויקט לדוגמה" } });
    fireEvent.click(screen.getByRole("button", { name: PROJECT_ADD }));
    fireEvent.click(screen.getByRole("button", { name: projectsPrimary(1) }));
    expectSaveControlsLocked();
  });
});
