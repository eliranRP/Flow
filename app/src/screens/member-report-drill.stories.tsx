import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { MEMBER_CONFIG, MEMBER_REPORT } from "../dev/member-report-sample";
import { israelToday } from "../ui/date-math";
import { StoryRoute } from "../ui/story-route";
import type { MemberReportRead, RefreshAnswer } from "../use-member-report";
import { MemberReportScreen } from "./member-report-screen";

/**
 * FLOW-1121: every row of דוח שותף's החישוב opens its parts (per property, or per member for the share), the
 * selling cost's percent changed for one property and for all, a viewer's parts without edits, and the rate
 * card before any quote or yield.
 */
const meta = {
  title: "Screens/Member report/Parts",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Report({ entry = "/reports/member", sample = MEMBER_REPORT }: { entry?: string; sample?: MemberReportRead }) {
  return (
    <StoryRoute entry={entry} tabs>
      <MemberReportScreen sample={sample} />
    </StoryRoute>
  );
}

function body(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

/** Opens the החישוב row named `row`, checks its sheet's title and a line in it, and closes it. */
async function opens(canvasElement: HTMLElement, row: RegExp, title: string, line: RegExp) {
  const calc = within(await within(canvasElement).findByRole("list", { name: "החישוב" }));
  await userEvent.click(calc.getByRole("button", { name: row }));
  const dialog = await body(canvasElement).findByRole("dialog", { name: title });
  await expect(within(dialog).getAllByText(line).length).toBeGreaterThan(0);
  await userEvent.keyboard("{Escape}");
  await waitFor(async () => { await expect(body(canvasElement).queryByRole("dialog", { name: title })).toBeNull(); });
}

export const SaleRowsOpen: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    await opens(canvasElement, /שווי הנכסים/, "שווי הנכסים", /הערכה מ־01\/11\/2026/);
    await opens(canvasElement, /עלויות מכירה/, "עלויות מכירה", /7% × \$420,000/);
    await opens(canvasElement, /סילוק הלוואות/, "סילוק הלוואות", /יתרות היום/);
    await opens(canvasElement, /הון נקי/, "הון נקי", /\$420,000 − \$29,400 − \$268,000/);
    await opens(canvasElement, /החלק של Member A/, "החלק של כל שותף", /30% × \$345,690/);
  },
};

export const RefinanceRowsOpen: Story = {
  render: () => <Report entry="/reports/member?mode=refi" />,
  play: async ({ canvasElement }) => {
    await opens(canvasElement, /הלוואה חדשה/, "הלוואה חדשה", /75% × \$420,000/);
    await opens(canvasElement, /סילוק ההלוואות הקיימות/, "סילוק ההלוואות הקיימות", /יתרות היום/);
    await opens(canvasElement, /עלויות סגירה/, "עלויות סגירה", /2% × \$315,000/);
    await opens(canvasElement, /כסף שמשתחרר/, "כסף שמשתחרר", /\$315,000 − \$268,000 − \$6,300/);
    await opens(canvasElement, /החלק של Member A/, "החלק של כל שותף", /50% × \$134,505/);
  },
};

const DEEP: MemberReportRead = {
  ...MEMBER_REPORT,
  properties: MEMBER_REPORT.properties.map((p, i) => (i === 0 ? { ...p, loan_balance_minor: 40_000_000n } : p)),
};

export const RefinanceNotRefinanced: Story = {
  render: () => <Report entry="/reports/member?mode=refi" sample={DEEP} />,
  play: async ({ canvasElement }) => {
    await opens(canvasElement, /כסף שמשתחרר/, "כסף שמשתחרר", /לא ממוחזר, לא נספר/);
  },
};

export const SellingCostOneProperty: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findByRole("list", { name: "החישוב" })).textContent).toContain("7% · תיווך, סגירה ומסים");
    await userEvent.click(within(canvas.getByRole("list", { name: "החישוב" })).getByRole("button", { name: /עלויות מכירה/ }));
    const parts = within(await body(canvasElement).findByRole("dialog", { name: "עלויות מכירה" }));
    await userEvent.click(parts.getByRole("button", { name: /Birch Lane/ }));
    const edit = within(await body(canvasElement).findByRole("dialog", { name: "עלויות מכירה · Birch Lane" }));
    const field = edit.getByLabelText("אחוז");
    await userEvent.clear(field);
    await userEvent.type(field, "6.5");
    await userEvent.click(edit.getByRole("button", { name: "שמירה" }));
    // The row's hint names the range, and its parts show Birch Lane at 6.5%.
    await waitFor(async () => { await expect(canvas.getByRole("list", { name: "החישוב" }).textContent).toContain("6.5%–7% · תיווך, סגירה ומסים"); });
    await opens(canvasElement, /עלויות מכירה/, "עלויות מכירה", /6\.5% × \$420,000/);
  },
};

