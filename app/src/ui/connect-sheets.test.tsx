import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MercuryConnectSheet } from "./mercury-connect-sheet";
import { SumitConnectSheet } from "./sumit-connect-sheet";

function Mercury({ onSubmit, busy = false }: { onSubmit: () => void; busy?: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); }}>פתיחה</button>
      <MercuryConnectSheet open={open} onOpenChange={setOpen} title="חיבור Mercury" apiKey={apiKey} setApiKey={setApiKey}
        submitLabel="חיבור" busy={busy} onSubmit={onSubmit} />
    </>
  );
}

function Sumit({ onSubmit }: { onSubmit: () => void }) {
  const [companyId, setCompanyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  return (
    <SumitConnectSheet open onOpenChange={() => undefined} title="חיבור SUMIT" companyId={companyId} setCompanyId={setCompanyId}
      apiKey={apiKey} setApiKey={setApiKey} submitLabel="חיבור" busy={false} onSubmit={onSubmit} />
  );
}

describe("connect sheets (FLOW-508)", () => {
  it("an empty Mercury key stays in the sheet with a message, and typing clears it", async () => {
    const onSubmit = vi.fn();
    render(<Mercury onSubmit={onSubmit} />);
    const dialog = await screen.findByRole("dialog", { name: "חיבור Mercury" });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    expect(onSubmit).not.toHaveBeenCalled();
    const key = within(dialog).getByLabelText("מפתח API");
    expect(key).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(key.getAttribute("aria-describedby") ?? "")).toHaveTextContent("חסר מפתח.");
    expect(key).toHaveFocus();
    fireEvent.change(key, { target: { value: "sample-token-12" } });
    expect(within(dialog).queryByText("חסר מפתח.")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("the message is on the field when it takes focus, and a closed sheet opens without it", async () => {
    render(<Mercury onSubmit={() => undefined} />);
    const dialog = await screen.findByRole("dialog", { name: "חיבור Mercury" });
    const key = within(dialog).getByLabelText("מפתח API");
    let invalidAtFocus: string | null = null;
    key.addEventListener("focus", () => { invalidAtFocus = key.getAttribute("aria-invalid"); });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    expect(invalidAtFocus).toBe("true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "חיבור Mercury" })).not.toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: "פתיחה" }));
    const again = await screen.findByRole("dialog", { name: "חיבור Mercury" });
    expect(within(again).queryByText("חסר מפתח.")).not.toBeInTheDocument();
    expect(within(again).getByLabelText("מפתח API")).not.toHaveAttribute("aria-invalid");
  });

  it("a blank-only key counts as empty", async () => {
    const onSubmit = vi.fn();
    render(<Mercury onSubmit={onSubmit} />);
    const dialog = await screen.findByRole("dialog", { name: "חיבור Mercury" });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(dialog).getByText("חסר מפתח.")).toBeInTheDocument();
  });

  it("the key is read-only while connect is busy", async () => {
    render(<Mercury onSubmit={() => undefined} busy />);
    const dialog = await screen.findByRole("dialog", { name: "חיבור Mercury" });
    expect(within(dialog).getByLabelText("מפתח API")).toHaveAttribute("readonly");
  });

  it("SUMIT names each empty field and focuses the first", async () => {
    const onSubmit = vi.fn();
    render(<Sumit onSubmit={onSubmit} />);
    const dialog = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(dialog).getByText("חסר מספר חברה.")).toBeInTheDocument();
    expect(within(dialog).getByText("חסר מפתח.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("מספר חברה")).toHaveFocus();
    fireEvent.change(within(dialog).getByLabelText("מספר חברה"), { target: { value: "123456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    expect(within(dialog).queryByText("חסר מספר חברה.")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("מפתח API")).toHaveFocus();
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "sample-key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
