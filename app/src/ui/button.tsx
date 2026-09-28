import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "pill" | "danger" | "ghost";

type Common = {
  variant?: ButtonVariant;
  busy?: boolean;
  full?: boolean;
  children: ReactNode;
  className?: string;
};

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & { to?: undefined };

type AsLink = Common & { to: string };

export type ButtonProps = AsButton | AsLink;

function isLink(props: ButtonProps): props is AsLink {
  return typeof props.to === "string";
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "btn-pri",
  secondary: "btn-sec",
  pill: "ui-btn-pill",
  danger: "ui-btn-danger",
  ghost: "ui-btn-ghost",
};

export function Button(props: ButtonProps) {
  const variant = props.variant ?? "primary";
  const classes = cx("ui-btn", variantClass[variant], props.full && "ui-btn-full", props.className);
  const body = (
    <>
      {props.busy ? <span className="ui-spinner" aria-hidden="true" /> : null}
      {props.children}
    </>
  );
  if (isLink(props)) {
    return (
      <Link to={props.to} className={classes} aria-busy={props.busy || undefined}>
        {body}
      </Link>
    );
  }
  const { busy, disabled, type = "button", full: _full, variant: _variant, className: _className, children: _children, to: _to, ...rest } = props;
  return (
    <button type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {body}
    </button>
  );
}
