import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { NO_PREFS } from "../push";
import { at320, dark } from "../ui/screen-stories-support";
import { padded } from "../ui/story-support";
import { ToastProvider } from "../ui/toast";
import { ReviewPushPrompt } from "./review-push-prompt";

const meta = {
  title: "Screens/ReviewPushPrompt",
  decorators: [padded],
  render: () => (
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <ReviewPushPrompt sample={NO_PREFS} support="ios-home-screen" />
      </ToastProvider>
    </QueryClientProvider>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** FLOW-350: on an iPhone tab, כן shows the note, and "למסך הבית" in it links to the install steps. */
const notePlay: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "כן" }));
  await expect(canvas.getByRole("link", { name: "למסך הבית" })).toHaveAttribute("href", "/install");
  await expect(canvas.getByRole("button", { name: "הבנתי" })).toBeInTheDocument();
};

export const IphoneNote: Story = { play: notePlay };
export const IphoneNote320: Story = { play: notePlay, ...at320 };
export const IphoneNoteDark320: Story = { play: notePlay, ...at320, ...dark };
