import type { Meta, StoryObj } from "@storybook/react";
import { List } from "./list-row";
import { PersonRow } from "./person-row";

/** FLOW-601 (mockups a-1, invite-2): one person on the team page. Invented names only. */
function Rows() {
  return (
    <List>
      <PersonRow name="דנה לוי" hint="בעלים" />
      <PersonRow name="יוסי כהן" hint="עורך" onOpen={() => undefined} />
      <PersonRow name="מיכל אברהם" hint="צופה" onOpen={() => undefined} />
      <PersonRow name="noa@example.com" hint="הוזמנה · צופה" invite onOpen={() => undefined} />
      <PersonRow name="אלכסנדרה בן־שושן־רוזנבלום מהמחלקה הראשית" hint="עורך" onOpen={() => undefined} />
      <PersonRow name="a.very.long.address.for.someone@example.com" hint="הוזמנה · עורך" invite onOpen={() => undefined} />
    </List>
  );
}

const meta = {
  title: "Components/PersonRow",
  component: Rows,
} satisfies Meta<typeof Rows>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Team: Story = {};
export const TeamDark: Story = { globals: { theme: "dark" } };
export const Team320: Story = { parameters: { viewport: { defaultViewport: "flow320" } } };
