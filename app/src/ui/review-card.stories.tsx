import type { Meta, StoryObj } from "@storybook/react";
import { ReviewCard } from "./review-card";
import { jevReasonText, reviewFlagView, reviewPaidView, type JevReasonKind, type ReviewFlag } from "../review-copy";
import { expect, userEvent, within } from "@storybook/test";
import type { TxnMeta } from "../txn-meta";
import { padded, storyMeta } from "./story-support";

type CardArgs = {
  supplier: string;
  sourceLine: string;
  netAgorot: string;
  vatLine: string;
  project?: string;
  category?: string;
  confidence?: number;
  reason?: string;
  meta?: TxnMeta;
  currency?: string;
  /** Jev filled the suggested project or category: הצעת Jev instead of הצעה. */
  projectJev?: boolean;
  categoryJev?: boolean;
  /** FLOW-327: a split_mismatch card names the parts; "loading" while the split is read. */
  splitParts?: number | "loading";
  /** FLOW-327: Jev's reason line (decision 0134). */
  why?: JevReasonKind;
  partyFilings?: number;
  matchingFilings?: number;
  /** FLOW-327: the anomaly flags (decision 0131); the card shows at most one. */
  flags?: ReviewFlag[];
  direction?: "income" | "expense";
  /** FLOW-327 / C8: the hint under the rows when both fields are empty. */
  missingBoth?: boolean;
  /** FLOW-703: Jev answered "no project". */
  projectNoneJev?: boolean;
  /** FLOW-702: the auto job's fill stands. "label" is a viewer's card, with no ביטול. */
  filled?: "undo" | "label" | "busy" | "off";
  /** FLOW-309 (0165): the invoice's paired receipts (dates), whether they cover it, and the latest date. */
  receipts?: string[];
  paid?: boolean;
  paidOn?: string | null;
  /** The field rows open their pickers (chevrons), as on the review screen. */
  editable?: boolean;
};

function CardView({
  supplier, sourceLine, netAgorot, vatLine, project, category, confidence, reason, meta, currency, projectJev, categoryJev,
  splitParts, why, partyFilings = 5, matchingFilings = 3, flags, direction, missingBoth, projectNoneJev, filled,
  receipts, paid, paidOn, editable,
}: CardArgs) {
  const shared = reason === "unallocated_shared";
  const suggestion = project || category || projectNoneJev
    ? {
        project,
        category,
        confidence,
        projectSuggested: Boolean(project) && !shared,
        categorySuggested: Boolean(category),
        projectJev,
        categoryJev,
        projectNoneJev,
      }
    : undefined;
  const jevWhy = why ? jevReasonText({ reason: why, partyFilings, matchingFilings }, direction) : null;
  return (
    <ReviewCard
      supplier={supplier}
      sourceLine={sourceLine}
      netAgorot={BigInt(netAgorot)}
      vatLine={vatLine}
      suggestion={suggestion}
      reason={reason}
      meta={meta}
      currency={currency}
      onProject={editable || projectJev || categoryJev || filled != null ? () => undefined : undefined}
      onCategory={editable || projectJev || categoryJev || filled != null ? () => undefined : undefined}
      splitParts={splitParts}
      jevWhy={jevWhy}
      flag={reviewFlagView(flags, { direction, currency })}
      direction={direction}
      missingBoth={missingBoth}
      jevFilled={filled == null ? null : filled === "label" ? {} : { busy: filled === "busy", alone: filled === "off", onUndo: () => undefined }}
      paid={reviewPaidView({
        receipts: receipts?.map((doc_date) => ({ doc_date })),
        paid,
        paid_on: paidOn,
      })}
    />
  );
}

const meta = {
  title: "Components/ReviewCard",
  component: CardView,
  decorators: [padded],
} satisfies Meta<typeof CardView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoSuggestion: Story = {
  args: {
    supplier: "חומרי בניין לדוגמה בע״מ",
    sourceLine: "הוצאה · 12/04/2026",
    netAgorot: "-2200000",
    vatLine: "לפני מע״מ · מע״מ ₪3,960",
  },
};

export const OneCard: Story = {
  args: {
    supplier: "חומרי בניין לדוגמה בע״מ",
    sourceLine: "חשבונית · 21/09/2026",
    netAgorot: "-850000",
    vatLine: "לפני מע״מ · מע״מ ₪1,530",
  },
};

export const MissingProject: Story = {
  args: {
    ...OneCard.args,
    category: "חומרים",
  },
};

export const MissingCategory: Story = {
  args: {
    ...OneCard.args,
    project: "וילה רעננה",
  },
};

