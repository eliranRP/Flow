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

export function TrashIcon(props: IconProps) {
  return (
    <Svg size={20} stroke={2} {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
    </Svg>
  );
}
