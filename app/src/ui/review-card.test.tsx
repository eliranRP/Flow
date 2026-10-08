import { render, screen } from "@testing-library/react";
import { fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TxnMeta } from "../txn-meta";
import { ReviewCard, type ReviewSuggestion } from "./review-card";

describe("ReviewCard split_mismatch (FLOW-312, decision 0125)", () => {
  it("says the split no longer matches the bank amount and opens the parts editor", () => {
    const onFixSplit = vi.fn();
    render(
      <ReviewCard
        supplier="ספק לדוגמה"
        sourceLine="הוצאה · 06/10/2026"
        netAgorot={-480_000n}
        reason="split_mismatch"
        suggestion={{ project: "וילה רעננה", category: "חומרים" }}
        onFixSplit={onFixSplit}
      />,
    );
    expect(screen.getByText("הפיצול לא תואם את סכום השורה בבנק.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "עדכון הפיצול" }));
    expect(onFixSplit).toHaveBeenCalledTimes(1);
  });

  it("a viewer reads the line with no action, and other reasons show neither", () => {
    const { unmount } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} reason="split_mismatch" />);
    expect(screen.getByText("הפיצול לא תואם את סכום השורה בבנק.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "עדכון הפיצול" })).toBeNull();
    unmount();
    render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} reason="missing_project" onFixSplit={() => undefined} />);
    expect(screen.queryByText("הפיצול לא תואם את סכום השורה בבנק.")).toBeNull();
  });
});

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

describe("ReviewCard הצעת Jev", () => {
  function jevCard(suggestion: ReviewSuggestion, buttons = true) {
    return (
      <ReviewCard
        supplier="חומרי בניין השרון בע״מ"
        sourceLine="הוצאה · 12/04/2026"
        netAgorot={-2_200_000n}
        suggestion={suggestion}
        onProject={buttons ? () => undefined : undefined}
        onCategory={buttons ? () => undefined : undefined}
      />
    );
  }
  const both: ReviewSuggestion = {
    project: "וילה רעננה",
    category: "חומרים",
    projectSuggested: true,
    categorySuggested: true,
  };

  it("shows הצעת Jev on the project only", () => {
    render(jevCard({ ...both, projectJev: true }));
    expect(screen.getByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעה" })).toBeInTheDocument();
    expect(screen.getAllByText("הצעת Jev")).toHaveLength(1);
    expect(screen.getAllByText("הצעה")).toHaveLength(1);
  });

  it("shows הצעת Jev on the category only", () => {
    render(jevCard({ ...both, categoryJev: true }));
    expect(screen.getByRole("button", { name: "פרויקט: וילה רעננה, הצעה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעת Jev" })).toBeInTheDocument();
  });

  it("shows הצעת Jev on both rows, after the value and before the chevron, with the ✦ hidden", () => {
    render(jevCard({ ...both, projectJev: true, categoryJev: true }));
    const tags = document.querySelectorAll(".ui-review-ai .ui-suggest-tag-jev");
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      expect(tag).toHaveTextContent("✦הצעת Jev");
      expect(within(tag as HTMLElement).getByText("✦")).toHaveAttribute("aria-hidden", "true");
      const title = tag.closest(".ui-row-title");
      expect(title?.firstElementChild).toHaveClass("ui-row-title-text");
      expect(title?.lastElementChild).toBe(tag);
      const chevron = tag.closest("button")?.querySelector(".ui-row-chevron");
      expect(chevron).not.toBeNull();
      expect(title?.compareDocumentPosition(chevron as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
  });

  it("does not show הצעת Jev on a value that is not a suggestion", () => {
    render(jevCard({ project: "וילה רעננה", category: "חומרים", projectJev: true, categoryJev: true }));
    expect(screen.getByRole("button", { name: "פרויקט: וילה רעננה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: חומרים" })).toBeInTheDocument();
    expect(document.querySelector(".ui-suggest-tag")).toBeNull();
  });

  it("does not show הצעת Jev on an empty row", () => {
    render(jevCard({ projectSuggested: true, projectJev: true, category: "חומרים" }));
    expect(screen.getByRole("button", { name: "פרויקט: לא נבחר" })).toBeInTheDocument();
    expect(screen.queryByText("הצעת Jev")).not.toBeInTheDocument();
  });

  it("reads the words on a static row", () => {
    render(jevCard({ ...both, projectJev: true }, false));
    const tag = document.querySelector(".ui-suggest-tag-jev");
    expect(tag).not.toBeNull();
    expect(within(tag?.closest(".ui-row") as HTMLElement).getByText("הצעת Jev")).toBeInTheDocument();
  });

  it("prefers הצעת Jev over החזר on a Jev category of the other kind", () => {
    render(jevCard({ ...both, categoryJev: true, categoryReversal: true }));
    expect(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעת Jev" })).toBeInTheDocument();
  });
});
