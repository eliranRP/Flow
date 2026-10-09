import type { Meta, StoryObj } from "@storybook/react";
import { NotificationsScreen, ReviewEmpty } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { at320, dark, ExampleBar } from "../ui/screen-stories-support";
import { NO_PREFS, type NotificationPrefs, type PushSupport } from "../push";

const meta = {
  title: "Screens/Notifications",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const evening: NotificationPrefs = { ...NO_PREFS, evening_reminder: true, prompt_answered: true, has_subscription: true };

function Page({ prefs, support }: { prefs: NotificationPrefs; support: PushSupport }) {
  return (
    <StoryRoute entry="/settings/notifications" tabs>
      <ExampleBar />
      <NotificationsScreen sample={prefs} support={support} />
    </StoryRoute>
  );
}

/** FLOW-502 option A: three switches, the evening reminder on. */
export const Settings: Story = { render: () => <Page prefs={evening} support="ok" /> };
export const Settings320: Story = { ...at320, render: () => <Page prefs={evening} support="ok" /> };
export const SettingsDark320: Story = { ...at320, ...dark, render: () => <Page prefs={evening} support="ok" /> };
/** An iPhone tab: the Home Screen note, and the off switches cannot turn on. */
export const SettingsIphoneTab320: Story = { ...at320, render: () => <Page prefs={NO_PREFS} support="ios-home-screen" /> };
export const SettingsIphoneTabDark320: Story = { ...at320, ...dark, render: () => <Page prefs={NO_PREFS} support="ios-home-screen" /> };

function EmptyWithPrompt({ support }: { support: PushSupport }) {
  return (
    <StoryRoute entry="/review" tabs>
      <ExampleBar />
      <ReviewEmpty search="" pushPrompt pushSample={{ prefs: NO_PREFS, support }} />
    </StoryRoute>
  );
}

/** FLOW-502 option A: the evening reminder card under the review empty state, asked once. */
export const ReviewReminderCard: Story = { render: () => <EmptyWithPrompt support="ok" /> };
export const ReviewReminderCard320: Story = { ...at320, render: () => <EmptyWithPrompt support="ok" /> };
export const ReviewReminderCardDark320: Story = { ...at320, ...dark, render: () => <EmptyWithPrompt support="ok" /> };
