import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { attentionRows } from "./attention-rows";
import { TransfersScreen } from "./transfers-screen";
import { transfersSample } from "../dev/transfers-sample";
import { transferAccountName } from "../transfer-matches";
import { ToastProvider } from "../ui/toast";

// FLOW-941 (decision 0205): העברות לבדיקה. Home's row, the cards, and the live answers with ביטול.
const db = vi.hoisted(() => ({
  rpcs: [] as Array<{ name: string; args: unknown }>,
  fail: false,
  hold: false,
}));

vi.mock("../transfer-matches", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../transfer-matches")>();
  const { transfersSample: sample } = await import("../dev/transfers-sample");
  return {
    ...actual,
    useTransferMatchesQuery: () => useQuery({ queryKey: ["transfer-matches", "off"], queryFn: () => Promise.resolve(sample()) }),
  };
});

vi.mock("../use-is-viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-is-viewer")>()),
  useHoldWrites: () => db.hold,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: unknown) => {
      db.rpcs.push({ name, args });
      return Promise.resolve({ data: null, error: db.fail ? { message: "not a transfer pair" } : null });
    },
  }),
}));

function renderScreen(sample?: ReturnType<typeof transfersSample>) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ToastProvider>
          <TransfersScreen sample={sample} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Home's transfers row", () => {
  it("counts the suggestions, singular for one, and opens העברות לבדיקה", () => {
    const one = attentionRows({ pending: 0, transfers: 1, unpaidCount: 0, unpaidGross: 0n, search: "" });
    expect(one.map((row) => [row.id, row.to])).toEqual([["transfers", "/transfers"]]);
    expect(one[0]?.title).toBe("העברה אחת לבדיקה");
    expect(attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, search: "" })).toEqual([]);
    const two = attentionRows({ pending: 3, transfers: 2, unpaidCount: 0, unpaidGross: 0n, search: "?preview=1" });
    expect(two.map((row) => row.id)).toEqual(["review", "transfers"]);
    expect(two[1]?.to).toBe("/transfers?preview=1");
  });
});

describe("TransfersScreen", () => {
  it("names each account with its last 4", () => {
    const [match] = transfersSample();
    expect(match && transferAccountName(match.out)).toBe("Operations ••4821");
    expect(match && transferAccountName({ ...match.in, account_last4: null, account_name: null })).toBe("Mercury");
  });

  it("shows both lines of each pair with the question and the answers", async () => {
    db.hold = false;
    renderScreen(transfersSample());
    const cards = await screen.findAllByRole("region", { name: /העברה אפשרית/ });
    expect(cards).toHaveLength(2);
    const first = cards[0] as HTMLElement;
    expect(within(first).getByText("זו העברה בין החשבונות שלכם?")).toBeTruthy();
    expect(within(first).getByText("Operations ••4821")).toBeTruthy();
    expect(within(first).getByText("Main ••9034")).toBeTruthy();
    expect(within(first).getByText("יום אחד בין השורות")).toBeTruthy();
    expect(within(first).getByText("השם תואם")).toBeTruthy();
    expect(within(cards[1] as HTMLElement).getByText("באותו יום")).toBeTruthy();
  });

  it("an empty list says so", () => {
    renderScreen([]);
    expect(screen.getByText("אין העברות לבדיקה")).toBeTruthy();
  });

  it("confirms on the live path, and ביטול takes the answer back", async () => {
    db.rpcs = [];
    db.fail = false;
    db.hold = false;
    renderScreen();
    const [first] = await screen.findAllByRole("region", { name: /העברה אפשרית/ });
    fireEvent.click(within(first as HTMLElement).getByRole("button", { name: "כן, העברה" }));
    const toast = await screen.findByRole("status");
    expect(within(toast).getByText("סומן כהעברה")).toBeTruthy();
    expect(screen.getAllByRole("region", { name: /העברה אפשרית/ })).toHaveLength(1);
    expect(db.rpcs).toEqual([{ name: "answer_transfer_match", args: { p_out_transaction_id: "e2e-xfer-out-1", p_in_transaction_id: "e2e-xfer-in-1", p_same: true } }]);
    fireEvent.click(within(toast).getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(db.rpcs).toHaveLength(2); });
    expect(db.rpcs[1]).toEqual({ name: "answer_transfer_match", args: { p_out_transaction_id: "e2e-xfer-out-1", p_in_transaction_id: "e2e-xfer-in-1", p_same: null } });
    await waitFor(() => { expect(screen.getAllByRole("region", { name: /העברה אפשרית/ })).toHaveLength(2); });
  });

  it("a rejection says it will not be suggested again; a failed write puts the card back", async () => {
    db.rpcs = [];
    db.fail = false;
    db.hold = false;
    renderScreen();
    const cards = await screen.findAllByRole("region", { name: /העברה אפשרית/ });
    fireEvent.click(within(cards[1] as HTMLElement).getByRole("button", { name: "לא, צירוף מקרים" }));
    expect(within(await screen.findByRole("status")).getByText("לא נציע שוב")).toBeTruthy();
    expect((db.rpcs[0]?.args as { p_same: boolean }).p_same).toBe(false);
    db.fail = true;
    fireEvent.click(within(screen.getAllByRole("region", { name: /העברה אפשרית/ })[0] as HTMLElement).getByRole("button", { name: "כן, העברה" }));
    await waitFor(() => { expect(screen.getByText("לא הצלחנו לעדכן את השורות.")).toBeTruthy(); });
    expect(screen.getAllByRole("region", { name: /העברה אפשרית/ })).toHaveLength(1);
  });

  it("a viewer sees the pairs with no answers", async () => {
    db.hold = true;
    renderScreen();
    const [first] = await screen.findAllByRole("region", { name: /העברה אפשרית/ });
    expect(within(first as HTMLElement).queryByRole("button")).toBeNull();
    db.hold = false;
  });
});
