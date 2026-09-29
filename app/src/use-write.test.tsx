import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./ui/toast";
import { changeSaveFailure } from "./ui/change-sheet";
import { useWrite } from "./use-write";

vi.mock("./use-books", () => ({
  useInvalidateBooks: () => async () => undefined,
}));

function Save({
  run,
  failure,
  onSplit,
}: {
  run: () => Promise<void>;
  failure: typeof changeSaveFailure | string;
  onSplit?: () => void;
}) {
  const save = useWrite({ keys: [], failure, run, onSplit });
  return <button type="button" onClick={() => { save.mutate(); }}>שמירה</button>;
}

function renderSave(
  run: () => Promise<void>,
  failure: typeof changeSaveFailure | string = changeSaveFailure,
  onSplit?: () => void,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Save run={run} failure={failure} onSplit={onSplit} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("useWrite", () => {
  it("offers לחלוקה, not a retry, when the database refuses a shared cost", async () => {
    const onSplit = vi.fn();
    renderSave(async () => {
      throw new Error("shared costs are split, not assigned to one project");
    }, changeSaveFailure, onSplit);
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("עלות משותפת מחולקת במסך החלוקה.")).toBeInTheDocument();
    expect(document.querySelector(".ui-toast-bad")).toBeNull();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "לחלוקה" }));
    expect(onSplit).toHaveBeenCalledOnce();
  });

  it("offers a retry when the network fails", async () => {
    renderSave(async () => {
      throw new Error("Failed to fetch");
    });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.getByText("לא נשמר – אין חיבור")).toBeInTheDocument();
  });

  it("does not offer a retry when the client is missing", async () => {
    renderSave(async () => {
      throw new Error("supabase");
    }, "לא הצלחנו ליצור את הקטגוריה.");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("לא הצלחנו ליצור את הקטגוריה.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });

  it("offers a retry for a server error", async () => {
    renderSave(async () => {
      throw new Error("Internal Server Error");
    }, "לא הצלחנו ליצור את הקטגוריה.");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
  });

  it("does not offer a retry for another deterministic refusal", async () => {
    renderSave(async () => {
      throw new Error("category kind must match the direction");
    });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(screen.getByText("לא נשמר. בדקו את הפרטים ונסו שוב.")).toBeInTheDocument();
    });
    expect(screen.queryByText("לא נשמר – אין חיבור")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });
});
