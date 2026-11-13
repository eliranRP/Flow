import type { Meta, StoryObj } from "@storybook/react-vite";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { MEMBER_PROJECTION_INPUTS, MEMBER_REPORT } from "../dev/member-report-sample";
import { OFFLINE_WAIT_WORDS } from "../ui/offline-wait";
import { StoryRoute } from "../ui/story-route";
import type { MemberProjectionInputs, MemberReportRead } from "../use-member-report";
import { MemberReportScreen } from "./member-report-screen";

/**
 * FLOW-1127 (FLOW-1125's mockup A, C and D, approved 2026-11-09): דוח שותף's תחזית tab. The refinance year, the
 * bars, the refinance then with the member's part, the cash flow until then, a property year by year, the
 * assumptions, a viewer, a property left out, and the skeleton while it loads (FLOW-1136).
 */
const meta = {
  title: "Screens/Member report/Forecast",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Report({ entry = "/reports/member?mode=forecast", sample = MEMBER_REPORT, inputs = MEMBER_PROJECTION_INPUTS, loading = false, offline = false }: {
  entry?: string;
  sample?: MemberReportRead;
  inputs?: MemberProjectionInputs;
  /** The forecast's inputs never arrive: the tab stays on its skeleton (FLOW-1136). */
  loading?: boolean;
  /** Offline with a read waiting for the connection (FLOW-1150). */
  offline?: boolean;
}) {
  return (
    <StoryRoute entry={entry} tabs>
      {offline ? <PausedOffline /> : null}
      <MemberReportScreen sample={sample} projectionSample={loading ? undefined : inputs} />
    </StoryRoute>
  );
}

function body(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

/** An element's computed background as 0–255 sRGB channels: rgb() or the color(srgb …) a color-mix() computes to. */
function fill(el: Element | null): number[] {
  const value = el == null ? "" : getComputedStyle(el).backgroundColor;
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(value);
  if (srgb != null) return srgb.slice(1).map((c) => Number(c) * 255);
  const rgb = /^rgba?\((\d+), (\d+), (\d+)/.exec(value);
  if (rgb != null) return rgb.slice(1).map(Number);
  throw new Error(`no fill: ${value}`);
}

/** WCAG 2 contrast between two sRGB fills. */
function ratio(a: number[], b: number[]): number {
  const lum = (c: number[]) => {
    const [r = 0, g = 0, bl = 0] = c.map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export const Forecast: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("tab", { name: "תחזית", selected: true })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { level: 1 }).textContent).toBe("סה״כ ל־Member A מריפייננס ב־2036");
    const calc = await canvas.findByRole("list", { name: "החישוב" });
    await expect(calc.textContent).toContain("כסף שמשתחרר לשותפים");
    await expect(calc.textContent).toContain("הלוואות של Member A");
    const figure = canvas.getByRole("figure", { name: /ההון ויתרת ההלוואות בכל שנה עד 2036/ });
    // FLOW-1149: a key per kind of bar, the year in words, and each year's figures for a screen reader.
    await expect(figure.querySelector(".ui-msr-bars-legend")?.textContent).toBe("הוןיתרת הלוואותשנת הריפייננס");
    // FLOW-1179: the equity bars reach 3:1 on the card, part from the loan and the refinance year, and the keys match.
    const card = fill(figure);
    const equity = fill(figure.querySelector(".ui-msr-bar:not([data-on]) .ui-msr-bar-equity"));
    const loan = fill(figure.querySelector(".ui-msr-bar-loan"));
    const refi = fill(figure.querySelector(".ui-msr-bar[data-on] .ui-msr-bar-equity"));
    await expect(ratio(equity, card)).toBeGreaterThanOrEqual(3);
    await expect(ratio(loan, card)).toBeGreaterThanOrEqual(3);
    await expect(ratio(equity, refi)).toBeGreaterThanOrEqual(1.5);
    await expect(equity).not.toEqual(loan);
    await expect(fill(figure.querySelector(".ui-msr-key-equity"))).toEqual(equity);
    await expect(fill(figure.querySelector(".ui-msr-key-loan"))).toEqual(loan);
    await expect(fill(figure.querySelector(".ui-msr-key-refi"))).toEqual(refi);
    const table = within(figure).getByRole("table");
    await expect(within(table).getAllByRole("row")).toHaveLength(11);
    await expect(within(table).getByRole("rowheader", { name: "2036 · שנת הריפייננס" })).toBeInTheDocument();
    const years = canvas.getByRole("spinbutton", { name: "ריפייננס בעוד" });
    await expect(years).toHaveTextContent("10 שנים");
    await expect(years).toHaveAccessibleDescription("2036");
    // The hidden table takes no width: the page never scrolls sideways.
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    await expect(canvas.getByRole("list", { name: "עד אז" }).textContent).toContain("הריבית הצפויה היום, לא תחזית");
  },
};

export const FiveYears: Story = {
  render: () => <Report entry="/reports/member?mode=forecast&years=5" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { level: 1, name: "סה״כ ל־Member A מריפייננס ב־2031" })).toBeInTheDocument();
    await userEvent.click(await canvas.findByRole("button", { name: /^יותר, ריפייננס בעוד/ }));
    await waitFor(async () => { await expect(canvas.getByRole("heading", { level: 1 }).textContent).toBe("סה״כ ל־Member A מריפייננס ב־2032"); });
  },
};

export const ForecastRowsOpen: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    const calc = within(await within(canvasElement).findByRole("list", { name: "החישוב" }));
    await userEvent.click(calc.getByRole("button", { name: /הלוואה חדשה/ }));
    const dialog = within(await body(canvasElement).findByRole("dialog", { name: "הלוואה חדשה" }));
    await expect(dialog.getAllByText(/75% ×/).length).toBeGreaterThan(0);
  },
};

