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
};

function CardView({ supplier, sourceLine, netAgorot, vatLine, project, category, confidence, reason, meta, currency }: CardArgs) {
  const shared = reason === "unallocated_shared";
  const suggestion = project || category
    ? {
        project,
        category,
        confidence,
        projectSuggested: Boolean(project) && !shared,
        categorySuggested: Boolean(category),
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