export const SellingCostAll: Story = {
  render: () => <Report />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(await canvas.findByRole("list", { name: "החישוב" })).getByRole("button", { name: /עלויות מכירה/ }));
    const parts = within(await body(canvasElement).findByRole("dialog", { name: "עלויות מכירה" }));
    await userEvent.click(parts.getByRole("button", { name: "שינוי האחוז לכל הנכסים" }));
    const edit = within(await body(canvasElement).findByRole("dialog", { name: "עלויות מכירה · כל הנכסים" }));
    const field = edit.getByLabelText("אחוז");
    await userEvent.clear(field);
    await userEvent.type(field, "8.25");
    await userEvent.click(edit.getByRole("button", { name: "שמירה" }));
    await waitFor(async () => { await expect(canvas.getByRole("list", { name: "החישוב" }).textContent).toContain("8.25% · תיווך, סגירה ומסים"); });
    await opens(canvasElement, /עלויות מכירה/, "עלויות מכירה", /8\.25% × \$365,000/);
  },
};

const MIXED_SELLING: MemberReportRead = {
  ...MEMBER_REPORT,
  properties: MEMBER_REPORT.properties.map((p, i) => (i === 0 ? { ...p, selling_cost_bp: 600 } : i === 1 ? { ...p, selling_cost_bp: null } : p)),
};

export const SellingCostAllUndo: Story = {
  render: () => <Report sample={MIXED_SELLING} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const calc = () => canvas.getByRole("list", { name: "החישוב" }).textContent;
    await expect((await canvas.findByRole("list", { name: "החישוב" })).textContent).toContain("6%–8% · תיווך, סגירה ומסים");
    await userEvent.click(within(canvas.getByRole("list", { name: "החישוב" })).getByRole("button", { name: /עלויות מכירה/ }));
    const parts = within(await body(canvasElement).findByRole("dialog", { name: "עלויות מכירה" }));
    await userEvent.click(parts.getByRole("button", { name: "שינוי האחוז לכל הנכסים" }));
    const edit = within(await body(canvasElement).findByRole("dialog", { name: "עלויות מכירה · כל הנכסים" }));
    const field = edit.getByLabelText("אחוז");
    await userEvent.clear(field);
    await userEvent.type(field, "9");
    await userEvent.click(edit.getByRole("button", { name: "שמירה" }));
    await waitFor(async () => { await expect(calc()).toContain("9% · תיווך, סגירה ומסים"); });
    // ביטול puts every property back: 6%, the default 8%, and 7%.
    await expect(await body(canvasElement).findByText("עלויות המכירה עודכנו")).toBeInTheDocument();
    await userEvent.click(body(canvasElement).getByRole("button", { name: "ביטול" }));
    await waitFor(async () => { await expect(calc()).toContain("6%–8% · תיווך, סגירה ומסים"); });
    await opens(canvasElement, /עלויות מכירה/, "עלויות מכירה", /8% \(ברירת מחדל\) × \$365,000/);
  },
};

export const ViewerParts: Story = {
  render: () => <Report sample={{ ...MEMBER_REPORT, canEdit: false }} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(await within(canvasElement).findByRole("list", { name: "החישוב" })).getByRole("button", { name: /עלויות מכירה/ }));
    const parts = within(await body(canvasElement).findByRole("dialog", { name: "עלויות מכירה" }));
    // The percents are there; the rows link to each property's page and nothing edits them.
    await expect(parts.getByText("7% × $420,000")).toBeInTheDocument();
    await expect(parts.getByRole("link", { name: /Birch Lane/ })).toBeInTheDocument();
    await expect(parts.queryByRole("button", { name: "שינוי האחוז לכל הנכסים" })).toBeNull();
  },
};

const NO_RATE: MemberReportRead = { ...MEMBER_REPORT, config: { ...MEMBER_CONFIG, quotes: [], yields: [], quote_date: undefined }, treasuryYields: [] };

function today(): string {
  return israelToday().split("-").reverse().join("/");
}

