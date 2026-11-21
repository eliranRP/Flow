import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { attentionRows, CashHome } from "./HomeScreen";
import { sampleCashMonths, sampleCashToDay } from "../dev/cash-sample";
import { homeActivityLines } from "../dev/home-activity-sample";
import type { HomeActivityData } from "./home-activity";
import { RECURRING_FIXTURE } from "../recurring-sample";
import { israelToday } from "../ui/date-math";
import { StoryRoute } from "../ui/story-route";
import { BandCompany } from "../ui/top-band";
import { exampleOnBand } from "../ui/screen-stories-support";

// FLOW-1246, FLOW-1247: the named late rows. They sit in their own file so home-screen.stories.tsx stays under the line limit.

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Home with one late bill and one late income, each named by its party; the band counts the two. Invented names and figures. */
function LateNamedHome({ expense, income }: { expense: string; income: string }) {
  const currentKey = israelToday().slice(0, 7);
  // Storage blocked or empty: the story shows every row. Clears hidden rows a story before it may have set.
  useState(() => {
    try {
      window.localStorage.removeItem("flow.attention.home");
    } catch {
      // Storage blocked: nothing to clear.
    }
    return null;
  });
  const activity: HomeActivityData = {
    schedule: RECURRING_FIXTURE.map((row) => ({ ...row, currency: "ILS" })),
    scheduleFailed: false,
    lines: homeActivityLines(currentKey, { currency: "ILS" }),
    linesFailed: false,
    onRetry: () => undefined,
  };
  return (
    <StoryRoute entry="/" tabs>
      <CashHome
        data={sampleCashMonths()}
        monthKey={currentKey}
        currentKey={currentKey}
        previewing={false}
        search=""
        attention={attentionRows({
          pending: 0,
          transfers: 2,
          unpaidCount: 3,
          unpaidGross: 460_000n,
          missingCount: 1,
          missingIncome: 1,
          missingName: expense,
          missingIncomeName: income,
          missingTarget: { partyId: "s-water", projectId: null },
          missingIncomeTarget: { partyId: "c-rent", projectId: null },
          search: "",
        })}
        activity={activity}
        example={exampleOnBand}
        onStepMonth={() => undefined}
        sameDay={sampleCashToDay()}
        lateRecurring={2}
        withForecast
        company={<BandCompany name="Acme Test Co" onOpen={() => undefined} />}
      />
    </StoryRoute>
  );
}

/** FLOW-1246, FLOW-1247: one late bill and one late income at 393. Each row names its party and is one line; each opens its own charge (the count is 2 on the band). */
export const HomeLateNamed: Story = {
  globals: { viewport: { value: "flow393", isRotated: false } },
  // "שוכר דירה" (217px at 13px) fits the 221px title box; "שוכר לדוגמה" (231px) would take two lines.
  render: () => <LateNamedHome expense="מים טובים" income="שוכר דירה" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bill = await canvas.findByRole("link", { name: /החשבון של מים טובים לא הגיע/ });
    const income = canvas.getByRole("link", { name: /התנועה הקבועה של שוכר דירה לא הגיעה/ });
    await expect(bill).toHaveAttribute("href", "/recurring/expense/s-water");
    await expect(income).toHaveAttribute("href", "/recurring/income/c-rent");
    // A typical name fits one line at 393 (the 13px caption role), so the card is its normal height.
    // The title's text, after the webfont has loaded: one line tall. The element's own box can be taller than its text.
    await document.fonts.ready;
    for (const link of [bill, income]) {
      const text = link.querySelector<HTMLElement>(".ui-attn-text");
      if (text == null) throw new Error("a named row has no title");
      const range = document.createRange();
      range.selectNodeContents(text);
      await expect(range.getBoundingClientRect().height).toBeLessThanOrEqual(parseFloat(getComputedStyle(text).lineHeight) + 1);
    }
    await expect((await canvas.findByRole("link", { name: "קבועים, 2 לא הגיעו" })).querySelector(".ui-band-count")?.textContent).toBe("2");
  },
};

/** FLOW-1246: very long party names. The name ends in "…" so the title keeps to 2 lines and ends with its verb. */
export const HomeLateNamedLong: Story = {
  render: () => <LateNamedHome expense="החברה הארצית לאספקת מים ושירותי ביוב לדוגמה בעירבון מוגבל" income="שוכר לדוגמה עם שם ארוך מאוד של חברה ושל שותפים" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement), part = (root: Element, selector: string) => { const el = root.querySelector<HTMLElement>(selector); if (el == null) throw new Error(`no ${selector}`); return el; };
    for (const link of [await canvas.findByRole("link", { name: /^החשבון של .+ לא הגיע$/ }), canvas.getByRole("link", { name: /^התנועה הקבועה של .+ לא הגיעה$/ })]) {
      const item = link.closest("li");
      if (item == null) throw new Error("a named row has no list item");
      const card = part(item, ".ui-attn-card"), text = part(item, ".ui-attn-text"), name = part(item, ".ui-attn-name");
      // A finite cap (so dismissing folds to 0) that the card fits; two lines at most, uncut; the name ends in "…" in its own box.
      await expect(getComputedStyle(item).maxBlockSize).toMatch(/^\d+(\.\d+)?px$/);
      await expect(card.offsetHeight + parseFloat(getComputedStyle(card).marginBlockEnd)).toBeLessThanOrEqual(item.clientHeight);
      await expect(text.getBoundingClientRect().height).toBeLessThanOrEqual(parseFloat(getComputedStyle(text).lineHeight) * 2 + 1);
      await expect(text.scrollHeight).toBeLessThanOrEqual(text.clientHeight + 1);
      await expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
      await expect(getComputedStyle(name).textOverflow).toBe("ellipsis");
    }
  },
};
