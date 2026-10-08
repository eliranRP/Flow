import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";

type Common = {
  label: string;
  children: ReactNode;
  onBand?: boolean;
  className?: string;
};

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "className"> & { to?: undefined };

/** `state` rides on the link's history entry; the search entry uses it to focus the field on arrival. */
type AsLink = Common & { to: string; state?: unknown };

export type IconButtonProps = AsButton | AsLink;

function isLink(props: IconButtonProps): props is AsLink {
  return typeof props.to === "string";
}

function assignRef(ref: Ref<HTMLButtonElement | HTMLAnchorElement> | null, node: HTMLButtonElement | HTMLAnchorElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

export const IconButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, IconButtonProps>(function IconButton(props, ref) {
  const className = cx("ui-icon-btn", props.onBand && "ui-icon-btn-on-band", props.className);
  if (isLink(props)) {
    return (
      <Link
        ref={(node) => {
          assignRef(ref, node);
        }}
        to={props.to}
        state={props.state}
        aria-label={props.label}
        className={className}
      >
        {props.children}
      </Link>
    );
  }
  const { label, children, onBand: _onBand, className: _className, type = "button", title: _nativeTitle, ...rest } = props;
  return (
    <button
      ref={(node) => {
        assignRef(ref, node);
      }}
      type={type}
      className={className}
      aria-label={label}
      {...rest}
    >
      {children}
    </button>
  );
});