/** FLOW-312 item 2 / 0125: the bank changed a split line's amount, so the parts no longer match. */
const splitMismatchArgs = {
  ...OneCard.args,
  project: "וילה רעננה",
  category: "חומרים",
  reason: "split_mismatch",
};

export const SharedCost: Story = {
  args: {
    ...OneCard.args,
    category: "חומרים",
    reason: "unallocated_shared",
  },
};

export const Suggestion: Story = {
  args: {
    ...OneCard.args,
    project: "וילה רעננה",
    category: "חומרים",
  },
};

export const NoScore: Story = {
  args: {
    ...OneCard.args,
    project: "וילה רעננה",
    category: "חומרים",
    confidence: 92,
  },
};

/** FLOW-304. Bank details. A USD Mercury line has no VAT line. */
const mercuryCard = {
  supplier: "Example Office Suite",
  sourceLine: "הוצאה · 12/09/2026",
  netAgorot: "-125000",
  currency: "USD",
  vatLine: "",
  project: "Cedar Lot",
  category: "Office",
};

export const MetaNone: Story = {
  name: "Meta: none (today)",
  args: { ...mercuryCard, meta: storyMeta("t1", {}) },
};

export const MetaCard: Story = {
  name: "Meta: card",
  args: { ...mercuryCard, meta: storyMeta("t1", { method: "card", card_last4: "4242" }) },
};

export const MetaAchMemo: Story = {
  name: "Meta: ACH and memo",
  args: {
    ...mercuryCard,
    meta: storyMeta("t1", { method: "ach", memo: "Invoice 1042 for the September office lease, parking, and storage" }),
  },
};

export const MetaAchMemoOpen: Story = {
  name: "Meta: ACH and memo, open",
  args: MetaAchMemo.args,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /^הערה:/ }));
  },
};

export const MetaWire: Story = {
  name: "Meta: wire",
  args: { ...mercuryCard, meta: storyMeta("t1", { method: "wire" }) },
};

export const MetaHebrewMemo: Story = {
  name: "Meta: Hebrew memo",
  args: {
    ...mercuryCard,
    meta: storyMeta("t1", { method: "card", card_last4: "4242", memo: "תשלום על חשבונית 1042 עבור שכירות משרד חודש ספטמבר" }),
  },
};

/** הצעת Jev marks the field whose value Jev filled. Invented data. */
const jevCard = { ...OneCard.args, project: "וילה רעננה", category: "חומרים" };
const dark = { globals: { theme: "dark" } };
const narrow = { parameters: { viewport: { defaultViewport: "flow320" } } };

export const JevProject: Story = { name: "Jev: project", args: { ...jevCard, projectJev: true } };
export const JevProjectDark: Story = { ...dark, name: "Jev: project, dark", args: JevProject.args };
export const JevProject320: Story = { ...narrow, name: "Jev: project, 320", args: JevProject.args };

export const JevCategory: Story = { name: "Jev: category", args: { ...jevCard, categoryJev: true } };
export const JevCategoryDark: Story = { ...dark, name: "Jev: category, dark", args: JevCategory.args };
export const JevCategory320: Story = { ...narrow, name: "Jev: category, 320", args: JevCategory.args };

export const JevBoth: Story = { name: "Jev: both", args: { ...jevCard, projectJev: true, categoryJev: true } };
export const JevBothDark: Story = { ...dark, name: "Jev: both, dark", args: JevBoth.args };
export const JevBoth320: Story = { ...narrow, name: "Jev: both, 320", args: JevBoth.args };

/** A long value is cut with an ellipsis; the pill and the chevron stay on the row. */
export const JevBothLong320: Story = {
  ...narrow,
  name: "Jev: both, long names, 320",
  args: {
    ...JevBoth.args,
    supplier: "ספק חומרי בניין והובלה כללית בע״מ סניף רעננה המרכזי",
    project: "וילה רעננה — שיפוץ מלא של הקומה העליונה והחצר האחורית",
    category: "חומרי בניין והובלה כללית בע״מ סניף רעננה המרכזי והסביבה הקרובה",
  },
};

/** FLOW-327 item 3: the mismatch card names the parts in one row; the actions sit in the bar. */
export const SplitMismatchParts: Story = { args: { ...splitMismatchArgs, splitParts: 2 } };
export const SplitMismatchOnePart: Story = { args: { ...splitMismatchArgs, splitParts: 1 } };
export const SplitMismatchPartsDark: Story = { ...dark, args: SplitMismatchParts.args };
export const SplitMismatchParts320: Story = { ...narrow, args: SplitMismatchParts.args };
export const SplitMismatchPartsLoading: Story = { args: { ...splitMismatchArgs, splitParts: "loading" } };

