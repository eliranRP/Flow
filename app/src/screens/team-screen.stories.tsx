import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { TeamStory } from "../dev/team-story";
import type { SampleTeamOptions } from "../dev/team-sample";
import { TeamScreen } from "./team-screen";

/**
 * FLOW-601: the צוות page and its sheets (mockups a-1, a-2, invite-1, invite-2), on an
 * in-memory team. Invented names and example.com only.
 */
const meta = {
  title: "Screens/Team",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const dark = { globals: { theme: "dark" as const } };
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

function page(options: SampleTeamOptions = {}) {
  return () => (
    <TeamStory entry="/settings/team" tabs options={options}>
      <TeamScreen />
    </TeamStory>
  );
}

function body(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

export const Team: Story = { name: "Team (a-1)", render: page() };
export const TeamDark: Story = { ...Team, name: "Team, dark", ...dark };
export const Team320: Story = { ...Team, name: "Team, 320", ...at320 };

export const Pending: Story = { name: "Pending invite (invite-2)", render: page({ pendingInvite: true }) };
export const PendingDark: Story = { ...Pending, name: "Pending invite, dark", ...dark };

export const Alone: Story = { name: "Only the owner", render: page({ alone: true }) };
export const Loading: Story = { render: page({ hold: ["listTeam"] }) };
export const Failed: Story = { name: "Read failed", render: page({ fail: { listTeam: "Failed to fetch" } }) };
export const Editor: Story = { name: "An editor reads it", render: page({ role: "editor" }) };

export const Invite: Story = {
  name: "Invite sheet (invite-1)",
  render: page({ delayMs: 600 }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "הזמנה" }));
    await body(canvasElement).findByRole("dialog", { name: "הזמנה" });
  },
};
export const InviteDark: Story = { ...Invite, name: "Invite sheet, dark", ...dark };
export const Invite320: Story = { ...Invite, name: "Invite sheet, 320", ...at320 };

export const InviteAlreadyMember: Story = {
  name: "Invite sheet, already a member",
  render: page(),
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "הזמנה" }));
    const dialog = await body(canvasElement).findByRole("dialog", { name: "הזמנה" });
    await userEvent.type(within(dialog).getByLabelText("אימייל"), "yossi@example.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "שליחת הזמנה" }));
    await within(dialog).findByText("כבר בצוות.");
  },
};

export const Member: Story = {
  name: "Member sheet (a-2)",
  render: page(),
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "יוסי כהן, עורך" }));
    await body(canvasElement).findByRole("dialog", { name: "יוסי כהן" });
  },
};
export const MemberDark: Story = { ...Member, name: "Member sheet, dark", ...dark };

export const RemoveConfirm: Story = {
  name: "Remove confirm",
  render: page(),
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "יוסי כהן, עורך" }));
    const dialog = await body(canvasElement).findByRole("dialog", { name: "יוסי כהן" });
    await userEvent.click(within(dialog).getByRole("button", { name: "הסרה מהצוות" }));
    await body(canvasElement).findByRole("dialog", { name: "להסיר מהצוות?" });
  },
};

export const PendingSheet: Story = {
  name: "Pending invite sheet",
  render: page({ pendingInvite: true }),
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "noa@example.com, הוזמנה · צופה" }));
    await body(canvasElement).findByRole("dialog", { name: "noa@example.com" });
  },
};
