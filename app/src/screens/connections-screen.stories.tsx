import type { Meta, StoryObj } from "@storybook/react";
import { ConnectionsScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ViewerPreview } from "../use-is-viewer";
import { ExampleBar, pagesBusiness } from "../ui/screen-stories-support";

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

const sumitBusiness = {
  name: "בית הספר אלון",
  email: "owner@example.com",
  companyId: 1001,
  lastError: null,
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

export const Connections: Story = {
  name: "Connections",
  render: () => (
    <StoryRoute entry="/settings/connections" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={pagesBusiness} />
    </StoryRoute>
  ),
};

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

export const ConnectionsNoCompany: Story = {
  name: "Connections, no company",
  render: () => (
    <StoryRoute entry="/settings/connections?preview=empty" tabs>
      <ExampleBar />
      <ConnectionsScreen sample={{ ...pagesBusiness, name: null, connected: false, companyId: null, mercuryConnected: false, noCompany: true, assistant: { state: "no-company" } }} />
    </StoryRoute>
  ),
};
