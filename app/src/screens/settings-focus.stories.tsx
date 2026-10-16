import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { Route, Routes, useNavigate } from "react-router-dom";
import { AiConnectionPage } from "./assistant-settings";
import { BusinessScreen } from "./business-screen";
import { ConnectionDetailPage } from "./connection-pages";
import { ConnectionsScreen, SettingsScreen } from "./flow-screens";
import { RENAME_TOO_SHORT } from "./rename-company";
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

/** Escape on the AI page's confirm sheet returns to the ניתוק button that opened it (FLOW-512). */
export const ConfirmFocus: Story = {
  name: "AI disconnect, Escape returns focus",
  render: () => (
    <StoryRoute entry="/settings/connections/ai">
      <AiConnectionPage sample={{ state: "connected", scope: "read_write", id: "mcp-1" }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = bodyOf(canvasElement);
    const disconnect = canvas.getByRole("button", { name: "ניתוק" });
    await userEvent.click(disconnect);
    const confirm = await body.findByRole("dialog", { name: "לנתק את העוזר?" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    await waitFor(() => expect(disconnect).toHaveFocus());
  },
};

/** The SUMIT page's ניתוק confirm: closing it puts focus back on the button. */
export const SumitDisconnectFocus: Story = {
  name: "SUMIT disconnect, close returns focus",
  render: () => (
    <StoryRoute entry="/settings/connections/sumit">
      <ConnectionDetailPage provider="sumit" sample={{ state: "connected", companyId: "1234567", lastSync: "היום, 06:05" }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = bodyOf(canvasElement);
    const disconnect = canvas.getByRole("button", { name: "ניתוק" });
    await userEvent.click(disconnect);
    const confirm = await body.findByRole("dialog", { name: "לנתק את SUMIT?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "סגירה" }));
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    await waitFor(() => expect(disconnect).toHaveFocus());
  },
};

const renameBusiness = {
  name: "סטודיו אלפא לעיצוב ובנייה בע״מ",
  connected: false,
  companyId: null,
  lastError: null,
  email: "owner@example.com",
};

/** A one-letter name shows the error on blur. Lives here because blur moves focus off the sheet title. */
export const RenameTooShort: Story = {
  name: "Rename sheet, name too short",
  render: () => (
    <StoryRoute entry="/settings/business">
      <BusinessScreen sample={renameBusiness} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: `שם העסק: ${renameBusiness.name}` }));
    const sheet = await bodyOf(canvasElement).findByRole("dialog", { name: "שם העסק" });
    const field = within(sheet).getByLabelText("השם כפי שיופיע");
    await userEvent.clear(field);
    await userEvent.type(field, "א");
    await userEvent.tab();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await within(sheet).findByText(RENAME_TOO_SHORT);
  },
};

function BackLink() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => { void navigate(-1); }}>
      חזרה בדפדפן
    </button>
  );
}

/** FLOW-501, FLOW-512. Back from the Connections and business pages puts focus on the Settings row that opened them. */
export const BackFocus: Story = {
  name: "Back returns focus to the Settings row",
  render: () => (
    <StoryRoute entry="/settings">
      <BackLink />
      <Routes>
        <Route path="/settings" element={<SettingsScreen sample={business} />} />
        <Route path="/settings/connections" element={<ConnectionsScreen sample={{ ...business, assistant: { state: "empty" } }} />} />
        <Route path="/settings/business" element={<BusinessScreen sample={business} />} />
      </Routes>
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("link", { name: /^חיבורים/ }));
    await canvas.findByRole("heading", { name: "חיבורים" });
    await userEvent.click(canvas.getByRole("button", { name: "חזרה בדפדפן" }));
    await waitFor(() => expect(canvas.getByRole("link", { name: /^חיבורים/ })).toHaveFocus());
    await userEvent.click(canvas.getByRole("link", { name: /^העסק/ }));
    await canvas.findByRole("heading", { name: "העסק" });
    await userEvent.click(canvas.getByRole("button", { name: "חזרה בדפדפן" }));
    await waitFor(() => expect(canvas.getByRole("link", { name: /^העסק/ })).toHaveFocus());
  },
};
