import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/EmptyState",
  component: EmptyState,
  decorators: [padded],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

// One story per board preset in States (FLOW-371), with its copy. Each has at most one action: a
// 52px primary pill when it is the next step, a 44px outline pill when it only helps, and none when
// the user just waits. Invented data: "Maple Ave" and "Elm St" are sample project names.

/** homeEmpty: Home without a bank. The next step is to connect one. */
export const HomeNoBank: Story = {
  args: {
    title: "חברו את הבנק",
    body: "Flow מביא את התנועות מ־Mercury, ממיין אותן לפי פרויקט ומחשב את הרווח. לוקח דקה.",
    action: (
      <Button variant="primary" to="/settings/connections">
        חיבור Mercury
      </Button>
    ),
    aside: (
      <Button variant="secondary" to="/settings">
        בינתיים, הוספה ידנית
      </Button>
    ),
  },
};

/** projectsEmpty: no projects yet. Adding one is the next step. */
export const ProjectsNone: Story = {
  args: {
    title: "עוד אין פרויקטים",
    body: "פרויקט מרכז את ההכנסות וההוצאות של נכס או עבודה, ומראה אם הוא מרוויח.",
    action: <Button variant="primary">פרויקט חדש</Button>,
  },
};

/** linesEmpty: a project with nothing this month. It only helps to look at lines without a project. */
export const ProjectMonthEmpty: Story = {
  args: {
    title: "לא יצא כסף החודש",
    body: "לא שויכה ל־Maple Ave הוצאה באוקטובר. שורה שתשייכו לפרויקט תופיע כאן.",
    action: <Button variant="secondary">לשורות בלי פרויקט</Button>,
  },
};

/** loansEmpty: no loans. The next step is the first one. */
export const LoansNone: Story = {
  args: {
    title: "אין הלוואות",
    body: "הוסיפו משכנתא או הלוואת שיפוץ, ו־Flow יפצל כל תשלום לקרן, ריבית ו־escrow.",
    action: <Button variant="primary">הוספת הלוואה</Button>,
  },
};

/** A viewer reads the page and cannot add, so there is no action. */
export const LoansViewer: Story = {
  args: {
    title: "אין הלוואות",
    body: "כשיתווספו הלוואות הן יופיעו כאן.",
  },
};

/** recurringEmpty: קבועים still learning. The user waits two months. */
export const RecurringLearning: Story = {
  args: {
    title: "Flow עוד לומד",
    body: "חיובים והכנסות שחוזרים כל חודש יופיעו כאן אחרי חודשיים של תנועות. אפשר גם לסמן שורה כקבועה מדף התנועה.",
  },
};

/** profitEmpty: a new project. It only helps to find the lines without a project. */
export const ProfitNewProject: Story = {
  args: {
    title: "עוד אין מה לחשב",
    body: "כשתשייכו ל־Elm St הכנסה או הוצאה, הרווח שלו יופיע כאן.",
    action: <Button variant="secondary">לשורות בלי פרויקט</Button>,
  },
};

/** forecastEmpty: every expected payment has arrived. Positive wording, no action. */
export const ForecastAllArrived: Story = {
  args: {
    title: "הכל כבר הגיע",
    body: "כל החיובים וההכנסות הצפויים לאוקטובר נכנסו לחשבון. הצפי לנובמבר ייפתח ב־1 בחודש.",
  },
};

/** teamEmpty: only the owner. Inviting someone only helps. */
export const TeamOnlyYou: Story = {
  args: {
    title: "רק אתם כאן",
    body: "הזמינו רואה חשבון או שותף. אפשר לתת צפייה בלבד, והגישה נשלחת במייל.",
    action: <Button variant="secondary">הזמנה לצוות</Button>,
  },
};

export const LongHebrew: Story = {
  args: {
    title: longHebrew,
    body: longHebrew,
    action: (
      <Button variant="primary" to="/settings">
        {longHebrew}
      </Button>
    ),
  },
};
