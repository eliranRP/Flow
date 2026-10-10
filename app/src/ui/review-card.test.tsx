import { render, screen } from "@testing-library/react";
import { fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TxnMeta } from "../txn-meta";
import { lineSplitPartsLabel } from "../line-split-copy";
import { jevReasonText, reviewFlagView, reviewPaidView } from "../review-copy";
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
    expect(container.querySelector(".ui-review-reason:not(.ui-review-reason-slot)")).toBeNull();
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

  it("puts an amount spike beside the amount: a hidden ↑ N% pill, a spoken sentence, and the usual amount above VAT", () => {
    const quiet = reviewFlagView([{ transaction_id: "t", kind: "amount_spike", jev_score: 0.4, ratio: 3.4, typical_amount_minor: 250_000 }]);
    const { container, rerender } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-850_000n} vatLine="לפני מע״מ" flag={quiet} />);
    const row = container.querySelector(".ui-review-amount");
    const pill = row?.querySelector(".ui-review-spike");
    expect(pill).toHaveClass("ui-status");
    expect(pill).toHaveAttribute("aria-hidden", "true");
    expect(pill?.textContent).toBe("↑ 240%");
    expect(row?.querySelector(".t-display")?.nextElementSibling).toBe(pill);
    expect(row?.querySelector(".sr-only")?.textContent).toBe("גבוה ב־240% מהרגיל לספק");
    const usual = container.querySelector(".ui-review-usual");
    expect(usual?.textContent).toBe("בדרך כלל ₪2,500");
    expect(row?.nextElementSibling).toBe(usual);
    expect(usual?.nextElementSibling?.textContent).toBe("לפני מע״מ");
    // The old bottom line is gone: no "פי X מהרגיל", and no quiet flag block at all.
    expect(container.querySelector(".ui-review-flag-quiet")).toBeNull();
    expect(container.textContent).not.toContain("פי ");

    const loud = reviewFlagView([{ transaction_id: "t", kind: "amount_spike", jev_score: 0.9, ratio: 3.4, typical_amount_minor: 250_000 }], { direction: "income" });
    rerender(<ReviewCard supplier="לקוח" sourceLine="הכנסה" netAgorot={850_000n} direction="income" flag={loud} />);
    expect(container.querySelector(".ui-review-amount .sr-only")?.textContent).toBe("לבדיקה: גבוה ב־240% מהרגיל ללקוח");
    // The pill is the whole warning: no loud row at the end repeats it.
    expect(container.querySelector(".ui-review-flag")).toBeNull();

    // Loud with no ratio: no pill, so the loud row keeps its title, with no hint, as the last block.
    const loudNoRatio = reviewFlagView([{ transaction_id: "t", kind: "amount_spike", jev_score: 0.9, typical_amount_minor: 250_000 }]);
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-850_000n} flag={loudNoRatio} />);
    const flagRow = container.querySelector(".ui-review-flag");
    expect(flagRow?.querySelector(".ui-row-title")?.textContent).toBe("לבדיקה: סכום גבוה מהרגיל");
    expect(flagRow?.querySelector(".ui-row-hint")).toBeNull();
    expect(container.querySelector(".ui-review")?.lastElementChild).toBe(flagRow);

    // No ratio: the amount stands alone and the quiet line stays, with the usual amount under the amount.
    const noRatio = reviewFlagView([{ transaction_id: "t", kind: "amount_spike", jev_score: null, typical_amount_minor: 250_000 }]);
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-850_000n} flag={noRatio} />);
    expect(container.querySelector(".ui-review-amount")).toBeNull();
    expect(container.querySelector(".ui-review-usual")?.textContent).toBe("בדרך כלל ₪2,500");
    expect(container.querySelector(".ui-review-flag-quiet")?.textContent).toBe("לבדיקה: גבוה מהרגיל לספק");
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
        supplier="חומרי בניין לדוגמה בע״מ"
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

  it("says מולא ע״י Jev with ביטול, which calls back", () => {
    const onUndo = vi.fn();
    render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevFilled={{ onUndo }} onProject={() => undefined} onCategory={() => undefined} />);
    expect(screen.getByText(JEV_FILLED)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `${JEV_FILLED_UNDO} המילוי של Jev` }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("holds the ✦ line, hidden, while a row Jev may fill waits (FLOW-704)", () => {
    const waiting = { project: "וילה", projectSuggested: true, category: "חומרים", categorySuggested: true };
    const { container, rerender } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={waiting} pending />);
    const slot = container.querySelector(".ui-review-reason-slot");
    expect(slot).not.toBeNull();
    expect(slot?.getAttribute("aria-hidden")).toBe("true");
    expect(slot?.classList.contains("ui-review-reason")).toBe(true);
    // An empty row waits on Jev too.
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={{ project: "פרויקט שמור" }} pending onCategory={() => undefined} />);
    expect(container.querySelector(".ui-review-reason-slot")).not.toBeNull();
    // Stored rows: Jev fills nothing, so nothing is held.
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={{ project: "פרויקט שמור", category: "קטגוריה שמורה" }} pending />);
    expect(container.querySelector(".ui-review-reason-slot")).toBeNull();
    // A shared cost: Jev fills no project there, so an empty project row holds nothing.
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={{ category: "קטגוריה שמורה" }} reason="unallocated_shared" pending onProject={() => undefined} />);
    expect(container.querySelector(".ui-review-reason-slot")).toBeNull();
    // A split_mismatch card shows one split row, never Jev's.
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={waiting} reason="split_mismatch" splitParts={2} pending />);
    expect(container.querySelector(".ui-review-reason-slot")).toBeNull();
    // Settled: the slot goes, and the real line takes its place.
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevFilled={{}} />);
    expect(container.querySelector(".ui-review-reason-slot")).toBeNull();
    expect(container.querySelectorAll(".ui-review-reason")).toHaveLength(1);
  });

  it("shows the label alone for a viewer, and nothing without a הצעת Jev pill or while pending", () => {
    const { rerender } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevFilled={{}} />);
    expect(screen.getByText(JEV_FILLED)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ביטול/ })).toBeNull();
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
    expect(screen.getByRole("button", { name: `${JEV_FILLED_UNDO} המילוי של Jev` })).toBeInTheDocument();
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={plain} jevFilled={{ onUndo: () => undefined }} />);
    expect(container.querySelector(".ui-review-filled")).toBeNull();
    rerender(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={plain} pending jevFilled={{ onUndo: () => undefined, alone: true }} />);
    expect(container.querySelector(".ui-review-filled")).toBeNull();
  });

  it("shows a held flagged line with its flag, the הצעת Jev pills and no fill (plan item 3)", () => {
    // The anomaly gate kept the auto job off this line, so no jev_prefills row and no jevFilled.
    const loud = reviewFlagView([{ transaction_id: "t", kind: "duplicate", jev_score: 0.8, other_doc_date: "2026-10-03" }]);
    const { container } = render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} flag={loud} onProject={() => undefined} onCategory={() => undefined} />);
    expect(container.querySelector(".ui-review-flag")).not.toBeNull();
    expect(screen.getAllByText("הצעת Jev").length).toBeGreaterThan(0);
    expect(screen.queryByText(JEV_FILLED)).toBeNull();
    expect(screen.queryByRole("button", { name: /ביטול/ })).toBeNull();
  });

  it("marks ביטול busy while the undo runs", () => {
    render(<ReviewCard supplier="ספק" sourceLine="הוצאה" netAgorot={-100n} suggestion={jev} jevFilled={{ onUndo: () => undefined, busy: true }} />);
    expect(screen.getByRole("button", { name: /ביטול/ })).toHaveAttribute("aria-busy", "true");
  });
});

