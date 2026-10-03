import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { SettingsScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";

const meta = {
  title: "Screens/Settings focus",
  component: SettingsScreen,
  parameters: { flowRouter: false },
} satisfies Meta<typeof SettingsScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

const business = {
  name: "בית הספר אלון",
  email: "owner@example.com",
  companyId: 1001,
  lastError: null,
  connected: true,
};

function bodyOf(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

/** ✕ and Escape on a Settings sheet return focus to the control that opened it. */
export const ReturnFocus: Story = {
  render: () => (
    <StoryRoute entry="/settings">
      <SettingsScreen
        sample={{
          ...business,
          connected: false,
          companyId: null,
          assistant: { state: "empty" },
        }}
      />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = bodyOf(canvasElement);

    const assistant = canvas.getByRole("button", { name: "עוזר AI" });
    await userEvent.click(assistant);
    const connect = await body.findByRole("dialog", { name: "חיבור עוזר AI" });
    await userEvent.click(within(connect).getByRole("button", { name: "סגירה" }));
    await waitFor(() => expect(connect).not.toBeInTheDocument());
    await waitFor(() => expect(assistant).toHaveFocus());

    await userEvent.click(assistant);
    const again = await body.findByRole("dialog", { name: "חיבור עוזר AI" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(again).not.toBeInTheDocument());
    await waitFor(() => expect(assistant).toHaveFocus());

    const sumit = canvas.getByRole("button", { name: "SUMIT" });
    await userEvent.click(sumit);
    const sumitSheet = await body.findByRole("dialog", { name: "חיבור SUMIT" });
    await userEvent.click(within(sumitSheet).getByRole("button", { name: "סגירה" }));
    await waitFor(() => expect(sumitSheet).not.toBeInTheDocument());
    await waitFor(() => expect(sumit).toHaveFocus());
  },
};

/** Escape on the confirm sheet returns to the ניתוק row that opened it. */
export const ConfirmFocus: Story = {
  render: () => (
    <StoryRoute entry="/settings">
      <SettingsScreen
        sample={{
          ...business,
          assistant: { state: "connected", scope: "read_write", id: "mcp-1" },
        }}
      />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = bodyOf(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "עוזר AI" }));
    const details = await body.findByRole("dialog", { name: "עוזר AI" });
    const disconnect = within(details).getByRole("button", { name: "ניתוק" });
    await userEvent.click(disconnect);
    const confirm = await body.findByRole("dialog", { name: "לנתק את העוזר?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "סגירה" }));
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    await waitFor(() => expect(disconnect).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(details).not.toBeInTheDocument());
    await waitFor(() => expect(canvas.getByRole("button", { name: "עוזר AI" })).toHaveFocus());
  },
};