export const ForecastProperty: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /Birch Lane/ }));
    const dialog = within(await body(canvasElement).findByRole("dialog", { name: "Birch Lane" }));
    // Year 1 (2027): $3,100 a month, the repairs left out, the costs on their own lines.
    const statement = dialog.getByRole("list", { name: "Birch Lane · 2027" });
    await expect(statement.textContent).toContain("37,200");
    await expect(statement.textContent).toContain("ביטוח");
    await expect(statement.textContent).toContain("NOI");
  },
};

export const ForecastAssumptions: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "הנחות התחזית" }));
    const sheet = within(await body(canvasElement).findByRole("dialog", { name: "הנחות התחזית" }));
    await expect(sheet.getByLabelText("שכירות")).toHaveValue("3");
    await expect(sheet.getByLabelText("ביטוח")).toHaveValue("5");
    await expect(sheet.getByLabelText("Repairs")).toHaveValue("repairs");
    await userEvent.clear(sheet.getByLabelText("שכירות"));
    await userEvent.type(sheet.getByLabelText("שכירות"), "4");
    const rentYears = sheet.getByRole("button", { name: "שכירות: שינוי שונה לשנה מסוימת" });
    await userEvent.click(rentYears);
    await expect(rentYears).toHaveAttribute("aria-expanded", "true");
    await userEvent.type(sheet.getByLabelText("שנה 2"), "8");
    // The rent's calendar stays marked: one of its years has its own change.
    await expect(sheet.getByRole("button", { name: "שכירות: שינוי שונה לשנה מסוימת · יש שנים שונות" })).toHaveAttribute("data-on");
    await userEvent.click(sheet.getByRole("button", { name: "שמירה" }));
    await expect(await body(canvasElement).findByText("הנחות התחזית נשמרו")).toBeInTheDocument();
    await waitFor(async () => { await expect(canvas.getByText(/שכירות 4% בשנה/)).toBeInTheDocument(); });
  },
};

/** FLOW-1148: bad values say so under their fields; שמירה opens the years that hold one and moves to the first. */
export const ForecastAssumptionsBadValue: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "הנחות התחזית" }));
    const sheet = within(await body(canvasElement).findByRole("dialog", { name: "הנחות התחזית" }));
    const years = sheet.getByRole("button", { name: "ביטוח: שינוי שונה לשנה מסוימת" });
    await userEvent.click(years);
    await userEvent.type(sheet.getByLabelText("שנה 4"), "x");
    await userEvent.click(years);
    await userEvent.type(sheet.getByLabelText("רזרבה ל־CapEx"), "abc");
    const save = sheet.getByRole("button", { name: "שמירה" });
    await expect(save).toBeEnabled();
    await userEvent.click(save);
    const year = sheet.getByLabelText("שנה 4");
    await waitFor(async () => { await expect(year).toHaveFocus(); });
    await expect(year).toHaveAccessibleDescription("ערך לא תקין");
    await expect(sheet.getByLabelText("רזרבה ל־CapEx")).toHaveAccessibleDescription("ערך לא תקין");
  },
};

export const ForecastViewer: Story = {
  render: () => <Report sample={{ ...MEMBER_REPORT, canEdit: false }} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "הנחות התחזית" }));
    const sheet = within(await body(canvasElement).findByRole("dialog", { name: "הנחות התחזית" }));
    await expect(sheet.getByLabelText("שכירות")).toBeDisabled();
    await expect(sheet.queryByRole("button", { name: "שמירה" })).toBeNull();
  },
};

export const ForecastLeftOut: Story = {
  render: () => (
    <Report inputs={{ ...MEMBER_PROJECTION_INPUTS, properties: MEMBER_PROJECTION_INPUTS.properties.map((p, i) => (i === 2 ? { ...p, rent_minor: 0n } : p)) }} />
  ),
  play: async ({ canvasElement }) => {
    const leftOut = await within(canvasElement).findByRole("region", { name: "לא בתחזית · 1" });
    await expect(leftOut.textContent).toContain("אין שכירות ב־3 החודשים האחרונים");
    await expect(leftOut.textContent).toContain("Sable Ct");
  },
};

export const ForecastLoading: Story = {
  render: () => <Report loading />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // After the skeleton's 300ms wait: the tab's shape, one status line, and no $0 in the band.
    await expect(await canvas.findByText("טוען את התחזית…")).toHaveAttribute("role", "status");
    await expect(canvasElement.querySelector(".ui-msr-skel[aria-busy='true']")).not.toBeNull();
    await expect(canvasElement.querySelector(".ui-msr-skel-band")).not.toBeNull();
    await expect(canvas.queryByText("$0")).toBeNull();
  },
};

/** FLOW-1150: the same wait offline: the offline line in place of the tab's skeleton. */
export const ForecastLoadingOffline: Story = {
  render: () => <Report loading offline />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(`אין חיבור · ${OFFLINE_WAIT_WORDS}`)).toBeVisible();
    await expect(canvasElement.querySelector(".ui-msr-skel")).toBeNull();
  },
};

/** FLOW-1150: offline, with a read waiting for the connection (React Query pauses it), as a phone without signal. */
function PausedOffline() {
  const client = useQueryClient();
  useLayoutEffect(() => {
    onlineManager.setOnline(false);
    client.query({ queryKey: ["story-paused-read"], queryFn: () => new Promise<never>(() => undefined) }).catch(() => undefined);
    return () => { onlineManager.setOnline(true); };
  }, [client]);
  return null;
}
