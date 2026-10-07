import { render, screen } from "@testing-library/react";
import { fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TxnMeta } from "../txn-meta";
import { ReviewCard } from "./review-card";

describe("ReviewCard", () => {
  it("shows no note for a missing project, mutes empty rows, hides VAT, and shows income project", () => {
    const onProject = vi.fn();
    render(
      <ReviewCard
        supplier="לקוח דוגמה"
        sourceLine="הכנסה · 01/09/2026"
        netAgorot={10_000n}
        currency="USD"
        vatLine={null}
        direction="income"
        onProject={onProject}
        onCategory={() => undefined}
      />,
    );
    expect(screen.queryByText(/חסר פרויקט/)).not.toBeInTheDocument();
    expect(screen.queryByText(/אין הצעה/)).not.toBeInTheDocument();
    expect(screen.queryByText(/לפני מע״מ|פטור ממע״מ/)).not.toBeInTheDocument();
    expect(screen.getByText(/הכנסה ·/)).toBeInTheDocument();
    const projectRow = screen.getByRole("button", { name: /פרויקט: לא נבחר/ });
    expect(projectRow.querySelector(".ui-row-title")).toHaveClass("ui-row-title-muted");
    expect(screen.getByRole("button", { name: /פרויקט:/ })).toBeInTheDocument();
  });

  it("prefixes expense amounts with a minus and leaves income unsigned", () => {
    const { rerender } = render(
      <ReviewCard
        supplier="Vendor"
        sourceLine="הוצאה · 01/09/2026"
        netAgorot={125_000n}
        direction="expense"
      />,
    );
    expect(screen.getByText("−₪1,250")).toBeInTheDocument();
    rerender(
      <ReviewCard
        supplier="Client"
        sourceLine="הכנסה · 01/09/2026"
        netAgorot={125_000n}
        direction="income"
      />,
    );
    expect(screen.getByText("₪1,250")).toBeInTheDocument();
    expect(screen.queryByText(/^−/)).not.toBeInTheDocument();
  });
});

const noMeta: TxnMeta = {
  transaction_id: "t1",
  method: null,
  card_last4: null,
  memo: null,
  account: null,
  counterparty: null,
  bank_description: null,
};

function card(meta?: TxnMeta | null) {
  return (
    <ReviewCard
      supplier="Example Office Suite"
      sourceLine="הוצאה · 12/04/2026"
      netAgorot={-125_000n}
      currency="USD"
      meta={meta}
    />
  );
}

describe("ReviewCard bank details (FLOW-304)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders today's DOM with no meta, a null meta, or a meta with nothing to show", () => {
    const today = render(card()).container.innerHTML;
    for (const meta of [null, noMeta, { ...noMeta, method: "other" as const }]) {
      const { container, unmount } = render(card(meta));
      expect(container.innerHTML).toBe(today);
      unmount();
    }
    expect(today).not.toContain("ui-review-meta");
  });

  it("shows ••4242 for a card and reads it as כרטיס שמסתיים ב־4242", () => {
    render(card({ ...noMeta, method: "card", card_last4: "4242" }));
    const line = document.querySelector(".ui-review-meta");
    expect(line).not.toBeNull();
    const shown = within(line as HTMLElement).getByText("••4242");
    expect(shown).toHaveAttribute("aria-hidden", "true");
    expect(within(line as HTMLElement).getByText("כרטיס שמסתיים ב־4242")).toHaveClass("sr-only");
    expect(line?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("labels ACH, wire, and a card without last 4 in words", () => {
    const { rerender } = render(card({ ...noMeta, method: "ach" }));
    expect(document.querySelector(".ui-review-meta")).toHaveTextContent("ACH");
    rerender(card({ ...noMeta, method: "wire" }));
    expect(document.querySelector(".ui-review-meta")).toHaveTextContent("העברה בנקאית");
    rerender(card({ ...noMeta, method: "card", card_last4: null }));
    expect(document.querySelector(".ui-review-meta")).toHaveTextContent("כרטיס");
  });

  it("keeps a short memo as plain text, and makes a clipped memo a toggle", () => {
    const { unmount } = render(card({ ...noMeta, memo: "Invoice 1042" }));
    expect(screen.queryByRole("button", { name: /הערה/ })).not.toBeInTheDocument();
    expect(screen.getByText("Invoice 1042")).toHaveAttribute("dir", "auto");
    unmount();

    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(160);
    render(card({ ...noMeta, method: "ach", memo: "Invoice 1042 for the September office lease and parking" }));
    const toggle = screen.getByRole("button", { name: "הערה: Invoice 1042 for the September office lease and parking" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
