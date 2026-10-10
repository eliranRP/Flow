import type { Meta, StoryObj } from "@storybook/react";
import { BandCompany } from "./band-company";
import { SearchEntry } from "./search-entry";
import { TopBand } from "./top-band";

/** FLOW-601 (mockup a-3): the company's name on Home's band, which opens the חברה sheet. */
function Band({ name }: { name: string }) {
  return (
    <TopBand wordmark={false} leading={<BandCompany name={name} onOpen={() => undefined} />} trailing={<SearchEntry to="/search" onBand />} />
  );
}

const meta = {
  title: "Components/BandCompany",
  component: Band,
  parameters: { flowRouter: true },
  args: { name: "חברה לדוגמה" },
} satisfies Meta<typeof Band>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const LongName: Story = { args: { name: "חברת השקעות ונכסים לדוגמה מהמרכז והשפלה בע״מ" } };
export const Dark: Story = { globals: { theme: "dark" } };
export const At320: Story = { ...LongName, name: "320", parameters: { flowRouter: true, viewport: { defaultViewport: "flow320" } } };
