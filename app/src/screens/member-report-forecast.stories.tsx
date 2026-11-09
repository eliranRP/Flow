import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { MEMBER_PROJECTION_INPUTS, MEMBER_REPORT } from "../dev/member-report-sample";
import { StoryRoute } from "../ui/story-route";
import type { MemberProjectionInputs, MemberReportRead } from "../use-member-report";
import { MemberReportScreen } from "./member-report-screen";

/**
 * FLOW-1127 (FLOW-1125's mockup A, C and D, approved 2026-11-09): דוח שותף's תחזית tab. The refinance year, the
 * bars, the refinance then with the member's part, the cash flow until then, a property year by year, the
 * assumptions, a viewer, and a property left out.
 */
const meta = {
  title: "Screens/Member report/Forecast",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Report({ entry = "/reports/member?mode=forecast", sample = MEMBER_REPORT, inputs = MEMBER_PROJECTION_INPUTS }: {
  entry?: string;
  sample?: MemberReportRead;
  inputs?: MemberProjectionInputs;
}) {
  return (
    <StoryRoute entry={entry} tabs>
      <MemberReportScreen sample={sample} projectionSample={inputs} />
    </StoryRoute>
  );
}

function body(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
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
    await expect(canvas.getByRole("figure", { name: /ההון ויתרת ההלוואות בכל שנה עד 2036/ })).toBeInTheDocument();
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
