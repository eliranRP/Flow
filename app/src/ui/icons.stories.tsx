import type { Meta, StoryObj } from "@storybook/react";
import type { ComponentType } from "react";
import {
  AlertIcon,
  BankIcon,
  BellIcon,
  BuildingIcon,
  CalendarIcon,
  CameraIcon,
  ChartIcon,
  CheckIcon,
  CoinIcon,
  CopyIcon,
  DocumentIcon,
  DownloadIcon,
  EyeOffIcon,
  HomeIcon,
  KeptOutIcon,
  LoanIcon,
  LockIcon,
  LogoutIcon,
  PencilIcon,
  PercentIcon,
  PlugIcon,
  ProjectsIcon,
  RefreshIcon,
  ReviewIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  SplitIcon,
  TagIcon,
  TrashIcon,
} from "./icons";
import { padded } from "./story-support";

type Entry = [string, ComponentType<{ size?: number }>];

/** The 24-grid line icons, stroke 1.9. FLOW-501 adds PlugIcon (חיבורים) and LoanIcon (הלוואות). */
const ICONS: Entry[] = [
  ["PlugIcon", PlugIcon],
  ["LoanIcon", LoanIcon],
  ["CoinIcon", CoinIcon],
  ["HomeIcon", HomeIcon],
  ["ProjectsIcon", ProjectsIcon],
  ["ReviewIcon", ReviewIcon],
  ["SettingsIcon", SettingsIcon],
  ["BankIcon", BankIcon],
  ["DocumentIcon", DocumentIcon],
  ["SparkIcon", SparkIcon],
  ["TagIcon", TagIcon],
  ["BuildingIcon", BuildingIcon],
  ["AlertIcon", AlertIcon],
  ["ChartIcon", ChartIcon],
  ["CalendarIcon", CalendarIcon],
  ["CameraIcon", CameraIcon],
  ["CheckIcon", CheckIcon],
  ["CopyIcon", CopyIcon],
  ["DownloadIcon", DownloadIcon],
  ["EyeOffIcon", EyeOffIcon],
  ["KeptOutIcon", KeptOutIcon],
  ["LockIcon", LockIcon],
  ["LogoutIcon", LogoutIcon],
  ["PencilIcon", PencilIcon],
  ["PercentIcon", PercentIcon],
  ["RefreshIcon", RefreshIcon],
  ["SearchIcon", SearchIcon],
  ["SplitIcon", SplitIcon],
  ["TrashIcon", TrashIcon],
  ["BellIcon", BellIcon],
];

function IconGrid() {
  return (
    <ul className="grid grid-cols-3 gap-4" dir="ltr">
      {ICONS.map(([name, Icon]) => (
        <li key={name} className="flex min-w-0 flex-col items-center gap-1 text-text">
          <Icon size={24} />
          <span className="t-hint min-w-0 break-all text-center">{name}</span>
        </li>
      ))}
    </ul>
  );
}

const meta = {
  title: "Components/Icons",
  component: IconGrid,
  decorators: [padded],
} satisfies Meta<typeof IconGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const All: Story = {};
export const AllDark: Story = { globals: { theme: "dark" } };
export const All320: Story = { parameters: { viewport: { defaultViewport: "flow320" } } };
