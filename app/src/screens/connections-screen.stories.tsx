import type { Meta, StoryObj } from "@storybook/react";
import { ConnectionsScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ViewerPreview } from "../use-is-viewer";
import { at320, dark, ExampleBar, pagesBusiness } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectionsAssistantConnected: Story = {
  name: "Assistant connected",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          name: "בית הספר אלון",
          connected: true,
          companyId: 1001,
          lastError: null,
          email: "owner@example.com",
          assistant: {
            state: "connected",
            scope: "read_write",
            lastUsedAt: "2026-09-30T11:05:00.000Z",
            id: "mcp-1",
          },
        }}
      />
    </StoryRoute>
  ),
};

const assistantBusiness = {
  name: "בית הספר אלון",
  connected: true,
  companyId: 1001,
  lastError: null as string | null,
  email: "owner@example.com",
};

export const ConnectionsAssistantEmpty: Story = {
  name: "Assistant empty",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...assistantBusiness, connected: false, companyId: null, assistant: { state: "empty" } }} />
    </StoryRoute>
  ),
};

export const ConnectionsAssistantLoading: Story = {
  name: "Assistant loading",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...assistantBusiness, assistant: { state: "loading" } }} />
    </StoryRoute>
  ),
};

export const ConnectionsAssistantError: Story = {
  name: "Assistant error",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...assistantBusiness, assistant: { state: "error" } }} />
    </StoryRoute>
  ),
};

export const ConnectionsAssistantMixed: Story = {
  name: "Assistant mixed",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          ...assistantBusiness,
          lastError: "sumit_auth",
          assistant: { state: "expired", scope: "read", id: "mcp-1" },
        }}
      />
    </StoryRoute>
  ),
};

export const ConnectionsAssistantExpired: Story = {
  name: "Assistant expired",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...assistantBusiness, assistant: { state: "expired", scope: "read", id: "mcp-1" } }} />
    </StoryRoute>
  ),
};

export const ConnectionsAssistantNoCompany: Story = {
  name: "Assistant no company",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...assistantBusiness, name: null, connected: false, companyId: null, noCompany: true, assistant: { state: "no-company" } }} />
    </StoryRoute>
  ),
};

export const ConnectionsConnected: Story = {
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          name: "בית הספר אלון",
          connected: true,
          companyId: 1001,
          lastError: null,
          email: "owner@example.com",
        }}
      />
    </StoryRoute>
  ),
};

export const ConnectionsSyncError: Story = {
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          name: "בית הספר אלון",
          connected: true,
          companyId: 1001,
          lastError: "sync_failed",
          email: "owner@example.com",
        }}
      />
    </StoryRoute>
  ),
};

export const ConnectionsBackoff: Story = {
  name: "Backoff",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          name: "בית הספר אלון",
          connected: true,
          companyId: 1001,
          lastError: "sumit_rejected",
          nextAttemptAt: "2099-01-01T10:00:00.000Z",
          email: "owner@example.com",
        }}
      />
    </StoryRoute>
  ),
};

export const ConnectionsAuth: Story = {
  name: "Auth",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          name: "בית הספר אלון",
          connected: true,
          companyId: 1001,
          lastError: "sumit_auth",
          email: "owner@example.com",
        }}
      />
    </StoryRoute>
  ),
};

const sumitBusiness = {
  name: "בית הספר אלון",
  email: "owner@example.com",
  companyId: 1001,
  lastError: null,
};

export const ConnectionsSumitConnected: Story = {
  name: "SUMIT connected",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, connected: true, lastSyncAt: "2026-10-03T09:05:00.000Z" }} />
    </StoryRoute>
  ),
};

export const ConnectionsSumitDisconnected: Story = {
  name: "SUMIT disconnected",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, connected: false, companyId: null }} />
    </StoryRoute>
  ),
};

export const ConnectionsSumitNoCompany: Story = {
  name: "SUMIT no company",
  render: () => (
    <StoryRoute entry="/settings/connections?preview=empty" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, name: null, connected: false, companyId: null, noCompany: true }} />
    </StoryRoute>
  ),
};

export const ConnectionsSumitReconnect: Story = {
  name: "SUMIT reconnect",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, connected: true, lastError: "sumit_auth" }} />
    </StoryRoute>
  ),
};

