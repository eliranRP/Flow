import type { Meta, StoryObj } from "@storybook/react";
import { ReviewCard } from "./review-card";
import { userEvent, within } from "@storybook/test";
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
  /** FLOW-325: a split_mismatch card offers עדכון הפיצול. */
  fixSplit?: boolean;
};

function CardView({ supplier, sourceLine, netAgorot, vatLine, project, category, confidence, reason, meta, currency, projectJev, categoryJev, fixSplit }: CardArgs) {
  const shared = reason === "unallocated_shared";
  const suggestion = project || category
    ? {
        project,
        category,
        confidence,
        projectSuggested: Boolean(project) && !shared,
        categorySuggested: Boolean(category),
        projectJev,
        categoryJev,
      }
    : undefined;
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
      onProject={projectJev || categoryJev ? () => undefined : undefined}
      onCategory={projectJev || categoryJev ? () => undefined : undefined}
      onFixSplit={fixSplit ? () => undefined : undefined}
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
    supplier: "חומרי בניין השרון בע״מ",
    sourceLine: "הוצאה · 12/04/2026",
    netAgorot: "-2200000",
    vatLine: "לפני מע״מ · מע״מ ₪3,960",
  },
};

export const OneCard: Story = {
  args: {
    supplier: "חומרי בניין השרון בע״מ",
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
export const SplitMismatch: Story = {
  args: {
    ...OneCard.args,
    project: "וילה רעננה",
    category: "חומרים",
    reason: "split_mismatch",
    fixSplit: true,
  },
};

export const SplitMismatchDark: Story = {
  args: SplitMismatch.args,
  globals: { theme: "dark" },
};

export const SplitMismatch320: Story = {
  args: SplitMismatch.args,
  parameters: { viewport: { defaultViewport: "flow320" } },
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
