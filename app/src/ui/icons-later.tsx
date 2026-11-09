import { Svg, type IconProps } from "./icons";

/**
 * FLOW-1109: icons that only the screens opened after Home draw. Home's first load carries every export of a
 * module it imports that any screen uses, so these live apart from icons.tsx. A module Home draws at first
 * paint imports from icons.tsx, never from here.
 */

export function ReviewIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.7 2.7L16.5 9.5" />
    </Svg>
  );
}

/** The stepper's minus (FLOW-106). */
export function MinusIcon(props: IconProps) {
  return (
    <Svg size={20} stroke={2.2} {...props}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <Svg size={36} stroke={1.6} {...props}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </Svg>
  );
}

/** Three bars on a baseline: the empty profit page (board States profitEmpty). */
export function BarsIcon(props: IconProps) {
  return (
    <Svg size={28} stroke={1.8} {...props}>
      <path d="M5 20V11M11 20V5M17 20v-6M3 20h18" />
    </Svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Svg size={20} stroke={2} {...props}>
      <polyline points="21 4 21 10 15 10" />
      <path d="M20 15a8.5 8.5 0 1 1-1.9-8.9L21 10" />
    </Svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Svg size={20} stroke={2} {...props}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </Svg>
  );
}

/** FLOW-957: attach a file to a note. */
export function PaperclipIcon(props: IconProps) {
  return (
    <Svg size={20} stroke={2} {...props}>
      <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </Svg>
  );
}

/** Four-point spark from the design grid. The עוזר AI row uses it. */
export function SparkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </Svg>
  );
}

/** FLOW-141b: the all-arrived state's calendar with a check (the board's 28px icon). */
export function CalendarCheckIcon(props: IconProps) {
  return (
    <Svg size={28} stroke={1.8} {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" />
    </Svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
    </Svg>
  );
}

/** A circle with a slash: a category kept out of the P&L. */
export function KeptOutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </Svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Svg>
  );
}

export function SplitIcon(props: IconProps) {
  return (
    <Svg {...props} stroke={props.stroke ?? 2}>
      <path d="M16 3h5v5" />
      <path d="M8 3H3v5" />
      <path d="M12 22v-8.3a4 4 0 0 0-1.2-2.8L3 3" />
      <path d="m15 9 6-6" />
    </Svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </Svg>
  );
}

const APP_F_PATH =
  "M35.07 75 C34.07 75 33.29 74.21 33.29 73.21 L33.29 26.79 C33.29 25.79 34.07 25 35.07 25 L67.93 25 C68.93 25 69.71 25.79 69.71 26.79 L69.71 34 C69.71 35 68.93 35.79 67.93 35.79 L45.86 35.79 L45.86 46.29 L66.5 46.29 C67.5 46.29 68.29 47.07 68.29 48.07 L68.29 55.29 C68.29 56.29 67.5 57.07 66.5 57.07 L45.86 57.07 L45.86 73.21 C45.86 74.21 45.07 75 44.07 75 Z";

/** White F on the band tile (72px, the install screen's icon). */
export function AppIcon() {
  return (
    <span className="ui-app-icon ui-app-icon-install" role="img" aria-label="Flow">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path fill="currentColor" d={APP_F_PATH} />
      </svg>
    </span>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </Svg>
  );
}

/** Share: a box with an arrow out of it (FLOW-162, the reports' share). */
export function ShareIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2" />
      <polyline points="8 6 12 2 16 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg size={20} stroke={2} {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
    </Svg>
  );
}

export function BuildingIcon(props: IconProps) {
  return (
    <Svg size={24} stroke={1.9} {...props}>
      <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
      <path d="M15 10h4a1 1 0 0 1 1 1v10" />
      <path d="M3 21h18" />
      <path d="M8 8h3M8 12h3M8 16h3" />
    </Svg>
  );
}

/** FLOW-501. The Settings חיבורים row. */
export function PlugIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </Svg>
  );
}

