import type { Meta, StoryObj } from "@storybook/react";
import { SetupMovie } from "./movie";
import { CONNECT_MOVIE, JEV_MOVIE, LOANS_MOVIE, WELCOME_MOVIE, installMovie } from "./movie-scenes";

/** The setup movies (FLOW-514 §2): a phone that loops three scenes, paused on tab-hidden or off-screen. */
const meta = {
  title: "UI/SetupMovie",
  component: SetupMovie,
  parameters: { layout: "centered" },
} satisfies Meta<typeof SetupMovie>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Welcome: Story = {
  args: { scenes: WELCOME_MOVIE.scenes, label: WELCOME_MOVIE.label },
};

export const Connect: Story = {
  args: { scenes: CONNECT_MOVIE.scenes, label: CONNECT_MOVIE.label },
};

export const Loans: Story = {
  args: { scenes: LOANS_MOVIE.scenes, label: LOANS_MOVIE.label },
};

export const Jev: Story = {
  args: { scenes: JEV_MOVIE.scenes, label: JEV_MOVIE.label },
};

export const Install: Story = {
  args: { scenes: installMovie().scenes, label: installMovie().label },
};

export const Paused: Story = {
  args: { scenes: WELCOME_MOVIE.scenes, label: WELCOME_MOVIE.label, startPaused: true },
};

export const ReducedMotion: Story = {
  args: { scenes: WELCOME_MOVIE.scenes, label: WELCOME_MOVIE.label, forceReducedMotion: true },
};
