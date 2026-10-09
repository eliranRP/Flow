import { render, screen } from "@testing-library/react";
import { fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TxnMeta } from "../txn-meta";
import { lineSplitPartsLabel } from "../line-split-copy";
import { jevReasonText, reviewFlagView } from "../review-copy";
import { JEV_FILLED, JEV_FILLED_UNDO, JEV_NO_PROJECT, REVIEW_MISMATCH_ID, REVIEW_MISSING_BOTH, REVIEW_MISSING_ID, ReviewCard, SPLIT_MISMATCH_ACTION, SPLIT_MISMATCH_LINE, type ReviewSuggestion } from "./review-card";

describe("ReviewCard split_mismatch (FLOW-333 C2, C8)", () => {
  it("keeps the sentence, drops the link and shows one static row with the part count", () => {
    const onProject = vi.fn();
    const { container } = render(
      <ReviewCard
        supplier="ספק לדוגמה"
        sourceLine="הוצאה · 06/10/2026"
        netAgorot={-480_000n}
        reason="split_mismatch"
        suggestion={{ project: "וילה רעננה", category: "חומרים", projectSuggested: true, categorySuggested: true }}
        onProject={onProject}
        onCategory={() => undefined}
        splitParts={3}
      />,
    );
    const sentence = screen.getByText(SPLIT_MISMATCH_LINE);
    expect(sentence).toHaveAttribute("id", REVIEW_MISMATCH_ID);
    expect(screen.queryByRole("button", { name: SPLIT_MISMATCH_ACTION })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector(".ui-review-split-row")?.textContent).toBe(lineSplitPartsLabel(3));
    expect(container.querySelector(".ui-review-split-row bdi")?.textContent).toBe("3");
    expect(screen.queryByText("וילה רעננה")).toBeNull();
    expect(screen.queryByText("הצעה")).toBeNull();
    expect(container.querySelector(".ui-row-chevron")).toBeNull();
  });

  it("says חלק אחד for one part, a skeleton while loading, and מפוצל when the count is unknown", () => {
    const { container, rerender } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} reason="split_mismatch" splitParts={1} />);
    expect(container.querySelector(".ui-review-split-row")?.textContent).toBe("מפוצל · חלק אחד");
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} reason="split_mismatch" splitParts="loading" />);
    expect(container.querySelector(".ui-review-split-row .ui-skeleton-bar")).not.toBeNull();
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} reason="split_mismatch" />);
    expect(container.querySelector(".ui-review-split-row")?.textContent).toBe("מפוצל");
  });

  it("other reasons show neither the sentence nor the split row", () => {
    const { container } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} reason="missing_project" splitParts={2} />);
    expect(screen.queryByText(SPLIT_MISMATCH_LINE)).toBeNull();
    expect(container.querySelector(".ui-review-split-row")).toBeNull();
  });
});

