import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx";

/** Move a screen reader to a title without scrolling or drawing a ring. */
export function useFocusTitle<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}

export function FocusTitle({
  as: Tag = "h1",
  className,
  children,
}: {
  as?: "h1" | "h2";
  className?: string;
  children: ReactNode;
}) {
  const ref = useFocusTitle<HTMLHeadingElement>();
  return (
    <Tag ref={ref} tabIndex={-1} className={cx("ui-focus-title", className)}>
      {children}
    </Tag>
  );
}