describe("ReviewCard paid line (FLOW-309, decision 0165)", () => {
  const now = new Date("2026-10-15T09:00:00+03:00");
  const receipt = (doc_date: string) => ({ transaction_id: `r-${doc_date}`, doc_date, amount_gross: 1_416_000n, currency: "ILS" });
  function card(paid: ReturnType<typeof reviewPaidView>, vatLine?: string) {
    return render(<ReviewCard supplier="לקוח לדוגמה" sourceLine="חשבונית מס · 05/10/2026" netAgorot={1_200_000n} direction="income" vatLine={vatLine} paid={paid} />);
  }

  it("says ✓ שולם · קבלה dd/mm under the VAT line, and readers hear it as words", () => {
    const view = reviewPaidView({ receipts: [receipt("2026-10-12")], paid: true, paid_on: "2026-10-12" }, now);
    const { container } = card(view, "לפני מע״מ · מע״מ ₪2,160");
    const line = container.querySelector(".ui-review-paid");
    expect(line).not.toBeNull();
    expect(line?.previousElementSibling?.textContent).toBe("לפני מע״מ · מע״מ ₪2,160");
    expect(line?.querySelector(".ui-review-paid-icon svg")).not.toBeNull();
    expect(line?.querySelector(".ui-review-paid-icon")).toHaveAttribute("aria-hidden", "true");
    const shown = line?.querySelector(".ui-review-paid-text");
    expect(shown).toHaveAttribute("aria-hidden", "true");
    expect(shown?.textContent).toBe("שולם · קבלה 12/10");
    expect(shown?.querySelector("bdi.ui-num")?.textContent).toBe("12/10");
    expect(line?.querySelector(".sr-only")?.textContent).toBe("שולם, קבלה מ־12/10");
  });

  it("sits right under the amount when there is no VAT line", () => {
    const { container } = card(reviewPaidView({ receipts: [receipt("2026-10-12")], paid: true, paid_on: "2026-10-12" }, now));
    expect(container.querySelector(".ui-review-paid")?.previousElementSibling).toHaveClass("t-display");
  });

  it("says שולם חלקית with the latest receipt and no ✓ on a part payment", () => {
    const view = reviewPaidView({ receipts: [receipt("2026-10-02"), receipt("2026-10-09")], paid: false, paid_on: "2026-10-09" }, now);
    const { container } = card(view);
    const line = container.querySelector(".ui-review-paid");
    expect(line?.querySelector("svg")).toBeNull();
    expect(line?.querySelector(".ui-review-paid-text")?.textContent).toBe("שולם חלקית · קבלה 09/10");
    expect(line?.querySelector(".sr-only")?.textContent).toBe("שולם חלקית, קבלה מ־09/10");
  });

  it("draws nothing with no receipts, or on a payload from before the pairing server", () => {
    expect(reviewPaidView({ receipts: [], paid: false, paid_on: null }, now)).toBeNull();
    expect(reviewPaidView({}, now)).toBeNull();
    const { container } = card(null);
    expect(container.querySelector(".ui-review-paid")).toBeNull();
  });

  it("takes the latest receipt's date when paid_on is missing, and keeps the year of another year", () => {
    expect(reviewPaidView({ receipts: [receipt("2026-10-03"), receipt("2026-10-07")], paid: true }, now)?.spoken).toBe("שולם, קבלה מ־07/10");
    expect(reviewPaidView({ receipts: [receipt("2025-12-30")], paid: true, paid_on: "2025-12-30" }, now)?.line).toEqual(["שולם · קבלה ", { num: "30/12/2025" }]);
  });
});