/** FLOW-333 C8: both fields empty, so אישור is off and this line says why. */
export const BothMissingHint: Story = { args: { ...OneCard.args, missingBoth: true } };
export const BothMissingHint320: Story = { ...narrow, args: BothMissingHint.args };
export const BothMissingHintDark: Story = { ...dark, args: BothMissingHint.args };

/** FLOW-327 / 0134: Jev's reason, one line under the rows. Invented data. */
const jevBoth = { ...jevCard, projectJev: true, categoryJev: true };
export const JevReasonSameAsLast: Story = { name: "Jev reason: same as last", args: { ...jevBoth, why: "same_as_last" } };
export const JevReasonUsual: Story = { name: "Jev reason: usual for party", args: { ...jevBoth, why: "usual_for_party", partyFilings: 5, matchingFilings: 3 } };
export const JevReasonNewParty: Story = { name: "Jev reason: new party", args: { ...jevBoth, why: "new_party" } };
export const JevReasonNewPartyIncome: Story = { name: "Jev reason: new party, income", args: { ...jevBoth, why: "new_party", direction: "income", netAgorot: "1850000" } };
export const JevReasonModelOnly: Story = { name: "Jev reason: model only", args: { ...jevBoth, why: "model_only" } };
export const JevReasonUsual320: Story = { ...narrow, name: "Jev reason: usual, 320", args: JevReasonUsual.args };
export const JevReasonUsualDark: Story = { ...dark, name: "Jev reason: usual, dark", args: JevReasonUsual.args };

/** FLOW-703: Jev's answer is "no project"; the field shows it with the pill. */
export const JevNoProject: Story = { name: "Jev: no project", args: { ...OneCard.args, category: "משרד", categoryJev: true, projectNoneJev: true, why: "usual_for_party" } };
export const JevNoProject320: Story = { ...narrow, name: "Jev: no project, 320", args: JevNoProject.args };
export const JevNoProjectDark: Story = { ...dark, name: "Jev: no project, dark", args: JevNoProject.args };