/** FLOW-501. The Settings הלוואות row. */
export function LoanIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </Svg>
  );
}

/** The loan empty state (States board): a percent in a circle, the loan's rate. */
export function PercentIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 15l6-6" />
      <circle cx="9.5" cy="9.5" r="0.6" />
      <circle cx="14.5" cy="14.5" r="0.6" />
    </Svg>
  );
}

/** FLOW-304. A payment card. */
export function CardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 14.5h3" />
    </Svg>
  );
}

/** FLOW-304. ACH, wire, or an internal transfer. The pair reads the same both ways, so it is not mirrored. */
export function TransferIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8.5h15" />
      <path d="m15.5 5 3.5 3.5-3.5 3.5" />
      <path d="M20 15.5H5" />
      <path d="M8.5 12 5 15.5 8.5 19" />
    </Svg>
  );
}

/** FLOW-304. A memo on a bank line. */
export function NoteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5v10L14 20H6.5A1.5 1.5 0 0 1 5 18.5z" />
      <path d="M19 14.5h-3.5A1.5 1.5 0 0 0 14 16v4" />
      <path d="M8.5 8h7M8.5 11.5h5" />
    </Svg>
  );
}

/** FLOW-372. The מראה row in Settings: a disc, half filled, as on the board. */
export function ThemeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** FLOW-504. The company currency row in Settings. */
export function CoinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2A2.6 2.6 0 0 0 12 8c-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4.1 0 1.1-1 1.9-2.5 1.9a2.7 2.7 0 0 1-2.5-1.2M12 6.5V8m0 8v1.5" />
    </Svg>
  );
}

/** FLOW-601. A pending invite: an envelope in the avatar circle. */
export function MailIcon(props: IconProps) {
  return (
    <Svg size={20} stroke={1.9} {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </Svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg stroke={1.8} {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </Svg>
  );
}

/** The project menu's rows (board Projects.dc.html): pencil for the edit row. */
export function PencilIcon(props: IconProps) {
  return (
    <Svg size={18} stroke={1.8} {...props}>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M14 6l4 4" />
    </Svg>
  );
}

/** The project menu's investment row: a house with columns. */
export function InvestIcon(props: IconProps) {
  return (
    <Svg size={18} stroke={1.8} {...props}>
      <path d="M3 10l9-6 9 6" />
      <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
    </Svg>
  );
}

/** The project menu's finish row: a flag. */
export function FlagIcon(props: IconProps) {
  return (
    <Svg size={18} stroke={1.8} {...props}>
      <path d="M5 21V4h11l-1.5 4L16 12H5" />
    </Svg>
  );
}

/** FLOW-1135: the project menu's חשבונות row (the property's utilities): a lightning bolt. */
export function BoltIcon(props: IconProps) {
  return (
    <Svg size={18} stroke={1.8} {...props}>
      <path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />
    </Svg>
  );
}

/** The project menu's delete row: a bin. */
export function BinIcon(props: IconProps) {
  return (
    <Svg size={18} stroke={1.8} {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Svg>
  );
}

/** FLOW-939. An AI (MCP) key in the key list, as on the board. */
export function KeyIcon(props: IconProps) {
  return (
    <Svg stroke={1.8} {...props}>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3M15 8l2 2" />
    </Svg>
  );
}

/** FLOW-954. A book: the line's journal entry (פקודת יומן), as on the board's Ledger frames. */
export function JournalIcon(props: IconProps) {
  return (
    <Svg stroke={1.8} {...props}>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
      <path d="M5 17a3 3 0 0 1 3-3h11" />
    </Svg>
  );
}

/** FLOW-954. An eye with a slash: a journal leg kept out of profit (the board's Ledger frames). */
export function EyeOffIcon(props: IconProps) {
  return (
    <Svg stroke={2} {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3.1 3.7M6.6 7.6C4.4 9.1 3 12 3 12s4 6 9 6a9 9 0 0 0 4.4-1.2" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Svg>
  );
}
