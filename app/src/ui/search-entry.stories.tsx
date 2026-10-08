import type { Meta, StoryObj } from "@storybook/react";
import { SearchEntry } from "./search-entry";

/** FLOW-323 option A: the thin outline magnifier on the Projects bar and on Home's band. */
const meta = {
  title: "Components/SearchEntry",
  component: SearchEntry,
  args: { to: "/search" },
} satisfies Meta<typeof SearchEntry>;

export default meta;
type Story = StoryObj<typeof meta>;

function OnPage() {
  return (
    <div className="ui-page">
      <div className="ui-page-title-row">
        <span className="ui-head-actions">
          <SearchEntry to="/search" />
        </span>
      </div>
    </div>
  );
}

function OnBand() {
  return (
    <header className="ui-band">
      <div className="ui-band-row">
        <SearchEntry to="/search" onBand />
      </div>
    </header>
  );
}

export const Page: Story = { tags: ["clip-no-text"], render: () => <OnPage /> };
export const PageDark: Story = { tags: ["clip-no-text"], globals: { theme: "dark" }, render: () => <OnPage /> };
export const Band: Story = { tags: ["clip-no-text"], render: () => <OnBand /> };
export const BandDark: Story = { tags: ["clip-no-text"], globals: { theme: "dark" }, render: () => <OnBand /> };
