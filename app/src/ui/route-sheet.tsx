import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useGoBack } from "./back";
import { Sheet, showRingUntilBlur } from "./sheet";

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
  onRequestClose,
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
  onBeforeClose?: () => undefined | boolean | Promise<undefined | boolean>;
  onRequestClose?: RefObject<(() => void) | null>;
  children?: ReactNode;
}) {
  const goBack = useGoBack();
  const leaving = useRef(false);
  const [open, setOpen] = useState(true);
  const byKey = useRef(false);

  useEffect(() => {
    const ref = returnFocusRef;
    return () => {
      if (!ref) return;
      const started = performance.now();
      const tryFocus = () => {
        if (document.querySelector('[role="dialog"]')) {
          if (performance.now() - started < 400) window.requestAnimationFrame(tryFocus);
          return;
        }
        const el = ref.current;
        if (!el?.isConnected) return;
        el.focus();
        // FLOW-310: after Escape the returned focus shows its ring, as in Sheet.
        if (byKey.current) showRingUntilBlur(el);
      };
      window.setTimeout(tryFocus, 0);
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
      onRequestClose={onRequestClose}
      onCloseKind={(key) => {
        byKey.current = key;
      }}
      onOpenChange={(next) => {
        if (!next) leave();
      }}
    >
      {children}
    </Sheet>
  );
}
