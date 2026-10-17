import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { TeamStory } from "../dev/team-story";
import type { SampleTeamOptions } from "../dev/team-sample";
import { sampleCashMonths } from "../dev/cash-sample";
import { cashMonthKey } from "../cash";
import { attentionRows, CashHome } from "./HomeScreen";
import { CompanySwitcher } from "./company-switcher";

/**
 * FLOW-601: the company's name on Home's band and the חברה sheet (mockups a-3, invite-4,
 * invite-5), on an in-memory team. Invented names only.
 */
const meta = {
  title: "Screens/Company switcher",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const cash = sampleCashMonths();
const currentKey = cashMonthKey(cash.months[0]?.month ?? "");

function Home() {
  return (
    <CashHome
      data={cash}
      monthKey={currentKey}
      currentKey={currentKey}
      previewing={false}
      search=""
      attention={attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, search: "" })}
      company={<CompanySwitcher fallbackName="חברה לדוגמה" />}
      onStepMonth={() => undefined}
    />
  );
}

function home(options: SampleTeamOptions) {
  return () => (
    <TeamStory entry="/" tabs options={options}>
      <Home />
    </TeamStory>
  );
}

async function open(canvasElement: HTMLElement) {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "חברה: חברה לדוגמה" }));
  return within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "חברה" });
}

export const Band: Story = { name: "Band, the company's name", render: home({ twoCompanies: true }) };

export const Switcher: Story = {
  name: "Switcher (a-3)",
  render: home({ twoCompanies: true }),
  play: async ({ canvasElement }) => { await open(canvasElement); },
};

export const WithInvite: Story = {
  name: "Switcher with an invite (invite-4)",
  render: home({ inbox: 1 }),
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement);
    await within(dialog).findByRole("heading", { name: "הזמנות" });
  },
};

export const Declined: Story = {
  name: "Declined, with ביטול (invite-5)",
  render: home({ inbox: 1 }),
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement);
    await userEvent.click(await within(dialog).findByRole("button", { name: "דחייה של נכסים לדוגמה בע״מ" }));
    await within(canvasElement.ownerDocument.body).findByText("ההזמנה נדחתה");
  },
};

export const ViewerNoNew: Story = {
  name: "Switcher, a viewer (no + חברה חדשה)",
  render: home({ role: "viewer", twoCompanies: true }),
  play: async ({ canvasElement }) => { await open(canvasElement); },
};

export const ListLoading: Story = {
  name: "Switcher, list loading",
  render: home({ hold: ["listMyCompanies"] }),
  play: async ({ canvasElement }) => { await open(canvasElement); },
};