/** FLOW-327 / 0131: one flag per card, loud from a Jev score of 0.7. Invented data. */
const flag = (kind: ReviewFlag["kind"], score: number | null, extra: Partial<ReviewFlag> = {}): ReviewFlag => ({
  transaction_id: "t1", kind, jev_score: score, ...extra,
});
export const FlagDuplicateLoud: Story = { name: "Flag: duplicate, loud", args: { ...jevCard, flags: [flag("duplicate", 0.86, { other_doc_date: "2026-10-03" })] } };
/** 2026-10-09 option A: "↑ 240%" right after the amount and "בדרך כלל ₪2,500" under it; no flag row beside the pill. */
export const FlagSpikeLoud: Story = { name: "Flag: amount spike, loud", args: { ...jevCard, flags: [flag("amount_spike", 0.74, { ratio: 3.4, typical_amount_minor: 250_000 })] } };
export const FlagSpikeLoud320: Story = { ...narrow, name: "Flag: amount spike, loud, 320", args: FlagSpikeLoud.args };
export const FlagSpikeLoudDark: Story = { ...dark, name: "Flag: amount spike, loud, dark", args: FlagSpikeLoud.args };
export const FlagSpikeQuiet: Story = { name: "Flag: amount spike, quiet", args: { ...jevCard, flags: [flag("amount_spike", 0.4, { ratio: 3.4, typical_amount_minor: 250_000 })] } };
export const FlagSpikeQuiet320: Story = { ...narrow, name: "Flag: amount spike, quiet, 320", args: FlagSpikeQuiet.args };
export const FlagSpikeQuietDark: Story = { ...dark, name: "Flag: amount spike, quiet, dark", args: FlagSpikeQuiet.args };
/** With no ratio there is no pill: the quiet line stays, and the usual amount still sits under the amount. */
export const FlagSpikeNoRatio: Story = { name: "Flag: amount spike, quiet, no ratio", args: { ...jevCard, flags: [flag("amount_spike", null, { typical_amount_minor: 250_000 })] } };
/** At 320 a long amount may leave no room: the pill drops under it, and the amount is never cut. */
export const FlagSpikeLong320: Story = {
  ...narrow,
  name: "Flag: amount spike, long amount, 320",
  args: { ...jevCard, netAgorot: "-123456700", flags: [flag("amount_spike", 0.4, { ratio: 12.5, typical_amount_minor: 9_876_500 })] },
  play: async ({ canvasElement }) => {
    const amount = canvasElement.querySelector<HTMLElement>(".ui-review-amount > .t-display");
    const pill = canvasElement.querySelector<HTMLElement>(".ui-review-spike");
    await expect(amount).not.toBeNull();
    await expect(pill).not.toBeNull();
    await document.fonts.ready;
    const amountBox = (amount as HTMLElement).getBoundingClientRect();
    const cardEl = canvasElement.querySelector(".ui-review") as HTMLElement;
    const outer = cardEl.getBoundingClientRect();
    const style = getComputedStyle(cardEl);
    // The card's content box: an amount spilling into the padding counts as cut.
    const card = { left: outer.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth), right: outer.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth) };
    const pillBox = (pill as HTMLElement).getBoundingClientRect();
    // The amount is never cut, and the pill stays inside the card: beside the amount when it fits, else under it.
    await expect(amountBox.left).toBeGreaterThanOrEqual(card.left - 0.5);
    await expect(amountBox.right).toBeLessThanOrEqual(card.right + 0.5);
    await expect(pillBox.left).toBeGreaterThanOrEqual(card.left - 0.5);
    await expect(pillBox.right).toBeLessThanOrEqual(card.right + 0.5);
    const beside = pillBox.top < amountBox.bottom - 1;
    if (beside) await expect(pillBox.right <= amountBox.left || pillBox.left >= amountBox.right).toBe(true);
    else await expect(pillBox.top).toBeGreaterThanOrEqual(amountBox.bottom - 1);
  },
};
export const FlagNewPartyLoudIncome: Story = { name: "Flag: new party, loud, income", args: { ...jevCard, direction: "income", netAgorot: "4800000", flags: [flag("new_party_large", 0.9)] } };
export const FlagDuplicateQuiet: Story = { name: "Flag: duplicate, quiet", args: { ...jevCard, flags: [flag("duplicate", 0.4, { other_doc_date: "2026-10-03" })] } };
export const FlagSpikeQuietIncome: Story = { name: "Flag: amount spike, quiet, income", args: { ...jevCard, direction: "income", flags: [flag("amount_spike", 0.5, { ratio: 3 })] } };
export const FlagNewPartyUnscored: Story = { name: "Flag: new party, unscored (Jev off)", args: { ...jevCard, flags: [flag("new_party_large", null)] } };
export const FlagWithJevReason: Story = { name: "Flag: loud, with Jev reason", args: { ...jevBoth, why: "usual_for_party", flags: [flag("amount_spike", 0.8, { ratio: 3.1, typical_amount_minor: 95_000 })] } };
export const FlagLoud320: Story = { ...narrow, name: "Flag: loud, 320", args: FlagWithJevReason.args };
export const FlagLoudDark: Story = { ...dark, name: "Flag: loud, dark", args: FlagWithJevReason.args };
export const FlagQuiet320: Story = { ...narrow, name: "Flag: quiet, 320", args: FlagDuplicateQuiet.args };
export const FlagQuietDark: Story = { ...dark, name: "Flag: quiet, dark", args: FlagDuplicateQuiet.args };

// FLOW-702: the auto job filled the line. "✦ מולא ע״י Jev" with ביטול at the end, one line, no reason.
/**
 * FLOW-339 C6-3: ביטול's 44px hit area grows down and sideways from the filled line, never up into the
 * category row, so a tap at the row's bottom edge opens the row and never undoes the fill.
 */
export const JevFilled: Story = {
  name: "Jev filled: undo",
  args: { ...jevBoth, why: "usual_for_party", filled: "undo" },
  play: async ({ canvasElement }) => {
    const undo = canvasElement.querySelector<HTMLElement>(".ui-review-filled-undo");
    await expect(undo).not.toBeNull();
    const box = (undo as HTMLElement).getBoundingClientRect();
    const x = box.left + box.width / 2;
    for (const dy of [1, 4, 8, 13]) {
      await expect(document.elementFromPoint(x, box.top - dy)?.closest(".ui-review-filled-undo")).toBeNull();
    }
    await expect(document.elementFromPoint(x, box.bottom + 10)?.closest(".ui-review-filled-undo")).not.toBeNull();
  },
};
export const JevFilledDark: Story = { ...dark, name: "Jev filled: undo, dark", args: JevFilled.args, play: JevFilled.play };
export const JevFilled320: Story = { ...narrow, name: "Jev filled: undo, 320", args: JevFilled.args, play: JevFilled.play };
export const JevFilledBusy: Story = { name: "Jev filled: undo running", args: { ...JevFilled.args, filled: "busy" } };
export const JevFilledViewer: Story = { name: "Jev filled: viewer", args: { ...JevFilled.args, filled: "label" } };
export const JevFilledFlag320: Story = { ...narrow, name: "Jev filled: with quiet flag, 320", args: { ...JevFilled.args, flags: [flag("duplicate", 0.3, { other_doc_date: "2026-10-03" })] } };
// FLOW-706: Jev is off. The stored values with הצעה, no הצעת Jev pill, and the fill still undoable.
export const JevFilledOff: Story = { name: "Jev filled: Jev off", args: { ...jevCard, filled: "off" } };
export const JevFilledOff320: Story = { ...narrow, name: "Jev filled: Jev off, 320", args: JevFilledOff.args };
export const JevFilledOffDark: Story = { ...dark, name: "Jev filled: Jev off, dark", args: JevFilledOff.args };

