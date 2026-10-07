import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { readTxnList, TxnAnnouncer, TxnNavButtons, txnListState, useAnnounceTxn, useTxnNav, useTxnNavKeys } from "./txn-nav";

function Card() {
  const { transactionId = "" } = useParams();
  const nav = useTxnNav(transactionId);
  useTxnNavKeys(nav);
  useAnnounceTxn(nav, `ספק ${transactionId}`);
  const location = useLocation();
  return (
    <div>
      <h1>{transactionId}</h1>
      <p data-testid="path">{location.pathname}</p>
      {nav ? <TxnNavButtons nav={nav} /> : null}
      <input aria-label="שדה" />
    </div>
  );
}

function renderCard(id: string, state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: `/transactions/${id}`, state }]}>
        <TxnAnnouncer>
          <Routes>
            <Route path="/transactions/:transactionId" element={<Card />} />
          </Routes>
        </TxnAnnouncer>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const list = { txnList: { ids: ["a", "b", "c"], from: "/projects/p1" } };

describe("list state for a row link", () => {
  it("keeps a short list whole and in order", () => {
    expect(txnListState(["a", "b", "c"], "b", "/x")).toEqual({ txnList: { ids: ["a", "b", "c"], from: "/x" } });
  });

  it("sends a window around the opened row from a long list", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `t${String(i)}`);
    const { txnList } = txnListState(ids, "t600", "/x");
    expect(txnList.ids).toHaveLength(501);
    expect(txnList.ids[0]).toBe("t350");
    expect(txnList.ids[250]).toBe("t600");
    expect(txnList.ids.at(-1)).toBe("t850");
  });

  it("ignores a bad shape", () => {
    expect(readTxnList(null)).toBeNull();
    expect(readTxnList({ txnList: { ids: "a", from: "/x" } })).toBeNull();
    expect(readTxnList({ txnList: { ids: ["a", 1], from: "/x" } })).toBeNull();
    expect(readTxnList({ txnList: { ids: ["a"] } })).toBeNull();
  });
});

describe("prev and next on the card", () => {
  it("shows nothing for a deep link", () => {
    renderCard("b");
    expect(screen.queryByRole("group", { name: "מעבר בין תנועות" })).not.toBeInTheDocument();
  });

  it("shows nothing when the card is not in the list", () => {
    renderCard("z", list);
    expect(screen.queryByRole("button", { name: "התנועה הבאה" })).not.toBeInTheDocument();
  });

  it("shows nothing for a one-row list", () => {
    renderCard("a", { txnList: { ids: ["a"], from: "/x" } });
    expect(screen.queryByRole("button", { name: "התנועה הבאה" })).not.toBeInTheDocument();
  });

  it("moves down and up the list and keeps focus on the pressed button", () => {
    renderCard("b", list);
    fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/c");
    expect(screen.getByRole("button", { name: "התנועה הבאה" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("תנועה 3 מתוך 3. ספק c");
    fireEvent.click(screen.getByRole("button", { name: "התנועה הקודמת" }));
    fireEvent.click(screen.getByRole("button", { name: "התנועה הקודמת" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/a");
  });

  it("marks the ends unavailable and stays put on a tap there", () => {
    renderCard("c", list);
    const next = screen.getByRole("button", { name: "התנועה הבאה" });
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(next).toHaveAccessibleDescription("זו התנועה האחרונה ברשימה");
    fireEvent.click(next);
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/c");
    expect(screen.getByRole("button", { name: "התנועה הקודמת" })).not.toHaveAttribute("aria-disabled");
  });

  it("moves with the arrow keys the right-to-left way", () => {
    renderCard("b", list);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/c");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/b");
  });

  it("leaves the arrow keys alone in a field, with a modifier, or under a sheet", () => {
    renderCard("b", list);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "שדה" }), { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/b");
  });

  it("does not move while a sheet layer is open", () => {
    renderCard("b", { ...list, flowLayer: "txn-change", flowLayers: ["txn-change"] });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/b");
  });
});
