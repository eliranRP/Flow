import { Svg, type IconProps } from "./icons";

/**
 * Its own module, so only the lazy screens that hide a row carry it: icons.tsx sits in Home's
 * entry chunk, and every icon used anywhere lands there (FLOW-804 budget).
 */
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
