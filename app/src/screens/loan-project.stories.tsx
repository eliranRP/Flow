import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LoanBalanceList, ProjectLoanList } from "./loan-match";
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

const light390 = { parameters: { viewport: { defaultViewport: "flow390" } } };
const dark390 = { globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow390" } } };
const light320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const dark320 = { globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } };

type Frame = { globals?: { theme: string }; parameters: { viewport: { defaultViewport: string } } };
/** The picker and the form live in one sheet in the app; draw them on it. */
function sheet(frame: Frame, sheetTitle: string) {
  return { ...frame, decorators: [inSheet], parameters: { ...frame.parameters, sheetTitle } };
}

export const PickerNone: Story = { args: {}, ...sheet(light390, "פרויקט") };
export const PickerNoneDark: Story = { args: {}, ...sheet(dark390, "פרויקט") };
export const PickerCurrentFinished: Story = { args: { selectedId: "p3" }, ...sheet(light320, "פרויקט") };
export const PickerCurrentFinishedDark: Story = { args: { selectedId: "p3" }, ...sheet(dark320, "פרויקט") };
export const PickerSearch: Story = { args: { rows: "many", selectedId: "m3" }, ...sheet(light390, "פרויקט") };
export const PickerSearchDark320: Story = { args: { rows: "many", selectedId: "m3" }, ...sheet(dark320, "פרויקט") };
export const PickerLongHebrew: Story = { args: { rows: "long", selectedId: "l1" }, ...sheet(light320, "פרויקט") };
export const PickerLongHebrewDark: Story = { args: { rows: "long", selectedId: "l1" }, ...sheet(dark320, "פרויקט") };
export const PickerLoading: Story = { args: { loading: true }, ...sheet(light320, "פרויקט") };
export const PickerError: Story = { args: { error: true }, ...sheet(light320, "פרויקט") };
export const PickerErrorDark: Story = { args: { error: true }, ...sheet(dark320, "פרויקט") };
export const PickerEmpty: Story = { args: { rows: "none" }, ...sheet(light320, "פרויקט") };
export const PickerNoCodes: Story = { args: { rows: "noCodes" }, ...sheet(light390, "פרויקט") };
export const PickerSaving: Story = { args: { selectedId: "p1", savingId: "p2" }, ...sheet(light320, "פרויקט") };

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

export const FormNoProject: Story = { render: () => <Form project={null} />, ...sheet(light320, "הלוואה") };
export const FormNoProjectDark: Story = { render: () => <Form project={null} />, ...sheet(dark320, "הלוואה") };
export const FormProject: Story = { render: () => <Form project="שיפוץ הרצל 12" />, ...sheet(light390, "הלוואה") };
export const FormProjectLongHebrew: Story = {
  render: () => <Form project="שיפוץ מקיף של דירת ארבעה חדרים ברחוב הרצל בראשון לציון כולל מרפסת" />,
  ...sheet(light320, "הלוואה"),
};
export const FormProjectLongHebrewDark: Story = {
  render: () => <Form project="שיפוץ מקיף של דירת ארבעה חדרים ברחוב הרצל בראשון לציון כולל מרפסת" />,
  ...sheet(dark320, "הלוואה"),
};

const LOANS = [
  { id: "a", name: "משכנתא דוגמה", currency: "ILS", balanceMinor: 45_000_000n, flaggedParts: 0, projectId: "p1", projectName: "שיפוץ הרצל 12" },
  { id: "b", name: "הלוואת גישור", currency: "USD", balanceMinor: 1_250_000n, flaggedParts: 1, projectId: "p2", projectName: "פרגולה בית כהן" },
  { id: "c", name: "הלוואת בעלים", currency: "ILS", balanceMinor: 0n, flaggedParts: 0, projectId: null, projectName: null },
];

export const SettingsRowsOwner: Story = { render: () => <LoanBalanceList rows={LOANS} onOpen={() => undefined} />, ...light320 };
export const SettingsRowsOwnerDark: Story = { render: () => <LoanBalanceList rows={LOANS} onOpen={() => undefined} />, ...dark320 };
export const SettingsRowsViewer: Story = { render: () => <LoanBalanceList rows={LOANS} />, ...light320 };

const PROJECT_LOANS = [
  { id: "a", name: "משכנתא דוגמה", currency: "ILS", balance_minor: 45_000_000n },
  { id: "c", name: "הלוואת בעלים", currency: "ILS", balance_minor: 0n },
];

export const ProjectLoans: Story = { render: () => <ProjectLoanList rows={PROJECT_LOANS} />, ...light320 };
export const ProjectLoansDark: Story = { render: () => <ProjectLoanList rows={PROJECT_LOANS} />, ...dark320 };
