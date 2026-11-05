import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CompactBar } from "./compact-bar";
import { DockSlot, useDockedFilter } from "./dock-filter";
import { GroupHead } from "./group-head";
import { List, ListRow } from "./list-row";
import { useScrolledPast } from "./screen-header";
import { SegmentedControl } from "./segmented-control";
import { StatusMark } from "./status-mark";

/**
 * FLOW-1043: the filter docks into the band bar. The bar slides in once the page has scrolled 120px; when the
 * in-page filter reaches the bar, the bar grows by 60px to hold the same control and the in-page copy fades out
 * (keeping its height). A pick while docked scrolls the list's top under the bar. Invented rows.
 */
const FILTERS = [
  { value: "all", label: "הכול" },
  { value: "fixed", label: "קבועים" },
  { value: "left", label: "נותר לשלם" },
];

const GROUPS = [
  { id: "left", title: "נותר לשלם", summary: "8 קבועים · $2,780", mark: "due" as const },
  { id: "paid", title: "קבועים ששולמו", summary: "8 · $512 יצא", mark: "paid" as const },
  { id: "once", title: "חד-פעמי", summary: "8 · $1,536 יצא", mark: "once" as const },
];

function DockingPage() {
  const [bandMark, setBandMark] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(bandMark, true, 0);
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: 64 });
  const [filter, setFilter] = useState("all");
  const control = (onBand: boolean) => (
    <SegmentedControl
      label="סינון תנועות"
      showLabel={false}
      tone={onBand ? "band" : "page"}
      value={filter}
      options={FILTERS}
      onChange={(next) => {
        setFilter(next);
        scrollUnderBar();
      }}
    />
  );
  return (
    <>
      <CompactBar
        title=""
        shown={barShown}
        tone="band"
        centre={
          <button type="button" className="ui-compact-bar-centre ui-band-month-name">
            <span className="t-caption">נובמבר · עד היום</span>
            <span className="t-sheet">
              <bdi dir="ltr">$6,913</bdi>
            </span>
          </button>
        }
        dock={control(true)}
        docked={docked}
      />
      <div className="ui-page-pad">
        <p className="t-title" style={{ blockSize: "120px", margin: 0 }}>בית</p>
        <span ref={setBandMark} className="ui-compact-mark" />
        <p className="t-body" style={{ blockSize: "200px", margin: 0 }}>תזרים · עד היום</p>
        <span ref={markRef} className="ui-compact-mark" data-testid="dock-mark" />
        <DockSlot docked={docked}>{control(false)}</DockSlot>
        {GROUPS.map((group) => (
          <section key={group.id} className="ui-month">
            <GroupHead id={`dock-story-${group.id}`} title={group.title} summary={group.summary} />
            <List>
              {Array.from({ length: 8 }, (_, index) => (
                <ListRow key={index} variant="static" title={`חיוב ${String(index + 1)}`} hint="צפוי ב-15" icon={<StatusMark kind={group.mark} />} />
              ))}
            </List>
          </section>
        ))}
      </div>
    </>
  );
}

const meta = {
  title: "Components/DockFilter",
  component: DockSlot,
  args: { docked: false, children: null },
  render: () => <DockingPage />,
} satisfies Meta<typeof DockSlot>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At the top: the bar is up and the filter is in the page. */
export const Top: Story = {};

/** Scrolled: the filter docks. A pick in the bar scrolls the list's top to just under it, and the filter stays docked. */
export const DocksOnScroll: Story = {
  play: async ({ canvasElement }) => {
    window.scrollTo({ top: 500, behavior: "instant" });
    const dock = () => canvasElement.querySelector(".ui-compact-dock");
    await waitFor(() => expect(dock()).toHaveAttribute("data-open"));
    await expect(canvasElement.querySelector(".ui-dock-slot")).toHaveAttribute("data-docked");
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-compact-dock", "on"));
    await userEvent.click(within(dock() as HTMLElement).getByRole("radio", { name: "קבועים" }));
    const mark = canvasElement.querySelector<HTMLElement>("[data-testid='dock-mark']");
    await waitFor(() => expect(Math.round(mark?.getBoundingClientRect().top ?? 0)).toBe(63), { timeout: 3000 });
    await expect(dock()).toHaveAttribute("data-open");
    await expect(within(dock() as HTMLElement).getByRole("radio", { name: "קבועים" })).toHaveAttribute("aria-checked", "true");
    window.scrollTo({ top: 0, behavior: "instant" });
  },
};
