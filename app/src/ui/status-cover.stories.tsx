import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { StoryRoute } from "./story-route";

/**
 * The status bar's room over what scrolls under it (owner's screenshot, 2026-11-07: rows passed under the clock,
 * above a month's pinned head). Open while the page's violet band is there; drawn once the band scrolls away.
 * The notch is simulated (--safe-top: 59px), as e2e/notch-header.spec.ts does.
 */
function Page() {
  return (
    <>
      <header className="ui-band" style={{ blockSize: 240 }} />
      <section className="ui-month">
        <h2 className="ui-month-head">אוגוסט</h2>
        {Array.from({ length: 40 }, (_, index) => (
          <p key={index} style={{ blockSize: 64, margin: 0 }}>{`שורה ${String(index + 1)}`}</p>
        ))}
      </section>
    </>
  );
}

const meta = {
  title: "Components/StatusCover",
  parameters: { flowRouter: false },
  render: () => (
    <StoryRoute entry="/" tabs>
      <Page />
    </StoryRoute>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const OverRowsOnceTheBandScrollsAway: Story = {
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    doc.documentElement.style.setProperty("--safe-top", "59px");
    const cover = doc.querySelector<HTMLElement>(".ui-status-cover");
    if (cover == null) throw new Error("no status cover");
    doc.defaultView?.scrollTo(0, 0);
    // The band is under the status bar: the room stays open, so the band's colour runs up to the top.
    await waitFor(() => expect(cover.hasAttribute("data-open")).toBe(true));
    await expect(cover.getBoundingClientRect().height).toBe(59);
    // Scrolled past the band, the rows pass under the cover, not under the clock.
    doc.defaultView?.scrollTo(0, 1200);
    await waitFor(() => expect(cover.hasAttribute("data-open")).toBe(false));
    await expect(getComputedStyle(cover).visibility).toBe("visible");
    doc.defaultView?.scrollTo(0, 0);
    doc.documentElement.style.removeProperty("--safe-top");
  },
};
