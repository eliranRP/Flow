import type { Meta, StoryObj } from "@storybook/react";
import { TeamStory } from "../dev/team-story";
import type { SampleTeamOptions } from "../dev/team-sample";
import { InvitesScreen } from "./invites-screen";

/** FLOW-513: the invitation screen's states (board Invite), on an in-memory team. Invented names only. */
const meta = {
  title: "Screens/Invites",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function screen(options: SampleTeamOptions, state: "open" | "joined" | "declined" = "open") {
  return () => (
    <TeamStory entry="/invites" options={{ invite: { role: "viewer", seen: true }, ...options }}>
      <InvitesScreen sample={{ state }} />
    </TeamStory>
  );
}

export const Viewer: Story = { render: screen({}) };
export const Editor: Story = { render: screen({ invite: { role: "editor", seen: true } }) };
export const NewUser: Story = { render: screen({ noCompany: true }) };
export const Joined: Story = { render: screen({}, "joined") };
export const Declined: Story = { render: screen({}, "declined") };
export const Expired: Story = { render: screen({ invite: { role: "viewer", expired: true, seen: true } }) };

// The board draws its frames at 320 and 393: the tallest states get the narrow one too.
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
export const Viewer320: Story = { ...Viewer, name: "Viewer, 320", ...at320 };
export const Editor320: Story = { ...Editor, name: "Editor, 320", ...at320 };
