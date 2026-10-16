import type { Meta, StoryObj } from "@storybook/react";
import { IconRow } from "./icon-row";
import { ChartIcon, ProjectsIcon, TagIcon } from "./icons";
import { List } from "./list-row";
import { forceReducedMotion } from "./reduced-motion";
import { padded } from "./story-support";

const meta = {
  title: "Components/IconRow",
  component: IconRow,
  tags: ["autodocs"],
  decorators: [padded],
  args: { icon: <ProjectsIcon />, label: "פרויקט", value: "שיפוץ דירה ביאליק" },
  argTypes: {
    valueTone: { control: "select", options: [undefined, "accent"] },
    disabled: { control: "boolean" },
    busy: { control: "boolean" },
  },
} satisfies Meta<typeof IconRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const open = () => undefined;

/** The chevron row opens its sheet. */
export const Default: Story = { args: { onClick: open } };
/** A fact with nothing to tap. */
export const Static: Story = {};
export const Accent: Story = { args: { value: "בחרו פרויקט", valueTone: "accent", onClick: open } };
export const WithHint: Story = { args: { icon: <ChartIcon />, label: "נספר ב", value: "רווח ותזרים", hint: "כסף שזז בבנק", onClick: open } };
/** The text link row: "שינוי" beside the value. */
export const Link: Story = { args: { icon: <TagIcon />, label: "קטגוריה", value: "חומרים", action: { label: "שינוי", onClick: open } } };
export const Busy: Story = { args: { onClick: open, busy: true } };
export const Disabled: Story = { args: { onClick: open, disabled: true } };
export const InCard: Story = {
  render: () => (
    <List layout="inset">
      <IconRow icon={<ProjectsIcon />} label="פרויקט" value="שיפוץ דירה ביאליק" onClick={open} />
      <IconRow icon={<TagIcon />} label="קטגוריה" value="חומרים" onClick={open} />
      <IconRow icon={<ChartIcon />} label="נספר ב" value="רווח ותזרים" onClick={open} />
    </List>
  ),
};
/** Press and busy change at once under reduced motion. */
export const ReducedMotion: Story = { args: { onClick: open }, decorators: [forceReducedMotion] };
