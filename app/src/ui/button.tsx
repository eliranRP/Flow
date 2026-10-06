import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "pill" | "danger" | "danger-tint" | "ghost";

type Common = {
  variant?: ButtonVariant;
  busy?: boolean;
  full?: boolean;
  quiet?: boolean;
  icon?: ReactNode;
  /** Sits at the inline end, after the label. */
  iconEnd?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
  "aria-label"?: string;
  buttonRef?: Ref<HTMLButtonElement>;
};

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & { to?: undefined };

type AsLink = Common & { to: string; state?: unknown };

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
  pill: "ui-btn-pill",
  danger: "ui-btn-danger",
  "danger-tint": "ui-btn-danger-tint",
  ghost: "ui-btn-ghost",
};

export function Button(props: ButtonProps) {
  const variant = props.variant ?? "primary";
  const classes = cx(
    "ui-btn",
    variantClass[variant],
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
    </>
  );
  const named = {
    "aria-label": props["aria-label"] ?? label,
  };
  if (isLink(props)) {
    return (
      <Link
        to={props.to}
        state={props.state}
        className={classes}
        aria-label={named["aria-label"]}
        aria-disabled={props.busy || undefined}
        aria-busy={props.busy || undefined}
        onClick={(event) => {
          if (props.busy) event.preventDefault();
        }}
      >
        {body}
      </Link>
    );
  }
  const { busy, disabled, type = "button", full: _full, quiet: _quiet, variant: _variant, className: _className, children: _children, icon: _icon, iconEnd: _iconEnd, to: _to, title: _title, "aria-label": _aria, buttonRef, onClick, ...rest } = props;
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
