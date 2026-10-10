import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { grownIds, resetTxnListMore, uniqueIds, useTxnListMore, type TxnMoreLoad } from "./txn-list-more";
import { TxnStepNav, usePrefetchNextPage, useTxnNav } from "./txn-nav";

function Card({ prefetch }: { prefetch: boolean }) {
  const { transactionId = "" } = useParams();
  const nav = useTxnNav(transactionId);
  usePrefetchNextPage(transactionId, prefetch);
  const location = useLocation();
  return (
    <div>
      <p data-testid="path">{location.pathname}</p>
      {nav ? <TxnStepNav nav={nav} /> : null}
    </div>
  );
}

function List({ more, load }: { more: boolean; load: TxnMoreLoad }) {
  useTxnListMore("/list", more, load);
  return null;
}

function KeyedCard({ prefetch }: { prefetch: boolean }) {
  const { transactionId = "" } = useParams();
  return <Card key={transactionId} prefetch={prefetch} />;
}

function renderWalk(id: string, load: TxnMoreLoad, { more = true, prefetch = false, total }: { more?: boolean; prefetch?: boolean; total?: number } = {}) {
  const txnList = total == null ? { ids: ["a", "b"], from: "/list" } : { ids: ["a", "b"], from: "/list", total };
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/transactions/${id}`, state: { txnList } }]}>
      <List more={more} load={load} />
      <Routes>
        <Route path="/transactions/:transactionId" element={<KeyedCard prefetch={prefetch} />} />
      </Routes>
    </MemoryRouter>,
  );
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  resetTxnListMore();
});

describe("the next page of a paged list on the card (FLOW-314)", () => {
  it("keeps הבאה at the last loaded row, loads the next page, stays put while busy, then moves", async () => {
    const page = deferred<{ ids: readonly string[]; more: boolean } | null>();
    const load = vi.fn(() => page.promise);
    renderWalk("b", load);
    const next = screen.getByRole("button", { name: "התנועה הבאה" });
    expect(next).not.toHaveClass("ui-txn-step-off");
    // More rows are coming and the screen sent no count: the place alone, never "2 מתוך 2".
    expect(screen.getByRole("group", { name: "מעבר בין תנועות" })).not.toHaveTextContent("מתוך");
    fireEvent.click(next);
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/b");
    expect(screen.getByRole("button", { name: "התנועה הבאה" })).toHaveAttribute("aria-busy", "true");
    // A second press while it loads waits on the same read.
    fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      page.resolve({ ids: ["a", "b", "c", "d"], more: false });
      await page.promise;
    });
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/c");
    expect(screen.getByRole("group", { name: "מעבר בין תנועות" })).toHaveTextContent(/3 מתוך 4/);
  });

  it("ends the walk when the next page brings nothing new", async () => {
    const load = vi.fn(() => Promise.resolve({ ids: ["a", "b"], more: false }));
    renderWalk("b", load);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
      await Promise.resolve();
    });
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/b");
    expect(screen.getByText("הבאה").closest("button")).toHaveClass("ui-txn-step-off");
  });

  it("stays put after a failed read, and הבאה can try again", async () => {
    const load = vi.fn<TxnMoreLoad>().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ids: ["a", "b", "c"], more: false });
    renderWalk("b", load);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
      await Promise.resolve();
    });
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/b");
    const next = screen.getByRole("button", { name: "התנועה הבאה" });
    expect(next).not.toHaveAttribute("aria-busy");
    await act(async () => {
      fireEvent.click(next);
      await Promise.resolve();
    });
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/c");
  });

  it("reads the next page ahead once the last loaded card is ready, so הבאה moves at once", async () => {
    const load = vi.fn(() => Promise.resolve({ ids: ["a", "b", "c"], more: false }));
    await act(async () => {
      renderWalk("b", load, { prefetch: true });
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/c");
  });

  it("counts against the total the screen sent while more rows are coming", () => {
    renderWalk("b", vi.fn(() => Promise.resolve(null)), { total: 7 });
    expect(screen.getByRole("group", { name: "מעבר בין תנועות" })).toHaveTextContent(/2 מתוך 7/);
  });

  it("does nothing at the end of a list with no next page", () => {
    const load = vi.fn(() => Promise.resolve(null));
    renderWalk("b", load, { more: false, prefetch: true });
    expect(screen.getByText("הבאה").closest("button")).toHaveClass("ui-txn-step-off");
    expect(load).not.toHaveBeenCalled();
  });
});

describe("list ids", () => {
  it("keeps each id once, at its first place", () => {
    expect(uniqueIds(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("appends only the ids the list did not send", () => {
    const ids = ["a", "b"];
    expect(grownIds(ids, [])).toBe(ids);
    expect(grownIds(ids, ["b", "c"])).toEqual(["a", "b", "c"]);
  });
});
