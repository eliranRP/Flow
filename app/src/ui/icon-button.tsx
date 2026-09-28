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

type AsLink = Common & { to: string };

export type IconButtonProps = AsButton | AsLink;

function isLink(props: IconButtonProps): props is AsLink {
  return typeof props.to === "string";
}

export const IconButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, IconButtonProps>(function IconButton(props, ref) {
  const className = cx("ui-icon-btn", props.onBand && "ui-icon-btn-on-band", props.className);
  if (isLink(props)) {
    return (
      <Link ref={ref as Ref<HTMLAnchorElement>} to={props.to} aria-label={props.label} className={className}>
        {props.children}
      </Link>
    );
  }
  const { label, children, onBand: _onBand, className: _className, type = "button", ...rest } = props;
  return (
    <button ref={ref as Ref<HTMLButtonElement>} type={type} className={className} aria-label={label} {...rest}>
      {children}
    </button>
  );
});
