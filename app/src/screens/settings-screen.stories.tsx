import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { SAMPLE_ASSISTANT_SECRET } from "../assistant-sample";
import { AssistantSettings } from "./assistant-settings";
import { LoansScreen, SettingsScreen } from "./flow-screens";
import { NotificationsLockFrame } from "../ui/reference-frames.stories-support";
import { StoryRoute } from "../ui/story-route";
import { ViewerPreview } from "../use-is-viewer";
import { at320, dark, ExampleBar, pagesBusiness, storyBody } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SettingsEmpty: Story = {
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

export const SettingsLongEmail: Story = {
  name: "Long email",
  render: () => (
    <StoryRoute entry="/settings?preview=empty" tabs>
      <ExampleBar />
      <SettingsScreen
        sample={{
          name: null,
          connected: false,
          companyId: null,
          lastError: null,
          email: "owner.with.a.very.long.mailbox.name@example.com",
          noCompany: true,
        }}
      />
    </StoryRoute>
  ),
};

const renameBusiness = {
  name: "סטודיו אלפא לעיצוב ובנייה בע״מ",
  connected: false,
  companyId: null,
  lastError: null,
  email: "owner@example.com",
};

export const SettingsBusinessRow: Story = {
  name: "Business row, long name",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={renameBusiness} />
    </StoryRoute>
  ),
};

export const SettingsBusinessRowViewer: Story = {
  name: "Business row, viewer",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <ViewerPreview>
        <SettingsScreen sample={renameBusiness} />
      </ViewerPreview>
    </StoryRoute>
  ),
};

export const SettingsRenameSheet: Story = {
  name: "Rename sheet",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={renameBusiness} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: `שם העסק: ${renameBusiness.name}` }));
    await storyBody(canvasElement).findByRole("dialog", { name: "שם העסק" });
  },
};

/** FLOW-504: the company currency row under the business name, a dollar company. */
export const SettingsCurrencyRow: Story = {
  name: "Company currency row, dollars",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...renameBusiness, loanCurrency: "USD" }} />
    </StoryRoute>
  ),
};
export const SettingsCurrencyRow320: Story = { ...SettingsCurrencyRow, name: "Company currency row, dollars, 320", ...at320 };
export const SettingsCurrencyRowDark: Story = { ...SettingsCurrencyRow, name: "Company currency row, dollars, dark", ...dark };

export const SettingsCurrencyRowViewer: Story = {
  name: "Company currency row, viewer",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <ViewerPreview>
        <SettingsScreen sample={{ ...renameBusiness, loanCurrency: "USD" }} />
      </ViewerPreview>
    </StoryRoute>
  ),
};

export const SettingsCurrencySheet: Story = {
  name: "Company currency sheet",
  render: SettingsCurrencyRow.render,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "מטבע העסק: $ דולר" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "מטבע העסק" });
  },
};
export const SettingsCurrencySheetDark: Story = { ...SettingsCurrencySheet, name: "Company currency sheet, dark", ...dark };

export const SettingsAssistantScope: Story = {
  name: "Assistant scope",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <AssistantSettings sample={{ state: "empty" }} sampleSecret={SAMPLE_ASSISTANT_SECRET} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוזר AI" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "חיבור עוזר AI" });
  },
};

export const SettingsAssistantSecret: Story = {
  name: "Assistant secret",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <AssistantSettings sample={{ state: "empty" }} sampleSecret={SAMPLE_ASSISTANT_SECRET} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const body = storyBody(canvasElement);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוזר AI" }));
    const sheet = await body.findByRole("dialog", { name: "חיבור עוזר AI" });
    await userEvent.click(within(sheet).getByRole("button", { name: "יצירת קוד" }));
    await body.findByRole("dialog", { name: "הקוד מוכן" });
  },
};

export const SettingsAssistantHelp: Story = {
  name: "Assistant help",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <AssistantSettings sample={{ state: "empty" }} sampleSecret={SAMPLE_ASSISTANT_SECRET} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const body = storyBody(canvasElement);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוזר AI" }));
    const sheet = await body.findByRole("dialog", { name: "חיבור עוזר AI" });
    await userEvent.click(within(sheet).getByRole("button", { name: "יצירת קוד" }));
    const ready = await body.findByRole("dialog", { name: "הקוד מוכן" });
    await userEvent.click(within(ready).getByRole("button", { name: "איך מחברים ב־Claude" }));
    await body.findByRole("dialog", { name: "איך מחברים ב־Claude" });
  },
};

