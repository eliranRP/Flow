import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type IconButtonProps = {
  label: string;
  children: ReactNode;
  onBand?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label">;

export function IconButton({ label, children, onBand = false, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx("icon-btn", "ui-icon-btn", onBand && "icon-btn-on-band", className)}
      aria-label={label}
      {...rest}
    >
      {children}
    </button>
  );
}
