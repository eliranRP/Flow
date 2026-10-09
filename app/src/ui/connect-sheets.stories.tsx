import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { MercuryConnectSheet } from "./mercury-connect-sheet";
import { SumitConnectSheet } from "./sumit-connect-sheet";
import { padded } from "./story-support";

function MercuryDemo({ busy = false, initialKey = "", initialFrom = null }: { busy?: boolean; initialKey?: string; initialFrom?: string | null }) {
  const [apiKey, setApiKey] = useState(initialKey);
  const [importFrom, setImportFrom] = useState(initialFrom);
  return (
    <MercuryConnectSheet open onOpenChange={() => undefined} title="חיבור Mercury" apiKey={apiKey} setApiKey={setApiKey}
      importFrom={importFrom} setImportFrom={setImportFrom} submitLabel="חיבור" busy={busy} onSubmit={() => undefined} />
  );
}

function SumitDemo({ initialFrom = null }: { initialFrom?: string | null }) {
  const [companyId, setCompanyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [importFrom, setImportFrom] = useState(initialFrom);
  return (
    <SumitConnectSheet open onOpenChange={() => undefined} title="חיבור SUMIT" companyId={companyId} setCompanyId={setCompanyId}
      apiKey={apiKey} setApiKey={setApiKey} importFrom={importFrom} setImportFrom={setImportFrom}
      submitLabel="חיבור" busy={false} onSubmit={() => undefined} />
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

/** FLOW-505 B: "ייבוא מ" with מתאריך on shows the day under it. */
export const MercuryImportFromDate: Story = {
  render: () => <MercuryDemo initialKey="sample-token-12" initialFrom="2026-01-01" />,
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog", { name: "חיבור Mercury" });
    await expect(within(dialog).getByRole("radio", { name: "מתאריך" })).toHaveAttribute("aria-checked", "true");
    await expect(within(dialog).getByRole("button", { name: "תאריך ייבוא: 01/01/2026" })).toBeInTheDocument();
  },
};

export const MercuryImportFromDateDark: Story = {
  render: () => <MercuryDemo initialKey="sample-token-12" initialFrom="2026-01-01" />,
  globals: { theme: "dark" },
};

/** מההתחלה hides the day; מתאריך brings it back. */
export const SumitImportFromToggle: Story = {
  render: () => <SumitDemo />,
  parameters: { viewport: { defaultViewport: "flow320" } },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog", { name: "חיבור SUMIT" });
    await expect(within(dialog).queryByRole("button", { name: /תאריך ייבוא/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole("radio", { name: "מתאריך" }));
    await expect(within(dialog).getByRole("button", { name: /^תאריך ייבוא: 01\/01\/\d{4}$/ })).toBeInTheDocument();
  },
};

/** FLOW-350: with מתאריך on, חיבור stays pinned in the sheet's foot at 320 and 375x667. */
const pinnedPlay: Story["play"] = async ({ canvasElement }) => {
  const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog", { name: "חיבור SUMIT" });
  const submit = within(dialog).getByRole("button", { name: "חיבור" });
  // Pinned in the foot, outside the scrolling form (the shots check it is in view at each size).
  await expect(submit.closest(".ui-sheet-foot")).not.toBeNull();
  await expect(submit.closest("form")).toBeNull();
};

export const SumitImportFromDate320: Story = {
  render: () => <SumitDemo initialFrom="2026-01-01" />,
  parameters: { viewport: { defaultViewport: "flow320" } },
  play: pinnedPlay,
};

export const SumitImportFromDateSe: Story = {
  render: () => <SumitDemo initialFrom="2026-01-01" />,
  parameters: { viewport: { defaultViewport: "flow375-se" } },
  play: pinnedPlay,
};

export const SumitImportFromDateDark320: Story = {
  render: () => <SumitDemo initialFrom="2026-01-01" />,
  parameters: { viewport: { defaultViewport: "flow320" } },
  globals: { theme: "dark" },
};
