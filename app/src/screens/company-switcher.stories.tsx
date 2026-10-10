import type { Dashboard } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { useState } from "react";
import { TeamStory } from "../dev/team-story";
import type { SampleTeamOptions } from "../dev/team-sample";
import { defaultPeriod } from "../period";
import { sampleDashboard } from "../ui/screen-stories-support";
import { HomeBooks } from "./HomeScreen";
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

const dark = { globals: { theme: "dark" as const } };
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const data: Dashboard = { ...sampleDashboard, name: "חברה לדוגמה" };

function Home() {
  const [period, setPeriod] = useState(defaultPeriod());
  return (
    <HomeBooks
      data={data}
      previewing={false}
      search=""
      unpaidGross={0n}
      unpaidCount={0}
      period={period}
      onPeriod={setPeriod}
      company={<CompanySwitcher fallbackName={data.name} />}
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
export const Band320: Story = { ...Band, name: "Band, 320", ...at320 };

export const Switcher: Story = {
  name: "Switcher (a-3)",
  render: home({ twoCompanies: true }),
  play: async ({ canvasElement }) => { await open(canvasElement); },
};
export const SwitcherDark: Story = { ...Switcher, name: "Switcher, dark", ...dark };
export const Switcher320: Story = { ...Switcher, name: "Switcher, 320", ...at320 };

export const WithInvite: Story = {
  name: "Switcher with an invite (invite-4)",
  render: home({ inbox: 1 }),
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement);
    await within(dialog).findByRole("heading", { name: "הזמנות" });
  },
};
export const WithInviteDark: Story = { ...WithInvite, name: "Switcher with an invite, dark", ...dark };
export const WithInvite320: Story = { ...WithInvite, name: "Switcher with an invite, 320", ...at320 };

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