describe("ReviewCard FLOW-327 additions", () => {
  const jev = { project: "וילה רעננה", category: "חומרים", projectSuggested: true, categorySuggested: true, projectJev: true, categoryJev: true };

  it("ends with בחרו פרויקט וקטגוריה when both fields are missing, and not otherwise", () => {
    const { rerender } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} missingBoth onProject={() => undefined} onCategory={() => undefined} />);
    expect(screen.getByText(REVIEW_MISSING_BOTH)).toHaveAttribute("id", REVIEW_MISSING_ID);
    expect(REVIEW_MISSING_BOTH).toBe("בחרו פרויקט וקטגוריה");
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} onProject={() => undefined} onCategory={() => undefined} />);
    expect(screen.queryByText(REVIEW_MISSING_BOTH)).toBeNull();
  });

  it("shows the Jev reason line only with a הצעת Jev pill, numbers in bdi", () => {
    const why = jevReasonText({ reason: "usual_for_party", partyFilings: 5, matchingFilings: 3 }, "expense");
    const { container, rerender } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevWhy={why} onProject={() => undefined} onCategory={() => undefined} />);
    const line = container.querySelector(".ui-review-reason");
    expect(line?.textContent).toBe("✦כמו ב־3 מתוך 5 הפעמים האחרונות");
    expect([...(line?.querySelectorAll("bdi.ui-num") ?? [])].map((node) => node.textContent)).toEqual(["3", "5"]);
    expect(line?.querySelector("[aria-hidden='true']")?.textContent).toBe("✦");
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={{ ...jev, projectJev: false, categoryJev: false }} jevWhy={why} onProject={() => undefined} onCategory={() => undefined} />);
    expect(container.querySelector(".ui-review-reason")).toBeNull();
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevWhy={why} pending onProject={() => undefined} onCategory={() => undefined} />);
    expect(container.querySelector(".ui-review-reason")).toBeNull();
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevWhy={null} onProject={() => undefined} onCategory={() => undefined} />);
    expect(container.querySelector(".ui-review-reason")).toBeNull();
  });

  it("draws a loud flag as a warning row and a quiet flag as a hint, both with a hidden לבדיקה", () => {
    const loud = reviewFlagView([{ transaction_id: "t", kind: "duplicate", jev_score: 0.9, other_doc_date: "2026-10-03" }]);
    const { container, rerender } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} flag={loud} />);
    const row = container.querySelector(".ui-review-flag");
    expect(row).toHaveClass("ui-row-tone-warning");
    expect(row?.querySelector(".ui-row-title")?.textContent).toBe("לבדיקה: ייתכן שזה כפל");
    expect(row?.querySelector(".ui-row-hint")?.textContent).toBe("אותו ספק ואותו סכום ב־03/10");
    expect(container.querySelector(".ui-review")?.lastElementChild).toBe(row);
    expect(screen.queryByRole("button")).toBeNull();
    const quiet = reviewFlagView([{ transaction_id: "t", kind: "new_party_large", jev_score: null }], { direction: "income" });
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} flag={quiet} />);
    const hint = container.querySelector(".ui-review-flag-quiet");
    expect(hint).toHaveClass("t-hint");
    expect(hint?.textContent).toBe("לבדיקה: לקוח חדש בסכום גבוה");
    expect(container.querySelector(".ui-review-flag")).toBeNull();
  });

  it("shows Jev's no-project answer on the empty project row with הצעת Jev (FLOW-703)", () => {
    render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={{ category: "חומרים", projectNoneJev: true }} onProject={() => undefined} onCategory={() => undefined} />);
    const row = screen.getByRole("button", { name: `פרויקט: ${JEV_NO_PROJECT}, הצעת Jev` });
    expect(row.querySelector(".ui-row-title")).not.toHaveClass("ui-row-title-muted");
    expect(row.querySelector(".ui-suggest-tag-jev")).not.toBeNull();
    expect(JEV_NO_PROJECT).toBe("תקורה · ללא פרויקט");
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

describe("ReviewCard Jev fill label (FLOW-702)", () => {
  const jev: ReviewSuggestion = { project: "וילה רעננה", category: "חומרים", projectSuggested: true, categorySuggested: true, projectJev: true, categoryJev: true };

  it("says מולא ע״י Jev with בטל, which calls back", () => {
    const onUndo = vi.fn();
    render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevFilled={{ onUndo }} onProject={() => undefined} onCategory={() => undefined} />);
    expect(screen.getByText(JEV_FILLED)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `${JEV_FILLED_UNDO} את המילוי של Jev` }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("shows the label alone for a viewer, and nothing without a הצעת Jev pill or while pending", () => {
    const { rerender } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevFilled={{}} />);
    expect(screen.getByText(JEV_FILLED)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /בטל/ })).toBeNull();
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={{ ...jev, projectJev: false, categoryJev: false }} jevFilled={{}} />);
    expect(screen.queryByText(JEV_FILLED)).toBeNull();
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevFilled={{}} pending />);
    expect(screen.queryByText(JEV_FILLED)).toBeNull();
  });

  it("shows the label alone on one line, with no reason and no second ✦ line", () => {
    const why = jevReasonText({ reason: "same_as_last", partyFilings: 4, matchingFilings: 4 }, "expense");
    const { container } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevWhy={why} jevFilled={{ onUndo: () => undefined }} />);
    const lines = container.querySelectorAll(".ui-review-reason");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.querySelector(".ui-review-reason-text")?.textContent).toBe(JEV_FILLED);
  });

  it("shows the label without a הצעת Jev pill only when Jev is off (FLOW-706)", () => {
    const plain = { ...jev, projectJev: false, categoryJev: false };
    const { container, rerender } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={plain} jevFilled={{ onUndo: () => undefined, alone: true }} />);
    expect(container.querySelector(".ui-review-filled .ui-review-reason-text")?.textContent).toBe(JEV_FILLED);
    expect(screen.getByRole("button", { name: `${JEV_FILLED_UNDO} את המילוי של Jev` })).toBeInTheDocument();
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={plain} jevFilled={{ onUndo: () => undefined }} />);
    expect(container.querySelector(".ui-review-filled")).toBeNull();
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={plain} pending jevFilled={{ onUndo: () => undefined, alone: true }} />);
    expect(container.querySelector(".ui-review-filled")).toBeNull();
  });

  it("marks בטל busy while the undo runs", () => {
    render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevFilled={{ onUndo: () => undefined, busy: true }} />);
    expect(screen.getByRole("button", { name: /בטל/ })).toHaveAttribute("aria-busy", "true");
  });
});
