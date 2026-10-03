import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodeField } from "./code-field";

describe("CodeField", () => {
  it("hides the copy button when the value is empty", () => {
    const onCopy = vi.fn();
    render(
      <CodeField
        label="כתובת"
        labelId="code-empty"
        value=""
        failed={false}
        copyLabel="העתקה: כתובת"
        onCopy={onCopy}
      />,
    );
    const field = screen.getByRole("group", { name: "כתובת" });
    expect(field.querySelector("input")).toHaveValue("");
    expect(field.querySelector("input")).toHaveAttribute("autocomplete", "off");
    expect(screen.queryByRole("button", { name: "העתקה: כתובת" })).not.toBeInTheDocument();
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("names the copy control for the field and keeps the icon as the visible control", () => {
    const onCopy = vi.fn();
    render(
      <CodeField
        label="קוד"
        labelId="code-secret"
        value="example-code"
        failed={false}
        copyLabel="העתקה: קוד"
        onCopy={onCopy}
      />,
    );
    const button = screen.getByRole("button", { name: "העתקה: קוד" });
    expect(button).toHaveAttribute("aria-label", "העתקה: קוד");
    expect(button).not.toHaveTextContent("העתקה: קוד");
    expect(button.querySelector("input")).toBeNull();
    fireEvent.click(button);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("announces a refused copy under the field", () => {
    render(
      <CodeField
        fieldLabel="פקודת חיבור ל־Claude Code"
        value="claude mcp add"
        failed
        copyLabel="העתקה: פקודה"
        onCopy={() => undefined}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("העתיקו ידנית");
    expect(screen.getByRole("textbox")).toHaveAttribute("autocomplete", "off");
  });

  it("moves Home, End, and the arrows along the value", () => {
    render(
      <CodeField
        label="קוד"
        labelId="code-keys"
        value="abcdef"
        failed={false}
        copyLabel="העתקה: קוד"
        onCopy={() => undefined}
      />,
    );
    const input = screen.getByRole("textbox");
    input.focus();
    fireEvent.keyDown(input, { key: "End" });
    expect(input).toHaveProperty("selectionStart", 6);
    expect(input).toHaveProperty("selectionEnd", 6);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(input).toHaveProperty("selectionStart", 5);
    fireEvent.keyDown(input, { key: "Home" });
    expect(input).toHaveProperty("selectionStart", 0);
    expect(input).toHaveProperty("scrollLeft", 0);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(input).toHaveProperty("selectionStart", 1);
  });

  it("rebinds pan when dropping the label replaces the input", () => {
    const nativeAdd = Reflect.get(HTMLInputElement.prototype, "addEventListener") as (this: HTMLInputElement, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void;
    const nativeRemove = Reflect.get(HTMLInputElement.prototype, "removeEventListener") as (this: HTMLInputElement, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void;
    const live = new Map<EventTarget, Map<string, boolean | undefined>>();
    const note = (node: EventTarget, type: string, passive: boolean | undefined | null) => {
      const types = live.get(node) ?? new Map<string, boolean | undefined>();
      if (passive === null) types.delete(type);
      else types.set(type, passive);
      live.set(node, types);
    };
    const add = vi.spyOn(HTMLInputElement.prototype, "addEventListener").mockImplementation(function (this: HTMLInputElement, type, listener, options) {
      const passive = options != null && typeof options === "object" ? options.passive : undefined;
      note(this, type, passive);
      nativeAdd.call(this, type, listener, options);
    });
    const remove = vi.spyOn(HTMLInputElement.prototype, "removeEventListener").mockImplementation(function (this: HTMLInputElement, type, listener, options) {
      note(this, type, null);
      nativeRemove.call(this, type, listener, options);
    });
    const props = {
      value: "abcdef",
      failed: false as const,
      copyLabel: "העתקה: קוד",
      onCopy: () => undefined,
    };
    const { rerender, unmount } = render(<CodeField {...props} label="קוד" labelId="code-wheel" />);
    const first = screen.getByRole("textbox");
    expect(live.get(first)?.get("touchmove")).toBe(false);
    rerender(<CodeField {...props} fieldLabel="קוד" />);
    const second = screen.getByRole("textbox");
    expect(second).not.toBe(first);
    expect(live.get(first)?.has("touchmove")).toBe(false);
    expect(live.get(second)?.get("touchmove")).toBe(false);
    expect(live.get(second)?.get("wheel")).toBe(false);
    unmount();
    add.mockRestore();
    remove.mockRestore();
  });
});
