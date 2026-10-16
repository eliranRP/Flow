import type { Meta, StoryObj } from "@storybook/react";
import { Amount } from "./amount";
import { Chip } from "./chip";
import { CompactBar } from "./compact-bar";
import { IconButton } from "./icon-button";
import { OrganizeChips } from "./organize-chips";
import { ChevronDownIcon, OutwardChevron } from "./icons";
import { longHebrew } from "./story-support";

// Amounts are bigint, so the figure stays in render: story args go through JSON.

const meta = {
  title: "Components/CompactBar",
  component: CompactBar,
  tags: ["autodocs"],
  args: { title: "שויכו היום", backTo: "/review", shown: true, size: "list" },
  argTypes: {
    size: { control: "select", options: ["list", "detail"] },
    shown: { control: "boolean" },
  },
} satisfies Meta<typeof CompactBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A list page: Back (icon), the title, 44px. Invented rows. */
export const List: Story = {};

/** The parent's name as Back's label, "‹ הגדרות" (decision 0156). */
export const ListWithFigure: Story = {
  args: {
    title: "קטגוריות",
    label: "הגדרות",
    backTo: "/settings",
  },
  render: (args) => <CompactBar {...args} figure={<Amount agorot={125_000n} size="list" />} />,
};

/** A detail page: 56px. */
export const Detail: Story = {
  args: { title: "שיפוץ הרצל 12", label: "פרויקטים", backTo: "/projects", size: "detail" },
  render: (args) => <CompactBar {...args} figure={<Amount agorot={2_940_000n} size="list" />} />,
};

/** FLOW-363 (3c): the organize chips ride under the bar, so they stay one tap away once the page scrolls. */
export const Panel: Story = {
  args: { title: "יצא", label: "בית", backTo: "/" },
  render: (args) => (
    <CompactBar
      {...args}
      figure={<Amount agorot={125_000n} size="list" />}
      panel={
        <OrganizeChips label="סידור">
          <Chip kind="choice" pressed>לפי תאריך</Chip>
          <Chip kind="choice">לפי סכום</Chip>
          <Chip kind="choice">לפי פרויקט</Chip>
          <Chip kind="choice">לפי קטגוריה</Chip>
        </OrganizeChips>
      }
    />
  ),
};

/** Hidden from the start: no slide, no focus, no clicks. */
export const Hidden: Story = { args: { shown: false }, tags: ["clip-no-text"] };

export const LongHebrew: Story = {
  args: { title: longHebrew, label: longHebrew, backTo: "/projects" },
  render: (args) => <CompactBar {...args} figure={<Amount agorot={125_000n} size="list" />} />,
};

/** FLOW-364: Home's bar in the colour band. The arrows step the month; the centre opens the drawer. Invented figures. */
function HomeBar({ past = false }: { past?: boolean }) {
  return (
    <CompactBar
      title=""
      shown
      tone={past ? "band-past" : "band"}
      start={
        <IconButton label="חודש קודם" onBand>
          <OutwardChevron side="start" />
        </IconButton>
      }
      centre={
        <button type="button" className="ui-compact-bar-centre ui-band-month-name">
          <span className="t-caption">{past ? "חודש סגור" : "עד היום"}</span>
          <ChevronDownIcon size={10} />
          <span className="t-sheet">
            <bdi dir="ltr">1,234</bdi>
          </span>
        </button>
      }
      end={
        <IconButton label="חודש הבא" onBand>
          <OutwardChevron side="end" />
        </IconButton>
      }
    />
  );
}

export const Band: Story = { render: () => <HomeBar />, args: { title: "" } };

export const BandPast: Story = { render: () => <HomeBar past />, args: { title: "" } };
