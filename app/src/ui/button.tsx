import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { ChevronDownIcon, ChevronIcon } from "./icons";
import { cx } from "./cx";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "link"
  | "danger-link";

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
  /** A 16px chevron after the label that turns when `expanded` (a link that opens a list in place). */
  expanded?: boolean;
  controls?: string;
  children: ReactNode;
  className?: string;
  title?: string;
  "aria-label"?: string;
  buttonRef?: Ref<HTMLButtonElement>;
};

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & { to?: undefined; href?: undefined };

/** A plain anchor: a mailto, or an outside page that opens in a new tab and says so (FLOW-357). */
type AsAnchor = Common & {
  href: string;
  external?: boolean;
  to?: undefined;
  disabled?: boolean;
};

type AsLink = Common & {
  to: string;
  href?: undefined;
  state?: unknown;
  /** Replaces the current history entry, as a sheet's own entry does. */
  replace?: boolean;
  disabled?: boolean;
};

export type ButtonProps = AsButton | AsLink | AsAnchor;

function isLink(props: ButtonProps): props is AsLink {
  return typeof props.to === "string";
}

function isAnchor(props: ButtonProps): props is AsAnchor {
  return typeof props.href === "string";
}

function labelText(children: ReactNode): string | undefined {
  return typeof children === "string" && children !== "" ? children : undefined;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "ui-btn-primary",
  secondary: "ui-btn-secondary",
  link: "ui-btn-link",
  "danger-link": "ui-btn-danger-link",
};

/** Press motion (FLOW-363): the four variants fade, and the filled and the outlined one also scale. */
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
        className="ui-btn-label"
        data-clip-ok={variant === "link" ? "" : undefined}
      >
        {props.children}
      </span>
      {props.iconEnd}
      {props.chevron ? <ChevronIcon size={16} /> : null}
      {props.expanded === undefined ? null : (
        <span className="ui-chevron-turn" data-open={props.expanded ? "true" : "false"}>
          <ChevronDownIcon size={16} />
        </span>
      )}
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
  if (isAnchor(props)) {
    const inert = props.busy || props.disabled;
    return (
      <a
        href={props.href}
        {...(props.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className={classes}
        aria-label={named["aria-label"]}
        aria-disabled={inert || undefined}
        aria-busy={props.busy || undefined}
        onClick={(event) => {
          if (inert) event.preventDefault();
        }}
      >
        {body}
        {props.external ? <span className="sr-only">(נפתח בלשונית חדשה)</span> : null}
      </a>
    );
  }
  const { busy, disabled, type = "button", full: _full, quiet: _quiet, variant: _variant, className: _className, children: _children, icon: _icon, iconEnd: _iconEnd, chevron: _chevron, expanded, controls, to: _to, href: _href, title: _title, "aria-label": _aria, buttonRef, onClick, ...rest } = props;
  return (
    <button
      ref={buttonRef}
      type={type}
      className={classes}
      disabled={disabled}
      aria-label={named["aria-label"]}
      aria-disabled={disabled || busy || undefined}
      aria-busy={busy || undefined}
      aria-expanded={expanded}
      aria-controls={controls}
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
