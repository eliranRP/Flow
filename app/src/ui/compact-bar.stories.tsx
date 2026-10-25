import type { Meta, StoryObj } from "@storybook/react-vite";
import { Amount } from "./amount";
import { CompactBar } from "./compact-bar";
import { IconButton } from "./icon-button";
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

/** A detail page: 56px. */
export const Detail: Story = {
  args: { title: "שיפוץ הרצל 12", label: "פרויקטים", backTo: "/projects", size: "detail" },
  render: (args) => <CompactBar {...args} figure={<Amount agorot={2_940_000n} size="list" />} />,
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
