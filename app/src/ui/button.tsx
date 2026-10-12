import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { ChevronIcon } from "./icons";
import { cx } from "./cx";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "link"
  | "danger-link"
  | "pill"
  | "danger"
  | "danger-tint"
  | "ghost";

type Common = {
  variant?: ButtonVariant;
  busy?: boolean;
  full?: boolean;
  quiet?: boolean;
  icon?: ReactNode;
  /** Sits at the inline end, after the label. */
  iconEnd?: ReactNode;
  /** A left-pointing chevron after the label (it points left in RTL too). */
  chevron?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
  "aria-label"?: string;
  buttonRef?: Ref<HTMLButtonElement>;
};

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & { to?: undefined };

type AsLink = Common & {
  to: string;
  state?: unknown;
  /** Replaces the current history entry, as a sheet's own entry does. */
  replace?: boolean;
  disabled?: boolean;
};

export type ButtonProps = AsButton | AsLink;

function isLink(props: ButtonProps): props is AsLink {
  return typeof props.to === "string";
}

function labelText(children: ReactNode): string | undefined {
  return typeof children === "string" && children !== "" ? children : undefined;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "ui-btn-primary",
  secondary: "ui-btn-secondary",
  link: "ui-btn-link",
  "danger-link": "ui-btn-danger-link",
  pill: "ui-btn-pill",
  danger: "ui-btn-danger",
  "danger-tint": "ui-btn-danger-tint",
  ghost: "ui-btn-ghost",
};

/** Press motion (FLOW-363): the new variants fade, and the two filled or outlined ones also scale. */
const pressClass: Partial<Record<ButtonVariant, string>> = {
  primary: "m-press m-press-scale",
  secondary: "m-press m-press-scale",
  link: "m-press",
  "danger-link": "m-press",
};

export function Button(props: ButtonProps) {
  const variant = props.variant ?? "primary";
  const classes = cx(
    "ui-btn",
    variantClass[variant],
    pressClass[variant],
    props.quiet && "ui-btn-quiet",
    props.full && "ui-btn-full",
    props.className,
  );
  const label = labelText(props.children);
  const body = (
    <>
      {props.busy ? <span className="ui-spinner" aria-hidden="true" /> : null}
      {props.icon}
      <span
        className={variant === "pill" ? "ui-pill-label" : "ui-btn-label"}
        data-clip-ok={variant === "pill" ? "" : undefined}
      >
        {props.children}
      </span>
      {props.iconEnd}
      {props.chevron ? <ChevronIcon size={16} /> : null}
    </>
  );
  const named = {
    "aria-label": props["aria-label"] ?? label,
  };
  if (isLink(props)) {
    const inert = props.busy || props.disabled;
    return (
      <Link
        to={props.to}
        state={props.state}
        replace={props.replace}
        className={classes}
        aria-label={named["aria-label"]}
        aria-disabled={inert || undefined}
        aria-busy={props.busy || undefined}
        onClick={(event) => {
          if (inert) event.preventDefault();
        }}
      >
        {body}
      </Link>
    );
  }
  const { busy, disabled, type = "button", full: _full, quiet: _quiet, variant: _variant, className: _className, children: _children, icon: _icon, iconEnd: _iconEnd, chevron: _chevron, to: _to, title: _title, "aria-label": _aria, buttonRef, onClick, ...rest } = props;
  return (
    <button
      ref={buttonRef}
      type={type}
      className={classes}
      disabled={disabled}
      aria-label={named["aria-label"]}
      aria-disabled={disabled || busy || undefined}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...rest}
    >
      {body}
    </button>
  );
}
