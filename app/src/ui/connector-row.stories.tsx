import type { Meta, StoryObj } from "@storybook/react";
import { ConnectorRow } from "./connector-row";
import { BankIcon, DocumentIcon, SparkIcon, TagIcon } from "./icons";
import { List } from "./list-row";
import { longHebrew, padded } from "./story-support";

/** FLOW-501. One connector on the Connections page, in every state it has. */
function AllStates() {
  return (
    <List>
      <ConnectorRow title="SUMIT" icon={<DocumentIcon size={24} />} state="ready" hint="מחובר" onOpen={() => undefined} />
      <ConnectorRow title="Mercury" icon={<BankIcon size={24} />} state="ready" hint="צריך לחבר מחדש" warning onOpen={() => undefined} />
      <ConnectorRow title="תיוג חכם (Jev)" icon={<TagIcon size={24} />} state="loading" />
      <ConnectorRow
        title="עוזר AI"
        icon={<SparkIcon size={24} />}
        state="error"
        retry={{ hint: "לא הצלחנו לטעון", label: "ניסיון חוזר: עוזר AI", onRetry: () => undefined }}
      />
      <ConnectorRow title="SUMIT" icon={<DocumentIcon size={24} />} state="ready" hint="לא מחובר" />
      <ConnectorRow title="עוזר AI" icon={<SparkIcon size={24} />} state="ready" hint="אין עסק עדיין" ariaDisabled />
      <ConnectorRow title="Mercury" icon={<BankIcon size={24} />} state="ready" hint={longHebrew} onOpen={() => undefined} />
    </List>
  );
}

const meta = {
  title: "Components/ConnectorRow",
  component: ConnectorRow,
  decorators: [padded],
  args: { title: "SUMIT", icon: <DocumentIcon size={24} />, state: "ready", hint: "מחובר" },
} satisfies Meta<typeof ConnectorRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Owner: Story = { args: { onOpen: () => undefined } };
export const Viewer: Story = { name: "Viewer (static)" };
export const Reconnect: Story = { args: { hint: "צריך לחבר מחדש", warning: true, onOpen: () => undefined } };
export const Loading: Story = { args: { state: "loading" } };
export const ErrorRetry: Story = {
  name: "Error with retry",
  args: { state: "error", retry: { hint: "לא הצלחנו לטעון", label: "ניסיון חוזר: SUMIT", onRetry: () => undefined } },
};
export const NoCompany: Story = { args: { title: "עוזר AI", icon: <SparkIcon size={24} />, hint: "אין עסק עדיין", ariaDisabled: true } };
export const LongHint: Story = { args: { hint: longHebrew, onOpen: () => undefined } };

export const States: Story = { render: () => <AllStates /> };
export const StatesDark: Story = { globals: { theme: "dark" }, render: () => <AllStates /> };
export const States320: Story = { parameters: { viewport: { defaultViewport: "flow320" } }, render: () => <AllStates /> };
export const StatesDark320: Story = {
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <AllStates />,
};
