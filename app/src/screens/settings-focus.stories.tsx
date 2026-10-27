import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Route, Routes, useNavigate } from "react-router-dom";
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

/**
 * Decision 0223: ניתוק has no confirm. The button goes away with the connection, so focus moves to the page
 * title; ביטול brings the connection back, and focus is on the title again, not lost with the toast.
 */
export const SumitDisconnectFocus: Story = {
  name: "SUMIT disconnect, focus goes to the title, and stays there after ביטול",
  render: () => (
    <StoryRoute entry="/settings/connections/sumit">
      <ConnectionDetailPage provider="sumit" sample={{ state: "connected", companyId: "1234567", lastSync: "היום, 06:05" }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = bodyOf(canvasElement);
    const title = canvas.getByRole("heading", { name: "SUMIT" });
    await userEvent.click(canvas.getByRole("button", { name: "ניתוק" }));
    await expect(body.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByRole("button", { name: "ניתוק" })).not.toBeInTheDocument());
    await waitFor(() => expect(title).toHaveFocus());
    await body.findByText("SUMIT נותק. מה שכבר נכנס נשמר");
    await userEvent.click(body.getByRole("button", { name: "ביטול" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "ניתוק" })).toBeInTheDocument());
    await waitFor(() => expect(title).toHaveFocus());
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
