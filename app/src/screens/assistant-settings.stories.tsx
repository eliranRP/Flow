import type { Meta, StoryObj } from "@storybook/react";
import { SAMPLE_ASSISTANT_SECRET } from "../assistant-sample";
import { StoryRoute } from "../ui/story-route";
import { ViewerPreview } from "../use-is-viewer";
import { ExampleBar } from "../ui/screen-stories-support";
import { AiConnectionPage } from "./assistant-settings";

/** FLOW-512: the חיבור ל־AI (MCP) page. Invented data only: the secret is the sample one. */
const meta = {
  title: "Screens/AI connection",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function page(props: Parameters<typeof AiConnectionPage>[0], entry = "/settings/connections/ai") {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <AiConnectionPage {...props} />
    </StoryRoute>
  );
}

export const Setup: Story = {
  name: "Setup",
  render: () => page({ sample: { state: "empty" }, sampleSecret: SAMPLE_ASSISTANT_SECRET }),
};

export const SetupChatGpt: Story = {
  name: "Setup, ChatGPT",
  render: () => page({ sample: { state: "empty" }, sampleSecret: SAMPLE_ASSISTANT_SECRET, initialClient: "chatgpt" }),
};

export const CodeReadyClaudeCode: Story = {
  name: "Code ready, Claude Code",
  render: () => page({
    sample: { state: "empty" },
    initialSecret: { id: "mcp-sample", secret: SAMPLE_ASSISTANT_SECRET, scope: ["read", "write"] },
    initialClient: "claude-code",
  }),
};

export const CodeReadyOther: Story = {
  name: "Code ready, other assistant",
  render: () => page({
    sample: { state: "empty" },
    initialSecret: { id: "mcp-sample", secret: SAMPLE_ASSISTANT_SECRET, scope: ["read"] },
    initialClient: "other",
  }),
};

export const Connected: Story = {
  name: "Connected",
  render: () => page({
    sample: { state: "connected", scope: "read_write", id: "mcp-1", lastUsedAt: "2026-09-30T11:05:00.000Z", expiresAt: "2027-01-14T00:00:00.000Z" },
  }),
};

export const Expired: Story = {
  name: "Expired",
  render: () => page({ sample: { state: "expired", scope: "read_write", id: "mcp-1", expiresAt: "2026-07-01T00:00:00.000Z" } }),
};

export const ReadScope: Story = {
  name: "Connected, read only",
  render: () => page({ sample: { state: "connected", scope: "read", id: "mcp-1", lastUsedAt: null } }),
};

export const ViewerNote: Story = {
  name: "Viewer",
  render: () => (
    <StoryRoute entry="/settings/connections/ai" tabs>
      <ExampleBar />
      <ViewerPreview>
        <AiConnectionPage sample={{ state: "empty" }} />
      </ViewerPreview>
    </StoryRoute>
  ),
};
