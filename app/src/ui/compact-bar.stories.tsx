import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { Amount } from "./amount";
import { CompactBar } from "./compact-bar";
import { GroupHead } from "./group-head";
import { IconButton } from "./icon-button";
import { List as Rows, ListRow } from "./list-row";
import { SegmentedControl } from "./segmented-control";
import { StatusMark } from "./status-mark";
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

/**
 * FLOW-1043: the bar docks a control. The dock row is always there, closed (0px, inert) until `docked`; open, the
 * bar grows by 60px and the sticky head under it moves down with it: 64 or 124 under the band bar, 44 or 104 under
 * a list bar. Invented rows.
 */
function Docking({ kind, docked }: { kind: "band" | "list"; docked: boolean }) {
  const [filter, setFilter] = useState("all");
  const control = (
    <SegmentedControl
      label="סינון תנועות"
      showLabel={false}
      tone={kind === "band" ? "band" : "page"}
      value={filter}
      onChange={setFilter}
      options={[
        { value: "all", label: "הכול" },
        { value: "fixed", label: "קבועים" },
        { value: "left", label: "נותר לשלם" },
      ]}
    />
  );
  return (
    <>
      {kind === "band" ? (
        <CompactBar
          title=""
          shown
          tone="band"
          centre={
            <button type="button" className="ui-compact-bar-centre ui-band-month-name">
              <span className="t-caption">נובמבר · עד היום</span>
              <span className="t-sheet">
                <bdi dir="ltr">$6,913</bdi>
              </span>
            </button>
          }
          dock={control}
          docked={docked}
        />
      ) : (
        <CompactBar title="קבועים" backTo="/" shown dock={control} docked={docked} />
      )}
      <div className="ui-page-pad">
        <section className="ui-month">
          <GroupHead id={`dock-${kind}`} title="נותר לשלם" summary="3 קבועים · $2,447" />
          <Rows>
            <ListRow variant="static" title="ארנונה" hint="צפוי ב-15" icon={<StatusMark kind="due" />} />
            <ListRow variant="static" title="משכנתא" hint="צפוי ב-20" icon={<StatusMark kind="due" />} />
            <ListRow variant="static" title="חשמל" hint="צפוי ב-22" icon={<StatusMark kind="due" />} />
          </Rows>
        </section>
      </div>
    </>
  );
}

/**
 * The sticky head's top settles at the bar's height plus its 1px line (the safe area is 0 here). The band bar has no
 * line, so its heads pin right at its edge (FLOW-1051).
 */
async function headTop(canvasElement: HTMLElement, px: number, line = 1) {
  const head = canvasElement.querySelector<HTMLElement>(".ui-group-head-line");
  await expect(head).not.toBeNull();
  await waitFor(() => expect(getComputedStyle(head as HTMLElement).top).toBe(`${String(px + line)}px`));
}

export const BandDockClosed: Story = {
  render: () => <Docking kind="band" docked={false} />,
  play: async ({ canvasElement }) => {
    await expect(document.documentElement).toHaveAttribute("data-compact-bar", "band");
    await expect(document.documentElement).not.toHaveAttribute("data-compact-dock");
    await expect(canvasElement.ownerDocument.querySelector(".ui-compact-dock")).toHaveAttribute("inert");
    await headTop(canvasElement, 64, 0);
  },
};

export const BandDocked: Story = {
  render: () => <Docking kind="band" docked />,
  play: async ({ canvasElement }) => {
    await expect(document.documentElement).toHaveAttribute("data-compact-dock", "on");
    await headTop(canvasElement, 124, 0);
  },
};

export const ListDockClosed: Story = {
  render: () => <Docking kind="list" docked={false} />,
  play: async ({ canvasElement }) => {
    await expect(document.documentElement).toHaveAttribute("data-compact-bar", "list");
    await headTop(canvasElement, 44);
  },
};

export const ListDocked: Story = {
  render: () => <Docking kind="list" docked />,
  play: async ({ canvasElement }) => {
    await expect(document.documentElement).toHaveAttribute("data-compact-dock", "on");
    await headTop(canvasElement, 104);
  },
};
