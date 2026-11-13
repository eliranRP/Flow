import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { SettingsScreen } from "./flow-screens";
import { BusinessScreen } from "./business-screen";
import { StoryRoute } from "../ui/story-route";
import { ViewerPreview } from "../use-is-viewer";
import { ExampleBar, OfflineStory, pagesBusiness, storyBody } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** FLOW-512: the Settings menu with every row, a live-looking business. Invented names only. */
export const SettingsMain: Story = {
  name: "Settings, menu",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...pagesBusiness, teamCount: 3, companyCount: 2, categoryCount: 12, setupLeft: 2 }} />
    </StoryRoute>
  ),
};

/** FLOW-1137: Settings loads in its grouped shape: two group heads, each over an inset card of icon rows. */
export const SettingsLoading: Story = {
  name: "Settings, loading",
  render: () => (
    <StoryRoute entry="/settings?preview=loading" tabs>
      <ExampleBar />
      <SettingsScreen />
    </StoryRoute>
  ),
  play: async () => {
    await waitFor(() => expect(document.querySelector(".ui-grouped-skel")).not.toBeNull());
  },
};

/** FLOW-1137: the team count and the businesses are still read: their rows hold skeleton values, not a blank or nothing. */
export const SettingsCountsLoading: Story = {
  name: "Settings, counts loading",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...pagesBusiness, teamCount: "loading", companyCount: "loading", categoryCount: 12 }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("החלפת עסק")).toBeVisible();
    await expect(within(canvasElement).queryByRole("button", { name: /החלפת עסק/ })).toBeNull();
  },
};

/** FLOW-972: offline, the line under the head says that changes wait for the connection. */
export const SettingsOffline: Story = {
  name: "Settings, offline",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <OfflineStory>
        <SettingsScreen sample={{ ...pagesBusiness, teamCount: 3, companyCount: 2, categoryCount: 12 }} />
      </OfflineStory>
    </StoryRoute>
  ),
};

export const SettingsEmpty: Story = {
  name: "Settings, no company",
  render: () => (
    <StoryRoute entry="/settings?preview=empty" tabs>
      <ExampleBar />
      <SettingsScreen
        sample={{
          name: null,
          connected: false,
          companyId: null,
          lastError: null,
          email: "owner@example.com",
          noCompany: true,
        }}
      />
    </StoryRoute>
  ),
};

export const SettingsSumitBroken: Story = {
  name: "Settings, SUMIT needs connecting",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...pagesBusiness, lastError: "sumit_auth" }} />
    </StoryRoute>
  ),
};

export const SettingsSetupNotDone: Story = {
  name: "Settings, setup not done",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...pagesBusiness, setupLeft: 2 }} />
    </StoryRoute>
  ),
};

export const SettingsHintsLoading: Story = {
  name: "Settings, hints loading",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...pagesBusiness, sumit: "loading" }} />
    </StoryRoute>
  ),
};

export const SettingsViewer: Story = {
  name: "Settings, viewer",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <ViewerPreview>
        <SettingsScreen sample={pagesBusiness} />
      </ViewerPreview>
    </StoryRoute>
  ),
};

const renameBusiness = {
  ...pagesBusiness,
  name: "סטודיו אלפא לעיצוב ובנייה בע״מ",
  basis: "cash" as const,
};

/** FLOW-512: the business page (/settings/business) with its rows and the overhead switch. */
export const BusinessPage: Story = {
  name: "Business",
  render: () => (
    <StoryRoute entry="/settings/business" tabs>
      <ExampleBar />
      <BusinessScreen sample={renameBusiness} />
    </StoryRoute>
  ),
};

/** FLOW-1166: the closed date in one read-only row, under the profit basis (the assistant sets it). */
export const BusinessBooksClosed: Story = {
  name: "Business, books closed",
  render: () => (
    <StoryRoute entry="/settings/business" tabs>
      <ExampleBar />
      <BusinessScreen sample={{ ...renameBusiness, booksClosedThrough: "2026-03-31" }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("31/03/2026")).toBeInTheDocument();
  },
};

export const BusinessViewer: Story = {
  name: "Business, viewer",
  render: () => (
    <StoryRoute entry="/settings/business" tabs>
      <ExampleBar />
      <ViewerPreview>
        <BusinessScreen sample={renameBusiness} />
      </ViewerPreview>
    </StoryRoute>
  ),
};

export const BusinessRenameSheet: Story = {
  name: "Business, rename sheet",
  render: () => (
    <StoryRoute entry="/settings/business" tabs>
      <ExampleBar />
      <BusinessScreen sample={renameBusiness} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: `שם העסק: ${renameBusiness.name}` }));
    await storyBody(canvasElement).findByRole("dialog", { name: "שם העסק" });
  },
};

/** Decision 0194: the owner's danger zone confirm, with the name typed so the delete is on. */
export const BusinessDeleteSheet: Story = {
  name: "Business, delete sheet",
  render: () => (
    <StoryRoute entry="/settings/business" tabs>
      <ExampleBar />
      <BusinessScreen sample={renameBusiness} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "מחיקת כל הנתונים" }));
    const dialog = await storyBody(canvasElement).findByRole("dialog", { name: "למחוק את כל הנתונים?" });
    await userEvent.type(within(dialog).getByLabelText("כתבו את שם העסק כדי לאשר"), renameBusiness.name);
  },
};

export const BusinessCurrencySheet: Story = {
  name: "Business, currency sheet",
  render: () => (
    <StoryRoute entry="/settings/business" tabs>
      <ExampleBar />
      <BusinessScreen sample={{ ...renameBusiness, loanCurrency: "USD" }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "מטבע העסק: $ דולר" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "מטבע העסק" });
  },
};

export const BusinessDateSheet: Story = {
  name: "Business, date sheet",
  render: () => (
    <StoryRoute entry="/settings/business" tabs>
      <ExampleBar />
      <BusinessScreen sample={renameBusiness} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "רווח ותזרים לפי: תאריך תשלום" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "רווח ותזרים לפי" });
  },
};
