import type { Meta, StoryObj } from "@storybook/react";
import { SAMPLE_ASSISTANT_KEYS, SAMPLE_ASSISTANT_SECRET, SAMPLE_EXPIRED_KEY } from "../assistant-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { AiConnectionPage } from "./assistant-settings";

/** FLOW-512, FLOW-939: the חיבור ל־AI (MCP) page and its keys. Invented data only: the secret is the sample one. */
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

const connected = { state: "connected", keys: SAMPLE_ASSISTANT_KEYS } as const;

export const Setup: Story = {
  name: "Setup",
  render: () => page({ sample: { state: "empty" }, sampleSecret: SAMPLE_ASSISTANT_SECRET }),
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

/** Board SettingsMcpKeys: the list once there is a key. */
export const Keys: Story = {
  name: "Keys",
  render: () => page({ sample: connected, sampleSecret: SAMPLE_ASSISTANT_SECRET }),
};

/** Board SettingsMcpKey: one key's page. */
export const OneKey: Story = {
  name: "One key",
  render: () => page({ sample: connected }, "/settings/connections/ai/key/mcp-key-1"),
};

/** Board SettingsMcpNewKey: a new key's setup, with its name on top. */
export const NewKey: Story = {
  name: "New key",
  render: () => page({ sample: connected, sampleSecret: SAMPLE_ASSISTANT_SECRET }, "/settings/connections/ai/new"),
};

export const Expired: Story = {
  name: "Expired",
  render: () => page({ sample: { state: "expired", keys: [SAMPLE_EXPIRED_KEY] } }),
};
