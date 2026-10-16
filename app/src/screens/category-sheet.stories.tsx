import type { CategoryRow } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { StoryRoute } from "../ui/story-route";
import { CategoriesScreen } from "./categories-screen";

/**
 * FLOW-405 + FLOW-404: the ⋯ sheet in Settings → Categories, the move picker and the delete
 * confirm (mockup v2, approved by the owner 2026-10-08). Invented data only.
 */
const meta = {
  title: "Screens/Categories sheet",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const categories: CategoryRow[] = [
  { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: false, lines: 42, split_lines: 3, loan_used: false, rehab: null, in_rehab: true },
  { id: "c2", name: "קבלנים", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: false, lines: 31, split_lines: 0, loan_used: false, in_rehab: true },
  { id: "c3", name: "כלים וציוד", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: false, lines: 12, split_lines: 0, loan_used: false, in_rehab: true },
  { id: "c4", name: "חשמל ואינסטלציה", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: false, lines: 9, split_lines: 0, loan_used: false, in_rehab: true, group_name: "חשבונות" },
  { id: "c5", name: "ביטוח נכס", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: false, lines: 18, split_lines: 0, loan_used: true, rehab: false, in_rehab: false },
  { id: "c6", name: "עמלות", kind: "expense", hidden: false, is_default: false, excluded_from_pnl: false, lines: 4, split_lines: 0, loan_used: false, in_rehab: true },
  { id: "c7", name: "אחר", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: false, lines: 0, split_lines: 0, loan_used: false, in_rehab: true },
  { id: "i1", name: "שכר דירה", kind: "income", hidden: false, is_default: true, excluded_from_pnl: false, lines: 14, split_lines: 0, loan_used: false },
  { id: "c8", name: "תשלומי הלוואה", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: true, loan_part: "principal", lines: 12, loan_used: true },
];


function body(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

/** FLOW-106 §3.5: an invented loan that keeps its escrow on ביטוח נכס and its fees on עמלות. */
const loans = [{ name: "משכנתא לדוגמה", interest_category_id: null, escrow_category_id: "c5", principal_category_id: null }];

function Screen({ withLoans = false }: { withLoans?: boolean } = {}) {
  return (
    <StoryRoute entry="/settings/categories" tabs>
      <CategoriesScreen sample={categories} sampleLoans={withLoans ? loans : undefined} />
    </StoryRoute>
  );
}

async function openMenu(canvasElement: HTMLElement, name: string) {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: new RegExp(`^${name}`) }));
  return body(canvasElement).findByRole("dialog", { name });
}

export const Menu: Story = {
  name: "Menu, a category with lines",
  render: () => <Screen />,
  play: async ({ canvasElement }) => { await openMenu(canvasElement, "חומרים"); },
};

export const MenuLoanUsed: Story = {
  name: "Menu, a loan uses it (delete disabled)",
  render: () => <Screen />,
  play: async ({ canvasElement }) => { await openMenu(canvasElement, "ביטוח נכס"); },
};

/** FLOW-106 §3.5: a loan names the category for escrow, so it is locked like the built-in loan ones. */
export const MenuLoanOwnCategory: Story = {
  name: "Menu, a loan's own escrow category (locked)",
  render: () => <Screen withLoans />,
  play: async ({ canvasElement }) => { await openMenu(canvasElement, "ביטוח נכס"); },
};

export const MenuLoanCategory: Story = {
  name: "Menu, a built-in loan category",
  render: () => <Screen />,
  play: async ({ canvasElement }) => { await openMenu(canvasElement, "תשלומי הלוואה"); },
};

/** FLOW-347: the only income category has nowhere to move, so its sheet has no move row. */
export const MenuNowhereToMove: Story = {
  name: "Menu, the only category of its kind (no move row)",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("radio", { name: "הכנסות" }));
    await openMenu(canvasElement, "שכר דירה");
  },
};

export const MovePicker: Story = {
  name: "Move all lines: pick where they go",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const sheet = await openMenu(canvasElement, "חומרים");
    await userEvent.click(within(sheet).getByRole("button", { name: "העברה לקטגוריה אחרת" }));
    await body(canvasElement).findByRole("dialog", { name: "העברת 42 תנועות אל" });
  },
};

export const MoveAndHide: Story = {
  name: "Move with the hide switch on: confirm the merge",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const sheet = await openMenu(canvasElement, "חומרים");
    await userEvent.click(within(sheet).getByRole("button", { name: "העברה לקטגוריה אחרת" }));
    const picker = await body(canvasElement).findByRole("dialog", { name: "העברת 42 תנועות אל" });
    await userEvent.click(within(picker).getByRole("switch", { name: "להסתיר את חומרים" }));
    await userEvent.click(within(picker).getByRole("button", { name: /קבלנים/ }));
    await body(canvasElement).findByRole("dialog", { name: "למזג את הקטגוריה?" });
  },
};

export const DeleteConfirm: Story = {
  name: "Delete, a category with lines",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const sheet = await openMenu(canvasElement, "חומרים");
    await userEvent.click(within(sheet).getByRole("button", { name: "מחיקה" }));
    await body(canvasElement).findByRole("dialog", { name: "למחוק את הקטגוריה?" });
  },
};

export const DeleteEmpty: Story = {
  name: "Delete, an empty category",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const sheet = await openMenu(canvasElement, "אחר");
    await userEvent.click(within(sheet).getByRole("button", { name: "מחיקה" }));
    await body(canvasElement).findByRole("dialog", { name: "למחוק את הקטגוריה?" });
  },
};

export const Rename: Story = {
  name: "Rename, the name sheet",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const sheet = await openMenu(canvasElement, "חומרים");
    await userEvent.click(within(sheet).getByRole("button", { name: "שינוי שם" }));
    await body(canvasElement).findByRole("dialog", { name: "שינוי שם" });
  },
};

/** FLOW-401: the קטגוריית אב row after שינוי שם, and its picker. One tap applies a group. */
export const Group: Story = {
  name: "Group, the picker",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const sheet = await openMenu(canvasElement, "חשמל ואינסטלציה");
    await userEvent.click(within(sheet).getByRole("button", { name: /^קטגוריית אב/ }));
    await body(canvasElement).findByRole("dialog", { name: "בחירת קטגוריית אב" });
  },
};

export const GroupNew: Story = {
  name: "Group, a new group",
  render: () => <Screen />,
  play: async ({ canvasElement }) => {
    const sheet = await openMenu(canvasElement, "חומרים");
    await userEvent.click(within(sheet).getByRole("button", { name: /^קטגוריית אב/ }));
    const picker = await body(canvasElement).findByRole("dialog", { name: "בחירת קטגוריית אב" });
    await userEvent.click(within(picker).getByRole("button", { name: "קטגוריית אב חדשה" }));
    await within(picker).findByLabelText("שם הקטגוריה");
  },
};
