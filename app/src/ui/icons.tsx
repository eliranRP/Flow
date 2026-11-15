import type { ReactNode } from "react";

export type IconProps = {
  size?: number;
  stroke?: number;
};

export function Svg({ size = 24, stroke = 1.9, children }: IconProps & { children: ReactNode }) {
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

/** Paths from the 24-grid icon set the design board uses. */
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

export function PlusIcon(props: IconProps) {
  return (
    <Svg size={24} stroke={2.4} {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  );
}

/** A person: the הגדרות וחשבון row in Home's ⋯ sheet (FLOW-1103), and the team's members. */
export function PersonIcon(props: IconProps) {
  return (
    <Svg size={18} stroke={2} {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
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

export function DocumentIcon(props: IconProps) {
  return (
    <Svg size={36} stroke={1.6} {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </Svg>
  );
}

/** The reports tab (board ReportTab): a folded sheet with three bars. */
export function ReportsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
      <path d="M10 17v-3M13 17v-5M16 17v-2" />
    </Svg>
  );
}

/** An invoice: a folded sheet with two lines of text. */
export function InvoiceIcon(props: IconProps) {
  return (
    <Svg size={24} stroke={1.9} {...props}>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
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

/** FLOW-364 (board): the tab bar's הלוואות icon, a pediment on four columns over a base. */
export function BankColumnsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 9l9-6 9 6" />
      <path d="M6 10.5v7.5M10 10.5v7.5M14 10.5v7.5M18 10.5v7.5" />
      <path d="M3 20.5h18" />
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

export function MoreIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 24} height={props.size ?? 24} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** FLOW-415. A recurring charge (חיוב קבוע); the mockups' "repeat". Reads the same both ways, so it is not mirrored. */
export function RepeatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </Svg>
  );
}

/** FLOW-415. A charge above its usual amount, on Home's attention card. */
export function TrendUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </Svg>
  );
}

/** FLOW-415. A charge below its usual amount; TrendUpIcon turned over. */
export function TrendDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
      <polyline points="16 17 22 17 22 11" />
    </Svg>
  );
}

/** FLOW-601. The צוות row in Settings: two people, as in the mockup. */
export function PeopleIcon(props: IconProps) {
  return (
    <Svg size={24} stroke={1.9} {...props}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
    </Svg>
  );
}
