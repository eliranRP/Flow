import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { flushSync } from "react-dom";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useFocusRowAfterRetry } from "./focus-retry";
import { padded } from "./story-support";

type Phase = "error" | "loading" | "ready";

let setHoldPhase: (phase: Phase) => void = () => undefined;

/**
 * The phase buttons take no focus, so a press leaves the keyboard where it
 * was. That is the reconnect: the retry unmounts without a user blur.
 */
function PhaseButton(props: { label: string; phase: Phase }) {
  function onMouseDown(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    setHoldPhase(props.phase);
  }
  return (
    <button type="button" onMouseDown={onMouseDown}>
      {props.label}
    </button>
  );
}

function RetryHold() {
  const retryRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>("error");
  useEffect(() => {
    setHoldPhase = setPhase;
    return () => {
      setHoldPhase = () => undefined;
    };
  }, []);
  useFocusRowAfterRetry(phase === "error", retryRef, rowRef, phase === "ready", 0);

  return (
    <div>
      <PhaseButton label="לטעינה" phase="loading" />
      <PhaseButton label="למוכן" phase="ready" />
      <PhaseButton label="לשגיאה" phase="error" />
      <button type="button">אחר</button>
      {phase === "loading" ? <p role="status">טוען</p> : null}
      {phase === "error" ? <button type="button" ref={retryRef}>ניסיון חוזר</button> : null}
      {phase === "ready" ? <button type="button" ref={rowRef}>השורה</button> : null}
    </div>
  );
}

const meta = {
  title: "Components/Focus retry",
  component: RetryHold,
  decorators: [padded],
} satisfies Meta<typeof RetryHold>;

export default meta;
type Story = StoryObj<typeof meta>;

function show(phase: Phase) {
  flushSync(() => { setHoldPhase(phase); });
}

/** Chromium removes a focused button with a blur while it is still connected. jsdom does not. */
export const HoldThroughRemoval: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const retry = canvas.getByRole("button", { name: "ניסיון חוזר" });
    retry.focus();
    await expect(retry).toHaveFocus();
    show("loading");
    await expect(canvas.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("status")).toBeInTheDocument();
    show("ready");
    await expect(canvas.getByRole("button", { name: "השורה" })).toHaveFocus();

    show("error");
    const again = canvas.getByRole("button", { name: "ניסיון חוזר" });
    again.focus();
    await expect(again).toHaveFocus();
    show("ready");
    await expect(canvas.getByRole("button", { name: "השורה" })).toHaveFocus();

    show("error");
    const parked = canvas.getByRole("button", { name: "ניסיון חוזר" });
    parked.focus();
    show("loading");
    const elsewhere = canvas.getByRole("button", { name: "אחר" });
    elsewhere.focus();
    await expect(elsewhere).toHaveFocus();
    show("ready");
    await expect(elsewhere).toHaveFocus();
    await expect(canvas.getByRole("button", { name: "השורה" })).not.toHaveFocus();
  },
};
