import type { Meta, StoryObj } from "@storybook/react-vite";
import { NotificationsScreen, ReviewEmpty } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { NO_PREFS, type DevicePush, type NotificationPrefs, type PushSupport } from "../push";
import type { PushDevice } from "../push-devices";
import { SAMPLE_DEVICES, SAMPLE_THIS_TAG } from "../push-devices-sample";

const meta = {
  title: "Screens/Notifications",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const evening: NotificationPrefs = { ...NO_PREFS, evening_reminder: true, prompt_answered: true };

function Page({ prefs, support, device, devices = [] }: { prefs: NotificationPrefs; support: PushSupport; device?: DevicePush; devices?: PushDevice[] }) {
  return (
    <StoryRoute entry="/settings/notifications" tabs>
      <ExampleBar />
      <NotificationsScreen sample={prefs} support={support} device={device} devices={devices} thisTag={SAMPLE_THIS_TAG} />
    </StoryRoute>
  );
}

/** FLOW-516: this device on, the test push next to it, the shared switches and two connected devices. */
export const Settings: Story = { render: () => <Page prefs={evening} support="ok" device="subscribed" devices={SAMPLE_DEVICES} /> };
/** A switch on and no device connected: the line asks to connect this device. */
export const SettingsNoDevice: Story = { render: () => <Page prefs={evening} support="ok" device="not-subscribed" /> };
/** Blocked on an iPhone: the device row points to the iOS Settings app. */
export const SettingsBlocked: Story = { render: () => <Page prefs={evening} support="ok" device="denied" devices={SAMPLE_DEVICES.slice(1)} /> };
/** An iPhone tab: the Home Screen note; the device row cannot turn on, the shared switches still can. */
export const SettingsIphoneTab: Story = { render: () => <Page prefs={NO_PREFS} support="ios-home-screen" /> };

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
