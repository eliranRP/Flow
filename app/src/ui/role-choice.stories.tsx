import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { RoleChoice, type RoleChoiceValue } from "./role-choice";
import { padded } from "./story-support";

function Live({ start, hints }: { start: RoleChoiceValue; hints: boolean }) {
  const [role, setRole] = useState<RoleChoiceValue>(start);
  return <RoleChoice value={role} onChange={setRole} hints={hints} />;
}

const meta = {
  title: "Components/RoleChoice",
  component: RoleChoice,
  decorators: [padded],
} satisfies Meta<typeof RoleChoice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** FLOW-601 invite-1: צופה by default, each with its hint. */
export const InviteDefault: Story = {
  args: { value: "viewer", hints: true, onChange: () => undefined },
  render: () => <Live start="viewer" hints />,
};

/** FLOW-601 a-2: the member sheet, no hints, the current role checked. */
export const MemberEditor: Story = {
  args: { value: "editor", onChange: () => undefined },
  render: () => <Live start="editor" hints={false} />,
};

export const Saving: Story = {
  args: { value: "editor", busy: "viewer", onChange: () => undefined },
};

export const InviteDark: Story = {
  args: { value: "viewer", hints: true, onChange: () => undefined },
  globals: { theme: "dark" },
};

export const Invite320: Story = {
  args: { value: "editor", hints: true, onChange: () => undefined },
  parameters: { viewport: { defaultViewport: "flow320" } },
};
