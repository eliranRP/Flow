import type { Meta, StoryObj } from "@storybook/react";
import { TabBar } from "./tab-bar";
import { Toast } from "./toast";

const meta = {
  title: "Components/Toast",
  component: Toast,
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

function AboveBar(props: { children: string; action: string; tone?: "ok" | "bad" }) {
  return (
    <div className="relative min-h-dvh">
      <div className="ui-toast-host">
        <Toast action={props.action} onAction={() => undefined} tone={props.tone}>
          {props.children}
        </Toast>
      </div>
      <TabBar />
    </div>
  );
}

export const Undo: Story = {
  args: { children: "הפריט אושר", action: "ביטול" },
  render: () => <AboveBar action="ביטול">הפריט אושר</AboveBar>,
};
export const ErrorRetry: Story = {
  args: { children: "לא נשמר", action: "ניסיון חוזר", tone: "bad" },
  render: () => (
    <AboveBar action="ניסיון חוזר" tone="bad">
      לא נשמר
    </AboveBar>
  ),
};