export const RateNothingYet: Story = {
  render: () => <Report entry="/reports/member?mode=refi" sample={NO_RATE} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // No quote and no yield: the date is today's, and the line says where the yields come from.
    await userEvent.click(await canvas.findByRole("button", { name: today() }));
    await expect(await body(canvasElement).findByRole("dialog", { name: "תשואות אג״ח ארה״ב" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(canvas.getByText("תשואות האג״ח מתעדכנות אוטומטית מאתר משרד האוצר. אפשר גם להקליד ידנית.")).toBeInTheDocument();
    await expect(canvas.getByText("עוד אין הצעות. הוסיפו הצעה כדי להשוות.")).toBeInTheDocument();
  },
};

export const RateNothingYetViewer: Story = {
  render: () => <Report entry="/reports/member?mode=refi" sample={{ ...NO_RATE, canEdit: false }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("תשואות האג״ח מתעדכנות אוטומטית מאתר משרד האוצר.")).toBeInTheDocument();
    await expect(canvas.getByText(today())).toBeInTheDocument();
    await expect(canvas.getByText("עוד אין הצעות.")).toBeInTheDocument();
  },
};

const YIELDS_NO_QUOTES: MemberReportRead = { ...MEMBER_REPORT, config: { ...MEMBER_CONFIG, quotes: [] } };

export const RateYieldsNoQuotes: Story = {
  render: () => <Report entry="/reports/member?mode=refi" sample={YIELDS_NO_QUOTES} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The expected rate shows as with quotes; the note asks for one.
    await expect((await canvas.findAllByText("5.88%")).length).toBeGreaterThan(0);
    await expect(canvas.getByText("עוד אין הצעות. הוסיפו הצעה כדי להשוות.")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "+ הוספת הצעה" })).toBeInTheDocument();
  },
};

/* FLOW-1121: the owner's רענון of the Treasury yields, and when they were last fetched. */

function RefreshReport({ sample = MEMBER_REPORT, answer }: { sample?: MemberReportRead; answer: RefreshAnswer }) {
  return (
    <StoryRoute entry="/reports/member?mode=refi" tabs>
      <MemberReportScreen sample={sample} refreshSample={() => Promise.resolve(answer)} />
    </StoryRoute>
  );
}

/** Today at 09:30 in Israel (06:30 UTC in winter), as get_member_report's treasury_fetched_at would carry it. */
const FETCHED_TODAY = `${israelToday()}T07:30:00Z`;

async function refreshes(canvasElement: HTMLElement, toast: string) {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "רענון תשואות האג״ח" }));
  await expect(await body(canvasElement).findByText(toast)).toBeInTheDocument();
}

export const RefreshNeverFetched: Story = {
  render: () => <RefreshReport answer={{ requested: true }} />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("עוד לא עודכן")).toBeInTheDocument();
    await refreshes(canvasElement, "מבקשים את התשואות מהאוצר…");
  },
};

export const RefreshFetchedToday: Story = {
  render: () => <RefreshReport sample={{ ...MEMBER_REPORT, treasuryFetchedAt: FETCHED_TODAY }} answer={{ requested: true }} />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/^עודכן ב-\d\d:\d\d$/)).toBeInTheDocument();
    // The yields sheet starts with the same line.
    await userEvent.click(within(canvasElement).getByRole("button", { name: "03/11/2026" }));
    const sheet = within(await body(canvasElement).findByRole("dialog", { name: "תשואות אג״ח ארה״ב" }));
    await expect(sheet.getByText(/^עודכן ב-\d\d:\d\d$/)).toBeInTheDocument();
    await expect(sheet.getByRole("button", { name: "רענון תשואות האג״ח" })).toBeInTheDocument();
  },
};

export const RefreshRecent: Story = {
  render: () => <RefreshReport answer={{ requested: false, reason: "recent" }} />,
  play: async ({ canvasElement }) => { await refreshes(canvasElement, "כבר התבקש לפני רגע"); },
};

export const RefreshUnavailable: Story = {
  render: () => <RefreshReport answer={{ requested: false, reason: "unavailable" }} />,
  play: async ({ canvasElement }) => { await refreshes(canvasElement, "לא ניתן לרענן כרגע"); },
};

export const RefreshViewer: Story = {
  render: () => <RefreshReport sample={{ ...MEMBER_REPORT, canEdit: false, treasuryFetchedAt: FETCHED_TODAY }} answer={{ requested: true }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/^עודכן ב-\d\d:\d\d$/)).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "רענון תשואות האג״ח" })).toBeNull();
  },
};
