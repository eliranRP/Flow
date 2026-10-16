import type { Meta, StoryObj } from "@storybook/react";
import { paceSheetCopy } from "./pace";
import { ChoiceSheet } from "./choice-sheet";
import { BASIS_COPY, CURRENCY_COPY } from "./company-choices";
import { THEME_COPY } from "./theme-choices";
import { forceReducedMotion } from "./reduced-motion";
import { padded } from "./story-support";

/** One sheet of radio rows that apply on tap: currency, basis and pace (FLOW-103, FLOW-504, FLOW-415). */
const meta = {
  title: "Components/ChoiceSheet",
  component: ChoiceSheet,
  decorators: [padded],
  parameters: { viewport: { defaultViewport: "flow390-short" } },
} satisfies Meta<typeof ChoiceSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;

export const Default: Story = {
  args: { copy: CURRENCY_COPY, open: true, onOpenChange: noop, value: "ILS", saving: null, onPick: noop },
};
export const WithDescriptions: Story = {
  args: { copy: BASIS_COPY, open: true, onOpenChange: noop, value: "cash", saving: null, onPick: noop },
};
/** The tapped row spins; the other rows wait until the save settles. */
export const Saving: Story = {
  args: { copy: paceSheetCopy(null), open: true, onOpenChange: noop, value: "month", saving: "2months", onPick: noop },
};
export const ReducedMotion: Story = {
  args: { copy: paceSheetCopy(null), open: true, onOpenChange: noop, value: "quarter", saving: null, onPick: noop },
  decorators: [forceReducedMotion],
};

/** Settings › מראה (FLOW-372): the default, which follows the phone, with its subtitle. */
export const ThemeFollowsDevice: Story = {
  args: { copy: THEME_COPY, open: true, onOpenChange: noop, value: "system", saving: null, onPick: noop },
};
/** Settings › מראה with the light choice picked. */
export const ThemeLight: Story = {
  args: { copy: THEME_COPY, open: true, onOpenChange: noop, value: "light", saving: null, onPick: noop },
};
