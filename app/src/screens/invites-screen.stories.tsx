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

const dark = { globals: { theme: "dark" as const } };
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

function screen(options: SampleTeamOptions) {
  return () => (
    <TeamStory entry="/invites" options={{ noCompany: true, ...options }}>
      <InvitesScreen />
    </TeamStory>
  );
}

export const Two: Story = { name: "Two invites (invite-3)", render: screen({ inbox: 2 }) };
export const TwoDark: Story = { ...Two, name: "Two invites, dark", ...dark };
export const Two320: Story = { ...Two, name: "Two invites, 320", ...at320 };
export const One: Story = { name: "One invite", render: screen({ inbox: 1 }) };
export const Empty: Story = { name: "None left", render: screen({ inbox: 0 }) };
export const Loading: Story = { render: screen({ inbox: 2, hold: ["myInvites"] }) };
export const Failed: Story = { name: "Read failed", render: screen({ fail: { myInvites: "Failed to fetch" } }) };
