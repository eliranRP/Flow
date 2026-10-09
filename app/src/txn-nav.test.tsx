import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { resetScrollToWarning } from "./ui/back";
import { dropTxnEnter, readTxnList, TxnAnnouncer, TxnStepRow, txnListState, useAnnounceTxn, useTxnNav, useTxnNavKeys } from "./txn-nav";

function Card() {
  const { transactionId = "" } = useParams();
  const nav = useTxnNav(transactionId);
  useTxnNavKeys(nav);
  useAnnounceTxn(nav, `ספק ${transactionId}`);
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <h1>{transactionId}</h1>
      <p data-testid="path">{`${location.pathname}${location.search}`}</p>
      {nav ? <TxnStepRow nav={nav} /> : null}
      <input aria-label="שדה" />
      <div contentEditable="true" data-testid="note" />
      <button type="button" onClick={() => { void navigate(-1); }}>back</button>
      {nav ? <button type="button" onClick={() => { nav.move("prev", "swipe"); }}>swipe left</button> : null}
      <p data-testid="enter">{nav?.enter ?? "none"}</p>
    </div>
  );
}

function renderCard(id: string, state?: unknown, search = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/list", { pathname: `/transactions/${id}`, search, state }]} initialIndex={1}>
        <TxnAnnouncer>
          <Routes>
            <Route path="/list" element={<p data-testid="path">/list</p>} />
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

  it("hands every row of a short list the same array instead of a copy each", () => {
    const ids = ["a", "b", "c"];
    expect(txnListState(ids, "a", "/x").txnList.ids).toBe(ids);
    expect(txnListState(ids, "c", "/x").txnList.ids).toBe(ids);
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
    renderCard("a", { txnList: { ids: ["a", "b", "c", "d"], from: "/x" } });
    fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
    fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/c");
    expect(screen.getByRole("button", { name: "התנועה הבאה" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("תנועה 3 מתוך 4. ספק c");
    fireEvent.click(screen.getByRole("button", { name: "התנועה הקודמת" }));
    fireEvent.click(screen.getByRole("button", { name: "התנועה הקודמת" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/a");
  });

  it("hides the word at a list end but keeps its box, so the counter stays centred (FLOW-345)", () => {
    renderCard("c", list);
    expect(screen.queryByRole("button", { name: "התנועה הבאה" })).not.toBeInTheDocument();
    const next = screen.getByText("הבאה");
    expect(next.tagName).toBe("BUTTON");
    expect(next).toHaveStyle({ visibility: "hidden" });
    expect(next).not.toBeDisabled();
    expect(next).not.toHaveAttribute("aria-disabled");
    const row = screen.getByRole("group", { name: "מעבר בין תנועות" });
    expect(row.children).toHaveLength(3);
    expect(row).toHaveTextContent("הקודמת3 מתוך 3הבאה");
    expect(screen.getByRole("button", { name: "התנועה הקודמת" })).toBeVisible();
  });

  it("shows the words, not arrows, with the place in the list between them (FLOW-345)", () => {
    renderCard("b", list);
    const row = screen.getByRole("group", { name: "מעבר בין תנועות" });
    expect(row.querySelector("svg")).toBeNull();
    expect(screen.getByRole("button", { name: "התנועה הקודמת" })).toHaveTextContent(/^הקודמת$/);
    expect(screen.getByRole("button", { name: "התנועה הבאה" })).toHaveTextContent(/^הבאה$/);
    expect(row).toHaveTextContent("2 מתוך 3");
    // Start of the row (the right in RTL) is הקודמת, the end is הבאה.
    expect(row.firstElementChild).toHaveTextContent("הקודמת");
    expect(row.lastElementChild).toHaveTextContent("הבאה");
  });

  it("at the end it reached, focus waits on the counter instead of a hidden word (FLOW-345)", () => {
    renderCard("b", list);
    fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/c");
    expect(document.querySelector(".ui-txn-step-count")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "התנועה הקודמת" }));
    expect(screen.getByRole("button", { name: "התנועה הקודמת" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "התנועה הקודמת" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/a");
    expect(document.querySelector(".ui-txn-step-count")).toHaveFocus();
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

  it("a swipe moves like the buttons, announces, and says which side the card enters from (FLOW-314)", () => {
    renderCard("b", list);
    expect(screen.getByTestId("enter")).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "swipe left" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/a");
    expect(screen.getByTestId("enter")).toHaveTextContent("prev");
    expect(screen.getByRole("status")).toHaveTextContent("תנועה 1 מתוך 3. ספק a");
    // A button move clears it, so the next card does not slide in.
    fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
    expect(screen.getByTestId("enter")).toHaveTextContent("none");
  });

  it("drops the slide-in from the browser entry once played, so Back or a reload shows the card in place (FLOW-314)", () => {
    const list2 = { txnList: { ids: ["a", "b"], from: "/list" } };
    window.history.replaceState({ usr: { ...list2, txnVia: "swipe", txnEnter: "next" }, key: "k1", idx: 2 }, "");
    dropTxnEnter();
    expect(window.history.state).toEqual({ usr: { ...list2, txnVia: "swipe" }, key: "k1", idx: 2 });
    // An entry with no slide-in, or no router state, is left as it is.
    window.history.replaceState({ flowLayer: "sheet" }, "");
    dropTxnEnter();
    expect(window.history.state).toEqual({ flowLayer: "sheet" });
    window.history.replaceState(null, "");
  });

  it("replaces the card's entry and keeps the query, so Back pops straight to the list", () => {
    renderCard("a", list, "?preview=1");
    fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
    fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/c?preview=1");
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/list");
  });

  it("starts the next card at the top of the page", () => {
    resetScrollToWarning();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    try {
      renderCard("b", list);
      fireEvent.click(screen.getByRole("button", { name: "התנועה הבאה" }));
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
    } finally {
      scrollTo.mockRestore();
    }
  });

  it("claims the arrow key it handles", () => {
    renderCard("b", list);
    expect(fireEvent.keyDown(window, { key: "ArrowLeft" })).toBe(false);
  });

  it("leaves the arrow keys alone with ctrl, meta, or shift, in an editable box, or once handled", () => {
    renderCard("b", list);
    fireEvent.keyDown(window, { key: "ArrowLeft", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(screen.getByTestId("note"), { key: "ArrowLeft" });
    function claim(event: KeyboardEvent) {
      event.preventDefault();
    }
    document.addEventListener("keydown", claim, true);
    try {
      fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    } finally {
      document.removeEventListener("keydown", claim, true);
    }
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/b");
  });

  it("does not move while a dialog is on screen", () => {
    renderCard("b", list);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    try {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
    } finally {
      dialog.remove();
    }
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/b");
  });

  it("does not move while a sheet layer is open", () => {
    renderCard("b", { ...list, flowLayer: "txn-change", flowLayers: ["txn-change"] });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/b");
  });
});

describe("a held arrow key", () => {
  it("moves one card, not one per repeat", () => {
    renderCard("a", list);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft", repeat: true });
    expect(screen.getByTestId("path")).toHaveTextContent("/transactions/b");
  });
});
