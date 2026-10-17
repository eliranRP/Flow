import type { Meta, StoryObj } from "@storybook/react";
import { List } from "./list-row";
import { PersonRow } from "./person-row";

/** FLOW-601, FLOW-512 (mockups a-1, invite-2): one person on the team page. Invented names only. */
function Rows() {
  return (
    <List>
      <PersonRow name="דנה לוי" value="בעלים" />
      <PersonRow name="יוסי כהן" value="עורך" onOpen={() => undefined} />
      <PersonRow name="מיכל אברהם" value="צופה" onOpen={() => undefined} />
      <PersonRow name="noa@example.com" value="הוזמן · ממתין" invite onOpen={() => undefined} />
      <PersonRow name="אלכסנדרה בן־שושן־רוזנבלום מהמחלקה הראשית" value="עורך" onOpen={() => undefined} />
      <PersonRow name="a.very.long.address.for.someone@example.com" value="הוזמן · ממתין" invite onOpen={() => undefined} />
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

/** Pending invites show the envelope and the email, with the accent word at the end. */
export const Pending: Story = {
  render: () => (
    <List>
      <PersonRow name="noa@example.com" value="הוזמן · ממתין" invite onOpen={() => undefined} />
    </List>
  ),
};