export const ConnectionsSumitError: Story = {
  name: "SUMIT error",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, connected: false, companyId: null, sumit: "error" }} />
    </StoryRoute>
  ),
};

export const ConnectionsSumitLoading: Story = {
  name: "SUMIT loading",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...sumitBusiness, connected: false, companyId: null, sumit: "loading" }} />
    </StoryRoute>
  ),
};

const mercuryBusiness = {
  name: "בית הספר אלון",
  email: "owner@example.com",
  companyId: 1001,
  lastError: null,
  connected: true,
  mercuryConnected: false,
  mercuryLastError: null,
};

export const ConnectionsMercuryConnected: Story = {
  name: "Mercury connected",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...mercuryBusiness, mercuryConnected: true, mercuryLastSyncAt: "2026-10-03T09:05:00.000Z" }} />
    </StoryRoute>
  ),
};

export const ConnectionsMercuryDisconnected: Story = {
  name: "Mercury disconnected",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...mercuryBusiness, mercuryConnected: false }} />
    </StoryRoute>
  ),
};

export const ConnectionsMercuryReconnect: Story = {
  name: "Mercury reconnect",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...mercuryBusiness, mercuryConnected: false, mercuryLastError: "auth" }} />
    </StoryRoute>
  ),
};

export const ConnectionsMercuryError: Story = {
  name: "Mercury error",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...mercuryBusiness, mercuryConnected: false, mercury: "error" }} />
    </StoryRoute>
  ),
};

export const ConnectionsMercuryLoading: Story = {
  name: "Mercury loading",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...mercuryBusiness, mercuryConnected: false, mercury: "loading" }} />
    </StoryRoute>
  ),
};

export const Connections: Story = {
  name: "Connections",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={pagesBusiness} />
    </StoryRoute>
  ),
};
export const Connections320: Story = { ...Connections, name: "Connections, 320", ...at320 };
export const ConnectionsDark: Story = { ...Connections, name: "Connections, dark", ...dark };

export const ConnectionsReconnect: Story = {
  name: "Connections, reconnect",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...pagesBusiness, mercuryLastError: "auth", assistant: { state: "expired", scope: "read", id: "mcp-1" } }} />
    </StoryRoute>
  ),
};

export const ConnectionsLoading: Story = {
  name: "Connections, loading",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          ...pagesBusiness,
          sumit: "loading",
          mercury: "loading",
          jev: { ...pagesBusiness.jev, status: "loading" },
          assistant: { state: "loading" },
        }}
      />
    </StoryRoute>
  ),
};

export const ConnectionsError: Story = {
  name: "Connections, error",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen
        sample={{
          ...pagesBusiness,
          sumit: "error",
          mercury: "error",
          jev: { ...pagesBusiness.jev, status: "error" },
          assistant: { state: "error" },
        }}
      />
    </StoryRoute>
  ),
};
export const ConnectionsError320: Story = { ...ConnectionsError, name: "Connections, error, 320", ...at320 };

export const ConnectionsViewer: Story = {
  name: "Connections, viewer",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ViewerPreview>
        <ConnectionsScreen sample={pagesBusiness} />
      </ViewerPreview>
    </StoryRoute>
  ),
};

/** FLOW-507: a viewer can't reconnect, so expired keys read "לא מחובר כרגע" with no warning tone. */
export const ConnectionsViewerReconnect: Story = {
  name: "Connections, viewer, reconnect",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ViewerPreview>
        <ConnectionsScreen sample={{ ...pagesBusiness, lastError: "sumit_auth", mercuryLastError: "auth", assistant: { state: "expired", scope: "read", id: "mcp-1" } }} />
      </ViewerPreview>
    </StoryRoute>
  ),
};
export const ConnectionsViewerReconnectDark: Story = { ...ConnectionsViewerReconnect, name: "Connections, viewer, reconnect, dark", ...dark };

export const ConnectionsNoCompany: Story = {
  name: "Connections, no company",
  render: () => (
    <StoryRoute entry="/settings/connections?preview=empty" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...pagesBusiness, name: null, connected: false, companyId: null, mercuryConnected: false, noCompany: true, assistant: { state: "no-company" } }} />
    </StoryRoute>
  ),
};