export const SettingsAssistantUsed: Story = {
  name: "Assistant used",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <AssistantSettings
        sample={{ state: "connected", scope: "read_write", id: "mcp-1", lastUsedAt: "2026-09-30T11:05:00.000Z" }}
      />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוזר AI" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "עוזר AI" });
  },
};

export const SettingsAssistantUnused: Story = {
  name: "Assistant unused",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <AssistantSettings sample={{ state: "connected", scope: "read", id: "mcp-1", lastUsedAt: null }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוזר AI" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "עוזר AI" });
  },
};

const pagesLoans = [
  { id: "l1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 0, projectId: "p1", projectName: "וילה אלון" },
  { id: "l2", name: "הלוואת ציוד", currency: "ILS", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: "p2", projectName: "פרויקט גפן" },
];

export const SettingsPages: Story = {
  name: "Settings, connections and loans rows",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...pagesBusiness, loans: pagesLoans }} />
    </StoryRoute>
  ),
};
export const SettingsPages320: Story = { ...SettingsPages, name: "Settings, connections and loans rows, 320", ...at320 };
export const SettingsPagesDark: Story = { ...SettingsPages, name: "Settings, connections and loans rows, dark", ...dark };

export const SettingsAttention: Story = {
  name: "Settings, Mercury needs reconnecting",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...pagesBusiness, mercuryLastError: "auth", loans: pagesLoans }} />
    </StoryRoute>
  ),
};
export const SettingsAttention320: Story = { ...SettingsAttention, name: "Settings, Mercury needs reconnecting, 320", ...at320 };

export const SettingsHintsLoading: Story = {
  name: "Settings, hints loading",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <SettingsScreen sample={{ ...pagesBusiness, sumit: "loading", loans: "loading" }} />
    </StoryRoute>
  ),
};

export const SettingsViewer: Story = {
  name: "Settings, viewer",
  render: () => (
    <StoryRoute entry="/settings" tabs>
      <ExampleBar />
      <ViewerPreview>
        <SettingsScreen sample={{ ...pagesBusiness, loans: pagesLoans }} />
      </ViewerPreview>
    </StoryRoute>
  ),
};

export const Loans: Story = {
  name: "Loans",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <LoansScreen sample={{ ...pagesBusiness, loans: pagesLoans }} />
    </StoryRoute>
  ),
};
export const Loans320: Story = { ...Loans, name: "Loans, 320", ...at320 };
export const LoansDark: Story = { ...Loans, name: "Loans, dark", ...dark };
export const LoansDark320: Story = { ...Loans, name: "Loans, dark, 320", ...dark, ...at320 };

export const LoansEmpty: Story = {
  name: "Loans, empty",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <LoansScreen sample={{ ...pagesBusiness, loans: [] }} />
    </StoryRoute>
  ),
};
export const LoansEmpty320: Story = { ...LoansEmpty, name: "Loans, empty, 320", ...at320 };

export const LoansLoading: Story = {
  name: "Loans, loading",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <LoansScreen sample={{ ...pagesBusiness, loans: "loading" }} />
    </StoryRoute>
  ),
};
// FLOW-358: under 360px the loading rows drop the icon slot, as the loaded list does.
export const LoansLoading320: Story = { ...LoansLoading, name: "Loans, loading, 320", ...at320 };

export const LoansError: Story = {
  name: "Loans, error",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <LoansScreen sample={{ ...pagesBusiness, loans: "error" }} />
    </StoryRoute>
  ),
};

export const LoansViewer: Story = {
  name: "Loans, viewer",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <ViewerPreview>
        <LoansScreen sample={{ ...pagesBusiness, loans: pagesLoans }} />
      </ViewerPreview>
    </StoryRoute>
  ),
};
export const LoansViewer320: Story = { ...LoansViewer, name: "Loans, viewer, 320", ...at320 };

export const LoansEmptyViewer: Story = {
  name: "Loans, empty, viewer",
  render: () => (
    <StoryRoute entry="/settings/loans" tabs>
      <ExampleBar />
      <ViewerPreview>
        <LoansScreen sample={{ ...pagesBusiness, loans: [] }} />
      </ViewerPreview>
    </StoryRoute>
  ),
};

export const NotificationsLock: Story = {
  render: () => (
    <StoryRoute entry="/">
      <NotificationsLockFrame />
    </StoryRoute>
  ),
};
