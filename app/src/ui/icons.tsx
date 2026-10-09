import type { ReactNode } from "react";

type IconProps = {
  size?: number;
  stroke?: number;
};

function Svg({ size = 24, stroke = 1.9, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Paths from design/src/flow.py, the 24-grid set the mockups use. */
export function HomeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H4.5A1.5 1.5 0 0 1 3 20z" />
    </Svg>
  );
}

export function ProjectsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
    </Svg>
  );
}

export function ReviewIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.7 2.7L16.5 9.5" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg size={24} stroke={2.4} {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <Svg stroke={2} {...props}>
      <polyline points="9 18 15 12 9 6" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg stroke={2} {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
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

export function OfflineIcon(props: IconProps) {
  return (
    <Svg size={36} stroke={1.6} {...props}>
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M16.7 11.1A11 11 0 0 1 19 12.6" />
      <path d="M5 12.6a11 11 0 0 1 5.2-2.4" />
      <path d="M10.7 5.1A16 16 0 0 1 22.6 9" />
      <path d="M1.4 9a16 16 0 0 1 4.7-2.9" />
      <path d="M8.5 16.1a6 6 0 0 1 7 0" />
      <circle cx="12" cy="20" r=".6" fill="currentColor" stroke="none" />
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

export function DocumentIcon(props: IconProps) {
  return (
    <Svg size={36} stroke={1.6} {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
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

export function InfoIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg size={size} stroke={2}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="16" x2="12" y2="11.5" />
      <circle cx="12" cy="8" r=".6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function BankIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10 12 4l9 6" />
      <path d="M5 10v8M12 10v8M19 10v8" />
      <path d="M3 18h18" />
    </Svg>
  );
}

export function ChevronIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg size={size} stroke={2}>
      <polyline points="15 18 9 12 15 6" />
    </Svg>
  );
}

/**
 * The stepper chevrons. Each points away from the label, toward its own edge: the start (right)
 * one points right and the end (left) one points left. Drawn as SVG so dir=rtl never flips them.
 */
export function OutwardChevron({ side }: { side: "start" | "end" }) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-points={side === "start" ? "right" : "left"}
    >
      <polyline points={side === "start" ? "9 6 15 12 9 18" : "15 6 9 12 15 18"} />
    </svg>
  );
}

export function ChevronDownIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size} stroke={2.25}>
      <polyline points="6 9 12 15 18 9" />
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

export function InboxIcon(props: IconProps) {
  return (
    <Svg size={22} {...props}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
    </Svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Svg size={20} stroke={2} {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg size={20} stroke={2} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props} stroke={props.stroke ?? 2.4}>
      <polyline points="20 6 9 17 4 12" />
    </Svg>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="7" r="1.3" fill="currentColor" />
      <circle cx="15" cy="7" r="1.3" fill="currentColor" />
      <circle cx="9" cy="12" r="1.3" fill="currentColor" />
      <circle cx="15" cy="12" r="1.3" fill="currentColor" />
      <circle cx="9" cy="17" r="1.3" fill="currentColor" />
      <circle cx="15" cy="17" r="1.3" fill="currentColor" />
    </svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 24} height={props.size ?? 24} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
    </svg>
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

export function GoogleIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const APP_F_PATH =
  "M35.07 75 C34.07 75 33.29 74.21 33.29 73.21 L33.29 26.79 C33.29 25.79 34.07 25 35.07 25 L67.93 25 C68.93 25 69.71 25.79 69.71 26.79 L69.71 34 C69.71 35 68.93 35.79 67.93 35.79 L45.86 35.79 L45.86 46.29 L66.5 46.29 C67.5 46.29 68.29 47.07 68.29 48.07 L68.29 55.29 C68.29 56.29 67.5 57.07 66.5 57.07 L45.86 57.07 L45.86 73.21 C45.86 74.21 45.07 75 44.07 75 Z";

/** White F on the band tile. Install uses 72px; a lock-screen row uses 38px. */
/** install: the install screen; note: a line's leading icon; tile: a home-screen tile in the setup demos. */
export function AppIcon({ size = "install" }: { size?: "install" | "note" | "tile" }) {
  return (
    <span className={`ui-app-icon ui-app-icon-${size}`} role="img" aria-label="Flow">
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

export function ShareIcon(props: IconProps) {
  return (
    <Svg size={22} stroke={1.8} {...props}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </Svg>
  );
}

export function SquarePlusIcon(props: IconProps) {
  return (
    <Svg size={22} stroke={1.8} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </Svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Svg size={26} stroke={1.8} {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg size={20} stroke={1.9} {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
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

/** FLOW-107. The interest part of a loan payment. */
export function PercentIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </Svg>
  );
}

/** FLOW-107. A part that stays out of the profit. */
export function EyeOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.4 3" />
      <path d="M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a9 9 0 0 0 4.4-1.1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
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

/** FLOW-504. The company currency row in Settings. */
export function CoinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2A2.6 2.6 0 0 0 12 8c-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4.1 0 1.1-1 1.9-2.5 1.9a2.7 2.7 0 0 1-2.5-1.2M12 6.5V8m0 8v1.5" />
    </Svg>
  );
}
