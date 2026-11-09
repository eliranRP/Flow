import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { MEMBER_REPORT, MEMBER_REPORT_EMPTY, MEMBER_REPORT_LEFT_OUT } from "../dev/member-report-sample";
import { REPORTS_BALANCE, REPORTS_BY_PROJECT, REPORTS_MONTHS, REPORTS_STATEMENT, REPORTS_TODAY } from "../dev/reports-sample";
import { ExampleBar } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import type { MemberReportRead } from "../use-member-report";
import { MemberReportScreen } from "./member-report-screen";
import { ReportsHubScreen } from "./reports-hub-screen";

/**
 * FLOW-1118 (decision 0263, concept A approved 2026-11-09): the reports page's דוח שותף card, the report on
 * מכירת הכל and ריפייננס, before ownership is set, for a viewer, with properties left out, and its sheets.
 */
const meta = {
  title: "Screens/Member report",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Report({ entry = "/reports/member", sample = MEMBER_REPORT }: { entry?: string; sample?: MemberReportRead }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <MemberReportScreen sample={sample} />
    </StoryRoute>
  );
}

/** Nothing wider than the screen: the page never scrolls sideways. */
async function fits(canvasElement: HTMLElement) {
  const root = canvasElement.ownerDocument.documentElement;
  await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
}

function body(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

export const HubCard: Story = {
  render: () => (
    <StoryRoute entry="/reports" tabs>
      <ExampleBar />
      <ReportsHubScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, byProject: REPORTS_BY_PROJECT, months: REPORTS_MONTHS, balance: REPORTS_BALANCE, member: MEMBER_REPORT }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const card = await within(canvasElement).findByRole("link", { name: /דוח שותף/ });
    await expect(card.getAttribute("href")).toContain("/reports/member");
    // Member A's half of $345,690 if every property is sold.
    await expect(card.textContent).toContain("172,845");
    await expect(card.textContent).toContain("Member A");
    await fits(canvasElement);
  },
};

export const HubCardFailed: Story = {
  render: () => (
    <StoryRoute entry="/reports" tabs>
      <ReportsHubScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, byProject: REPORTS_BY_PROJECT, months: REPORTS_MONTHS, balance: REPORTS_BALANCE, failed: ["member"] }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("דוח שותף")).toBeVisible();
  },
};

export const SellEverything: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("tab", { name: "מכירת הכל", selected: true })).toBeInTheDocument();
    await expect(canvas.getByRole("list", { name: "החישוב" }).textContent).toContain("החלק של Member A");
    await expect(canvas.getAllByText(/172,845/).length).toBeGreaterThan(0);
    await expect(canvas.getByText("Birch Lane")).toBeInTheDocument();
    await fits(canvasElement);
  },
};

export const Refinance: Story = {
  render: () => <Report entry="/reports/member?mode=refi" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("tab", { name: "ריפייננס", selected: true })).toBeInTheDocument();
    // 10 year 4.38% + 1.5 = 5.88%; Example Bank at 5.80% is under it.
    await expect(canvas.getAllByText("5.88%").length).toBeGreaterThan(0);
    await expect(canvas.getByText(/מתחת לצפוי ב־0.08% · הצעה טובה/)).toBeInTheDocument();
    // Member A's half of $134,505 freed: $67,252.50.
    await expect(canvas.getByRole("list", { name: "החישוב" }).textContent).toMatch(/67,25[23]/);
    await fits(canvasElement);
  },
};

export const SecondMember: Story = {
  render: () => <Report entry="/reports/member?member=1" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findByRole("list", { name: "החישוב" })).textContent).toContain("החלק של Member B");
  },
};

export const BeforeOwnership: Story = {
  render: () => <Report sample={MEMBER_REPORT_EMPTY} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("מי מחזיק כמה?")).toBeInTheDocument();
    await expect(canvas.getAllByText(/345,690/).length).toBeGreaterThan(0);
    // The band shows the company's figure, with no member chip.
    await expect(canvas.getByRole("heading", { level: 1 }).textContent).toBe("הון נקי של החברה אם מוכרים הכל");
    await expect(canvas.queryByRole("button", { name: /^השותף:/ })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "הגדרת שותפים" }));
    await expect(await body(canvasElement).findByRole("dialog", { name: "שותפים ואחוזי בעלות" })).toBeVisible();
  },
};

