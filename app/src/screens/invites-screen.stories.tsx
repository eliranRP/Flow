import type { Meta, StoryObj } from "@storybook/react";
import { TeamStory } from "../dev/team-story";
import type { SampleTeamOptions } from "../dev/team-sample";
import { InvitesScreen } from "./invites-screen";

/** FLOW-601: the invites list after sign-in (mockup invite-3), on an in-memory team. Invented names only. */
const meta = {
  title: "Screens/Invites",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;


function screen(options: SampleTeamOptions) {
  return () => (
    <TeamStory entry="/invites" options={{ noCompany: true, ...options }}>
      <InvitesScreen />
    </TeamStory>
  );
}

export const Empty: Story = { name: "None left", render: screen({ inbox: 0 }) };
