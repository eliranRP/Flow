import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./ui/toast";
import { changeSaveFailure } from "./ui/change-sheet";
import { useWrite } from "./use-write";

vi.mock("./use-books", () => ({
  useInvalidateBooks: () => async () => undefined,
}));

function Save({ run, failure }: { run: () => Promise<void>; failure: typeof changeSaveFailure | string }) {
  const save = useWrite({ keys: [], failure, run });
  return <button type="button" onClick={() => { save.mutate(); }}>שמירה</button>;
}

function renderSave(run: () => Promise<void>, failure: typeof changeSaveFailure | string = changeSaveFailure) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Save run={run} failure={failure} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("useWrite", () => {
  it("does not offer a retry when the database refuses a shared cost", async () => {
    renderSave(async () => {
      throw new Error("shared costs are split, not assigned to one project");
    });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("עלות משותפת מחולקת במסך החלוקה.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });

  it("offers a retry when the network fails", async () => {
    renderSave(async () => {
      throw new Error("Failed to fetch");
    }, "לא נשמר – אין חיבור");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.getByText("לא נשמר – אין חיבור")).toBeInTheDocument();
  });

  it("does not offer a retry for another deterministic refusal", async () => {
    renderSave(async () => {
      throw new Error("category kind must match the direction");
    }, "לא נשמר – אין חיבור");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(screen.getByText("לא נשמר – אין חיבור")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });
});
