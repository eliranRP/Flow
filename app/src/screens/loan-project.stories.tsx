import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ProjectLoanList } from "./loan-match";
import { inSheet } from "../ui/story-support";
import { LoanProjectPicker, LoanSetupForm, type LoanProjectChoice } from "./loan-setup";

/** FLOW-119. Invented projects and loans. */
const FEW: LoanProjectChoice[] = [
  { id: "p1", name: "שיפוץ הרצל 12", status: "active", code: "P-12" },
  { id: "p2", name: "פרגולה בית כהן", status: "active", code: "P-7" },
  { id: "p3", name: "דירה ביאליק 8", status: "finished", code: "P-3" },
];

const MANY: LoanProjectChoice[] = Array.from({ length: 12 }, (_, index) => ({
  id: `m${String(index)}`,
  name: `פרויקט דוגמה ${String(index + 1)}`,
  status: "active" as const,
  code: `P-${String(index + 1)}`,
}));

/** Projects from before codes: the search keeps its plain placeholder. */
const NO_CODES: LoanProjectChoice[] = MANY.map((row) => ({ id: row.id, name: row.name, status: row.status }));

const LONG: LoanProjectChoice[] = [
  { id: "l1", name: "שיפוץ מקיף של דירת ארבעה חדרים ברחוב הרצל בראשון לציון כולל מרפסת", status: "active" },
  { id: "l2", name: "פרגולה בית כהן", status: "active" },
];

type PickerArgs = {
  rows?: "few" | "many" | "long" | "none" | "noCodes";
  selectedId?: string | null;
  loading?: boolean;
  error?: boolean;
  savingId?: string | null;
};

function Picker({ rows = "few", selectedId = null, loading, error, savingId }: PickerArgs) {
  const [picked, setPicked] = useState<string | null>(selectedId);
  const source = { few: FEW, many: MANY, long: LONG, none: [], noCodes: NO_CODES }[rows];
  return (
    <LoanProjectPicker
      source={{ rows: source, loading, error }}
      selectedId={picked}
      saving={savingId === undefined ? undefined : { id: savingId }}
      onSelect={setPicked}
    />
  );
}

const meta = {
  title: "Screens/Loan project",
  component: Picker,
} satisfies Meta<typeof Picker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The picker and the form live in one sheet in the app; draw them on it. */
function sheet(sheetTitle: string) {
  return { decorators: [inSheet], parameters: { sheetTitle } };
}

export const PickerNone: Story = { args: {}, ...sheet("פרויקט") };
export const PickerCurrentFinished: Story = { args: { selectedId: "p3" }, ...sheet("פרויקט") };
export const PickerSearch: Story = { args: { rows: "many", selectedId: "m3" }, ...sheet("פרויקט") };
export const PickerLongHebrew: Story = { args: { rows: "long", selectedId: "l1" }, ...sheet("פרויקט") };
export const PickerLoading: Story = { args: { loading: true }, ...sheet("פרויקט") };
export const PickerError: Story = { args: { error: true }, ...sheet("פרויקט") };
export const PickerEmpty: Story = { args: { rows: "none" }, ...sheet("פרויקט") };
export const PickerNoCodes: Story = { args: { rows: "noCodes" }, ...sheet("פרויקט") };
export const PickerSaving: Story = { args: { selectedId: "p1", savingId: "p2" }, ...sheet("פרויקט") };

const form = {
  name: "הלוואת דוגמה",
  principal: "100000",
  rate: "6",
  term: "360",
  startDate: "2026-11-01",
  escrow: "0",
};

function Form({ project }: { project: string | null }) {
  return (
    <LoanSetupForm
      companyCurrency="ILS"
      initial={form}
      project={{ name: project, onOpen: () => undefined }}
    />
  );
}

export const FormNoProject: Story = { render: () => <Form project={null} />, ...sheet("הלוואה") };
export const FormProject: Story = { render: () => <Form project="שיפוץ הרצל 12" />, ...sheet("הלוואה") };
export const FormProjectLongHebrew: Story = {
  render: () => <Form project="שיפוץ מקיף של דירת ארבעה חדרים ברחוב הרצל בראשון לציון כולל מרפסת" />,
  ...sheet("הלוואה"),
};

const PROJECT_LOANS = [
  { id: "a", name: "משכנתא דוגמה", currency: "ILS", balance_minor: 45_000_000n },
  { id: "c", name: "הלוואת בעלים", currency: "ILS", balance_minor: 0n },
];

export const ProjectLoans: Story = { render: () => <ProjectLoanList rows={PROJECT_LOANS} /> };
