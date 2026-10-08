import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { Route, Routes, useNavigate } from "react-router-dom";
import { ConnectionsScreen, LoansScreen, SettingsScreen } from "./flow-screens";
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

/** ✕ and Escape on a Connections sheet return focus to the control that opened it (FLOW-501 moved them here). */
export const ReturnFocus: Story = {
  render: () => (
    <StoryRoute entry="/settings/connections">
      <ConnectionsScreen
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
    <StoryRoute entry="/settings/connections">
      <ConnectionsScreen
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
    <StoryRoute entry="/settings">
      <SettingsScreen sample={renameBusiness} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: `שם העסק: ${renameBusiness.name}` }));
    const sheet = await bodyOf(canvasElement).findByRole("dialog", { name: "שם העסק" });
    const field = within(sheet).getByLabelText("שם");
    await userEvent.clear(field);
    await userEvent.type(field, "א");
    await userEvent.tab();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await within(sheet).findByText("שם קצר מדי – לפחות 2 תווים");
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

/** FLOW-501. Back from the Connections and Loans pages puts focus on the Settings row that opened them. */
export const BackFocus: Story = {
  name: "Back returns focus to the Settings row",
  render: () => (
    <StoryRoute entry="/settings">
      <BackLink />
      <Routes>
        <Route path="/settings" element={<SettingsScreen sample={{ ...business, loans: [] }} />} />
        <Route path="/settings/connections" element={<ConnectionsScreen sample={{ ...business, assistant: { state: "empty" } }} />} />
        <Route path="/settings/loans" element={<LoansScreen sample={{ ...business, loans: [] }} />} />
      </Routes>
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("link", { name: "חיבורים" }));
    await canvas.findByRole("heading", { name: "חיבורים" });
    await userEvent.click(canvas.getByRole("button", { name: "חזרה בדפדפן" }));
    await waitFor(() => expect(canvas.getByRole("link", { name: "חיבורים" })).toHaveFocus());
    await userEvent.click(canvas.getByRole("link", { name: "הלוואות" }));
    await canvas.findByRole("heading", { name: "הלוואות" });
    await userEvent.click(canvas.getByRole("button", { name: "חזרה בדפדפן" }));
    await waitFor(() => expect(canvas.getByRole("link", { name: "הלוואות" })).toHaveFocus());
  },
};
