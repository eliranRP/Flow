import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LoanPartsSheet, type LoanPartField, type LoanPartKey } from "./loan-parts-sheet";

/** FLOW-114 option B: the split sheet of a matched loan payment. Invented amounts: 6,200 split 4,150 / 1,630 / 380 / 40. */
const FIELDS: LoanPartField[] = [
  { part: "principal", value: "4150" },
  { part: "interest", value: "1630" },
  { part: "escrow", value: "380" },
  { part: "fees", value: "40" },
];

type DemoArgs = {
  fields?: LoanPartField[];
  total?: string;
  problem?: string;
  note?: string;
  prefix?: string;
  loading?: boolean;
  saving?: boolean;
  unmatching?: boolean;
};

function Demo({ fields = FIELDS, total = "₪6,200", problem, note, prefix, loading, saving, unmatching }: DemoArgs) {
  const [open, setOpen] = useState(true);
  const [values, setValues] = useState(fields);
  return (
    <LoanPartsSheet
      open={open}
      onOpenChange={setOpen}
      title="משכנתא לדוגמה"
      fields={values}
      onFieldChange={(part: LoanPartKey, raw: string) => {
        setValues((list) => list.map((field) => (field.part === part ? { ...field, value: raw } : field)));
      }}
      prefix={prefix}
      total={total}
      problem={problem}
      note={note}
      loading={loading}
      saving={saving}
      unmatching={unmatching}
      canSave={problem == null}
      onSave={() => undefined}
      onUnmatch={() => undefined}
    />
  );
}

const meta = {
  title: "Components/LoanPartsSheet",
  component: Demo,
  parameters: { viewport: { defaultViewport: "flow375-se" } },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const Narrow320: Story = { parameters: { viewport: { defaultViewport: "flow320" } } };
/** Three parts: a payment with no fees. */
export const ThreeParts: Story = { args: { fields: FIELDS.slice(0, 3), total: "₪6,160" } };
/** The parts no longer add up to the line: שמירה stays off and the line says the total it needs. */
export const DoesNotAddUp: Story = { args: { fields: [{ part: "principal", value: "4000" }, ...FIELDS.slice(1)], total: "₪6,050", problem: "הסה״כ צריך להיות ₪6,200." } };
export const Saving: Story = { args: { saving: true } };
export const Unmatching: Story = { args: { unmatching: true } };
/** A part waits for review: one line above the parts says why. */
export const NeedsReview: Story = { args: { note: "סכום השורה השתנה. בדקו את החלקים ושמרו." } };
/** A dollar loan. Largest amounts still fit at 320. */
export const DollarsLarge320: Story = {
  args: { prefix: "$", total: "$9,999,999.99", fields: [{ part: "principal", value: "9999999.99" }, { part: "interest", value: "0" }, { part: "escrow", value: "0" }] },
  parameters: { viewport: { defaultViewport: "flow320" } },
};
