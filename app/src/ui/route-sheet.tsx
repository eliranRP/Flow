import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useGoBack } from "./back";
import { Sheet } from "./sheet";

/**
 * The sheet is a real route (`/add`, `/review/change`). Opening it pushes
 * history. Closing pops that entry at once, so the screen underneath is the
 * one that opened the sheet. A deep link replaces itself with `closeTo`.
 */
export function RouteSheet({
  title,
  closeTo,
  hint,
  action,
  leading,
  returnFocusRef,
  panelClassName,
  footClassName,
  titleRef,
  onEscape,
  onBeforeClose,
  children,
}: {
  title: string;
  closeTo: string;
  hint?: string;
  action?: ReactNode;
  leading?: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
  panelClassName?: string;
  footClassName?: string;
  titleRef?: RefObject<HTMLHeadingElement | null>;
  onEscape?: () => void;
  onBeforeClose?: () => void;
  children?: ReactNode;
}) {
  const goBack = useGoBack();
  const leaving = useRef(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const ref = returnFocusRef;
    return () => {
      if (!ref) return;
      window.setTimeout(() => {
        if (document.querySelector('[role="dialog"]')) return;
        const el = ref.current;
        if (el?.isConnected) el.focus();
      }, 0);
    };
  }, [returnFocusRef]);

  function leave() {
    if (leaving.current) return;
    leaving.current = true;
    setOpen(false);
    goBack(closeTo);
  }

  return (
    <Sheet
      open={open}
      title={title}
      hint={hint}
      action={action}
      leading={leading}
      panelClassName={panelClassName}
      footClassName={footClassName}
      titleRef={titleRef}
      onEscape={onEscape}
      onBeforeClose={onBeforeClose}
      onOpenChange={(next) => {
        if (!next) leave();
      }}
    >
      {children}
    </Sheet>
  );
}