/**
 * FLOW-309 option A (decision 0165): a connector invoice and its receipt are one card. Invented data;
 * every story sees 2026-10-15, so the dates are this year's dd/mm.
 */
const pairCard = {
  supplier: "לקוח לדוגמה",
  sourceLine: "הכנסה · 05/10/2026",
  netAgorot: "1200000",
  vatLine: "לפני מע״מ · מע״מ ₪2,160",
  direction: "income" as const,
  project: "וילה לדוגמה",
  category: "עבודה",
  editable: true,
};
const darkNarrow = { globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } };

export const PairPaid: Story = { name: "Pair: paid", args: { ...pairCard, receipts: ["2026-10-12"], paid: true, paidOn: "2026-10-12" } };
export const PairPaid320: Story = { ...narrow, name: "Pair: paid, 320", args: PairPaid.args };
export const PairPaidDark320: Story = { ...darkNarrow, name: "Pair: paid, dark, 320", args: PairPaid.args };

/** A part payment: the receipts don't cover the invoice yet. No ✓, the latest receipt's date. */
export const PairPartPaid: Story = {
  name: "Pair: part paid",
  args: { ...pairCard, receipts: ["2026-10-06", "2026-10-12"], paid: false, paidOn: "2026-10-12" },
};
export const PairPartPaid320: Story = { ...narrow, name: "Pair: part paid, 320", args: PairPartPaid.args };
export const PairPartPaidDark320: Story = { ...darkNarrow, name: "Pair: part paid, dark, 320", args: PairPartPaid.args };

/** An invoice with no receipt yet: no line. */
export const PairUnpaid: Story = { name: "Pair: unpaid invoice", args: { ...pairCard, receipts: [], paid: false, paidOn: null } };
export const PairUnpaid320: Story = { ...narrow, name: "Pair: unpaid invoice, 320", args: PairUnpaid.args };
export const PairUnpaidDark320: Story = { ...darkNarrow, name: "Pair: unpaid invoice, dark, 320", args: PairUnpaid.args };

/** A receipt whose invoice isn't in Flow is a card like any other, with no line. */
export const PairReceiptOnly: Story = {
  name: "Pair: receipt only",
  args: { ...pairCard, sourceLine: "הכנסה · 12/10/2026", vatLine: "", receipts: [], paid: false, paidOn: null },
};
export const PairReceiptOnly320: Story = { ...narrow, name: "Pair: receipt only, 320", args: PairReceiptOnly.args };
export const PairReceiptOnlyDark320: Story = { ...darkNarrow, name: "Pair: receipt only, dark, 320", args: PairReceiptOnly.args };

/** Stress: a supplier name that takes three lines at 320 wraps whole; a fourth line would end in an ellipsis. */
export const SupplierThreeLines320: Story = {
  ...narrow,
  name: "Stress: supplier on three lines, 320",
  args: {
    ...jevCard,
    editable: true,
    supplier: "חברת ההובלות והשינוע לדוגמה בע״מ סניף צפון",
  },
};

/** FLOW-352 1 (cycle 11): beside the הצעה pill at 320 a long value wraps to a second line. Invented names. */
const longValueCard = { ...OneCard.args, project: "וילה הדקלים לדוגמה", category: "חומרי בניין וגמר לדוגמה", editable: true };
export const ValueWraps320: Story = { ...narrow, name: "Stress: value on two lines beside הצעה, 320", args: longValueCard };
export const ValueWrapsDark320: Story = { ...dark, ...narrow, name: "Stress: value on two lines beside הצעה, dark 320", args: longValueCard };