export const Viewer: Story = {
  render: () => <Report entry="/reports/member?mode=refi" sample={{ ...MEMBER_REPORT, canEdit: false }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Example Bank")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "+ הוספת הצעה" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: "הנחות החישוב" })).toBeNull();
    // A viewer's chip picks whose share to see, and offers no editing.
    await userEvent.click(canvas.getByRole("button", { name: /^השותף: Member A/ }));
    const sheet = within(await body(canvasElement).findByRole("dialog", { name: "השותף בדוח" }));
    await expect(sheet.queryByRole("button", { name: "עריכת שותפים ואחוזים" })).toBeNull();
    await userEvent.click(sheet.getByRole("button", { name: /Member C/ }));
    await waitFor(async () => { await expect(canvas.getByRole("heading", { level: 1 }).textContent).toBe("החלק של Member C מריפייננס"); });
  },
};

export const OneMemberChip: Story = {
  render: () => <Report sample={{ ...MEMBER_REPORT, config: { ...MEMBER_REPORT.config, members: [{ name: "Member A", ownership_bp: 10000 }] } }} />,
  play: async ({ canvasElement }) => {
    // With one member, the owner's chip opens the members sheet itself.
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /^השותף: Member A, 100%/ }));
    await expect(await body(canvasElement).findByRole("dialog", { name: "שותפים ואחוזי בעלות" })).toBeVisible();
  },
};

export const LeftOut: Story = {
  render: () => <Report sample={MEMBER_REPORT_LEFT_OUT} />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/לא בחישוב: Cedar Row \(אין שווי\), Olive House \(במטבע אחר\)/)).toBeInTheDocument();
  },
};

export const MembersSheet: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    // Three members: the chip picks one, and the owner edits from there.
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /^השותף: Member A, 50%/ }));
    const picker = within(await body(canvasElement).findByRole("dialog", { name: "השותף בדוח" }));
    await userEvent.click(picker.getByRole("button", { name: "עריכת שותפים ואחוזים" }));
    const dialog = await body(canvasElement).findByRole("dialog", { name: "שותפים ואחוזי בעלות" });
    const sheet = within(dialog);
    await expect(sheet.getByRole("status").textContent).toContain("100%");
    await userEvent.click(sheet.getAllByRole("button", { name: "הסרה" })[2] as HTMLElement);
    await expect(await sheet.findByText("חסרים 20% עד 100%.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "שמירה" })).toBeDisabled();
  },
};

export const QuoteSheet: Story = {
  render: () => <Report entry="/reports/member?mode=refi" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "+ הוספת הצעה" }));
    const sheet = within(await body(canvasElement).findByRole("dialog", { name: "הצעה ממלווה" }));
    await userEvent.type(sheet.getByLabelText("מלווה"), "Example Credit Union");
    await userEvent.type(sheet.getByLabelText("ריבית (%)"), "5.75");
    await expect(await sheet.findByText(/מתחת לצפוי ב־0.13% · הצעה טובה/)).toBeVisible();
    await userEvent.click(sheet.getByRole("button", { name: "שמירת ההצעה" }));
    await waitFor(async () => { await expect(within(canvasElement).getByText("Example Credit Union")).toBeInTheDocument(); });
  },
};

export const YieldsSheet: Story = {
  render: () => <Report entry="/reports/member?mode=refi" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "03/11/2026" }));
    const sheet = within(await body(canvasElement).findByRole("dialog", { name: "תשואות אג״ח ארה״ב" }));
    await expect(sheet.getByLabelText("10 שנים (%)")).toHaveValue("4.38");
    await userEvent.click(sheet.getByRole("radio", { name: "+2.0" }));
    await expect(await sheet.findByText("6.38%")).toBeVisible();
  },
};

export const AssumptionsSheet: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "הנחות החישוב" }));
    const sheet = within(await body(canvasElement).findByRole("dialog", { name: "הנחות החישוב" }));
    await expect(sheet.getByLabelText("אחוז מימון (LTV)")).toHaveValue("75");
    await expect(sheet.getByLabelText("עלויות סגירה (% מההלוואה)")).toHaveValue("2");
  },
};

export const PropertySheet: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /Birch Lane/ }));
    const sheet = within(await body(canvasElement).findByRole("dialog", { name: "Birch Lane" }));
    // $420,000 − 7% − $268,000 = $122,600; Member A's half is $61,300.
    await expect(sheet.getByRole("list", { name: "Birch Lane" }).textContent).toContain("61,300");
    await userEvent.click(sheet.getByRole("tab", { name: "ריפייננס" }));
    await expect(await sheet.findByText(/תשלום חודשי חדש/)).toBeVisible();
  },
};
