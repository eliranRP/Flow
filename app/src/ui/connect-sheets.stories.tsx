import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { MercuryConnectSheet } from "./mercury-connect-sheet";
import { SumitConnectSheet } from "./sumit-connect-sheet";
import { padded } from "./story-support";

function MercuryDemo({ busy = false, initialKey = "" }: { busy?: boolean; initialKey?: string }) {
  const [apiKey, setApiKey] = useState(initialKey);
  return (
    <MercuryConnectSheet open onOpenChange={() => undefined} title="חיבור Mercury" apiKey={apiKey} setApiKey={setApiKey}
      submitLabel="חיבור" busy={busy} onSubmit={() => undefined} />
  );
}

function SumitDemo() {
  const [companyId, setCompanyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  return (
    <SumitConnectSheet open onOpenChange={() => undefined} title="חיבור SUMIT" companyId={companyId} setCompanyId={setCompanyId}
      apiKey={apiKey} setApiKey={setApiKey} submitLabel="חיבור" busy={false} onSubmit={() => undefined} />
  );
}

const meta = {
  title: "Components/ConnectSheets",
  decorators: [padded],
  parameters: { viewport: { defaultViewport: "flow390-short" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** FLOW-508: the message line is reserved, so the button does not move when a message shows. */
export const MercuryEmpty: Story = { render: () => <MercuryDemo /> };

export const MercuryMissingKey: Story = {
  render: () => <MercuryDemo />,
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog", { name: "חיבור Mercury" });
    await userEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await expect(within(dialog).getByText("חסר מפתח.")).toBeInTheDocument();
    await expect(within(dialog).getByLabelText("מפתח API")).toHaveFocus();
  },
};

export const MercuryBusy: Story = {
  render: () => <MercuryDemo busy initialKey="sample-token-12" />,
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog", { name: "חיבור Mercury" });
    await expect(within(dialog).getByLabelText("מפתח API")).toHaveAttribute("readonly");
  },
};

export const SumitMissingFields: Story = {
  render: () => <SumitDemo />,
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog", { name: "חיבור SUMIT" });
    await userEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await expect(within(dialog).getByText("חסר מספר חברה.")).toBeInTheDocument();
    await expect(within(dialog).getByText("חסר מפתח.")).toBeInTheDocument();
    await expect(within(dialog).getByLabelText("מספר חברה")).toHaveFocus();
  },
};
