import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { SAMPLE_EDIT_SELECTION, SAMPLE_NEW_ACCOUNT, SAMPLE_PICK, SAMPLE_SECOND, sampleConnection } from "../dev/mercury-sample";
import { MercuryConnectionRoute, type MercurySample } from "./mercury-connection-screen";

/** FLOW-938: the Mercury page, its accounts step and several connections. Invented names, digits and balances. */
const meta = {
  title: "Screens/Mercury connection",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function page(sample: MercurySample, entry = "/settings/connections/mercury", viewer = false) {
  return (
    <StoryRoute entry={entry} tabs viewer={viewer}>
      <ExampleBar />
      <MercuryConnectionRoute sample={sample} />
    </StoryRoute>
  );
}

const CONNECTED: MercurySample = { connections: [sampleConnection()], lastSync: "לפני 5 דקות", imported: "1,284 תנועות", editSelection: SAMPLE_EDIT_SELECTION };

export const FirstConnection: Story = { name: "First connection (the key)", render: () => page({ connections: [] }) };

export const AccountsAndDate: Story = {
  name: "3 · accounts and date",
  render: () => page({ connections: [SAMPLE_PICK] }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("checkbox", { name: /Treasury/ })).toHaveAttribute("aria-checked", "false");
    await expect(canvas.getByRole("button", { name: "סנכרון 4 חשבונות" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "בחירת כולם" }));
    await expect(canvas.getByRole("button", { name: "סנכרון 5 חשבונות" })).toBeEnabled();
  },
};

export const FromWhichDate: Story = {
  name: "מאיזה תאריך לייבא",
  render: () => page({ connections: [SAMPLE_PICK] }, "/settings/connections/mercury?sheet=from"),
};

export const Connected: Story = { name: "Connected", render: () => page(CONNECTED) };

export const SyncedAccountsEditing: Story = {
  name: "חשבונות מסונכרנים, editing",
  render: () => page(CONNECTED, "/settings/connections/mercury?edit=1"),
};

export const NewAccountFound: Story = {
  name: "Connected, new account found",
  render: () => page({ connections: [SAMPLE_NEW_ACCOUNT], lastSync: "לפני 5 דקות", imported: "1,284 תנועות" }),
};

export const TwoConnections: Story = {
  name: "Two connections",
  render: () => page({ connections: [sampleConnection(), SAMPLE_SECOND] }),
};

export const OneOfTwo: Story = {
  name: "Two connections, one open",
  render: () => page({ connections: [sampleConnection(), SAMPLE_SECOND], lastSync: "לפני 12 דקות" }, "/settings/connections/mercury?slot=2"),
};

export const Viewer: Story = { name: "Connected, viewer", render: () => page(CONNECTED, undefined, true) };
