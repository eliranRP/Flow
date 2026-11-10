import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as supabaseModule from "../lib/supabase";
import { SAVE_ERROR, SKIP_SHEET_CONFIRM, SKIP_SHEET_TITLE } from "./copy";
import { emptyFacts } from "./model";
import { runSkipAll } from "./skip-all";
import { SkipSheet } from "./skip-sheet";

/** FLOW-1161: a skip-all that cannot create the business says so in the sheet and stays open. */

afterEach(() => { vi.restoreAllMocks(); });

function refuseCreateCompany() {
  vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
    rpc: () => Promise.resolve({ data: null, error: { message: "refused" } }),
  } as never);
}

describe("skip all · a failed create", () => {
  it("makes runSkipAll reject when create_company is refused, and navigates nowhere", async () => {
    refuseCreateCompany();
    const navigate = vi.fn();
    await expect(runSkipAll({
      userId: "user-1",
      facts: emptyFacts(true),
      navigate: navigate as never,
      client: new QueryClient(),
    })).rejects.toThrow();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("says the save failed in the sheet, and keeps the sheet open", async () => {
    refuseCreateCompany();
    const navigate = vi.fn();
    render(
      <SkipSheet
        open
        onOpenChange={() => undefined}
        onConfirm={() => runSkipAll({ userId: "user-1", facts: emptyFacts(true), navigate: navigate as never, client: new QueryClient() })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: SKIP_SHEET_CONFIRM }));
    expect(await screen.findByText(SAVE_ERROR)).toBeInTheDocument();
    expect(screen.getByText(SKIP_SHEET_TITLE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SKIP_SHEET_CONFIRM })).toBeEnabled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
