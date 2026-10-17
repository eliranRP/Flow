import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  SAMPLE_EXPENSE_LINE,
  SAMPLE_REFUND_LINE,
  SAMPLE_SPLIT_CATEGORIES,
  SAMPLE_SPLIT_PROJECTS,
  sampleSplitApi,
} from "../dev/line-split-sample";
import type { LineSplitRead, PartDraft, PayloadPart } from "../line-split";
import { renderWithProviders } from "../test-render";
import { SplitScreen } from "./flow-screens";
import { LineSplitScreen, type LineInfo, type LineSplitApi, type LineSplitSample } from "./line-split";

function showEditor(sample: Partial<LineSplitSample> & { line?: LineInfo } = {}) {
  const line = sample.line ?? SAMPLE_EXPENSE_LINE;
  const full: LineSplitSample = {
    line,
    categories: SAMPLE_SPLIT_CATEGORIES,
    projects: SAMPLE_SPLIT_PROJECTS,
    api: sampleSplitApi(line),
    ...sample,
  };
  return renderWithProviders(
    <Routes>
      <Route path="/transactions/:transactionId/split-category" element={<LineSplitScreen sample={full} />} />
      <Route path="/transactions/:transactionId" element={<p>פרטי התנועה</p>} />
    </Routes>,
    { route: `/transactions/${line.id}/split-category` },
  );
}

/** An api whose save records each request and can be told to fail. */
function recordingApi(line: LineInfo, fail?: Error) {
  const saved: PayloadPart[][] = [];
  const base = sampleSplitApi(line);
  const api: LineSplitApi = {
    preview: base.preview,
    save: async (parts) => {
      saved.push(parts);
      if (fail) throw fail;
      await base.save(parts);
    },
  };
  return { api, saved };
}

const expenseParts: PartDraft[] = [
  { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "percent", value: "30" },
  { key: "b", categoryId: "c-ins", projectId: "p-raan", unit: "amount", value: "500" },
];

function restRow() {
  return screen.getByRole("button", { name: /^השאר,/ });
}

/** "+ חלק נוסף" adds a part at once, on the line's category; its category button is the newest. */
function addPart() {
  fireEvent.click(screen.getByRole("button", { name: "חלק נוסף" }));
  const buttons = screen.getAllByRole("button", { name: /, קטגוריה, שינוי$/ });
  return buttons[buttons.length - 1] as HTMLElement;
}

describe("split by category editor (FLOW-325)", () => {
  it("adds a part through the picker, flips its unit, and the rest follows the server preview", async () => {
    showEditor();
    expect(screen.getByRole("heading", { name: "פיצול" })).toBeInTheDocument();
    fireEvent.click(addPart());
    const categorySheet = await screen.findByRole("dialog", { name: /^(בחירת קטגוריה|קטגוריה לחלק \d+)$/ });
    fireEvent.click(within(categorySheet).getByRole("radio", { name: "חשמל" }));
    fireEvent.click(within(categorySheet).getByRole("button", { name: "שמירה" }));
    // The category pick moves straight on to the project list.
    const projectSheet = await screen.findByRole("dialog", { name: /^(בחירת פרויקט|פרויקט לחלק \d+)$/ });
    expect(within(projectSheet).getByRole("radio", { name: "פרויקט גבעתיים · פרויקט השורה" })).toBeInTheDocument();
    fireEvent.click(within(projectSheet).getByRole("radio", { name: "פרויקט הרצליה" }));
    fireEvent.click(within(projectSheet).getByRole("button", { name: "שמירה" }));
    // Two sheets close one after the other (each waits out --motion-sheet-out); under a loaded
    // full run that took longer than waitFor's 1s default (FLOW-363 2b gate), so allow 3s.
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); }, { timeout: 3000 });
    fireEvent.change(screen.getByLabelText("סכום, חשמל"), { target: { value: "500" } });
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪4,300"); });
    expect(screen.getByText("10%", { selector: "bdi" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "%" }));
    expect(screen.getByLabelText("אחוז, חשמל")).toHaveValue("10.42");
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪4,299.84"); });
  }, 15_000);

  it("saves on ✕ with each part's percent, amount and the rest, then toasts with ביטול", async () => {
    const { api, saved } = recordingApi(SAMPLE_EXPENSE_LINE);
    showEditor({ parts: expenseParts, api });
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪2,860"); });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("הפיצול נשמר")).toBeInTheDocument();
    expect(saved).toEqual([[
      { category_id: "c-elec", project_id: "p-herz", percent: 30 },
      { category_id: "c-ins", project_id: "p-raan", amount_minor: 50_000 },
      { rest: true },
    ]]);
    expect(await screen.findByText("פרטי התנועה")).toBeInTheDocument();
    // ביטול puts back what was there before: nothing, so the split is cleared.
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("הפיצול הקודם חזר")).toBeInTheDocument();
    expect(saved[1]).toEqual([]);
  });

  it("a reversal part with no project holds the first ✕, and the second discards", async () => {
    const { api, saved } = recordingApi(SAMPLE_REFUND_LINE);
    showEditor({
      line: SAMPLE_REFUND_LINE,
      api,
      parts: [{ key: "a", categoryId: "c-build", projectId: null, unit: "percent", value: "40" }],
    });
    const pick = screen.getByRole("button", { name: /^פרויקט · חובה בהחזר, פרויקט, שינוי/ });
    expect(pick).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    // FLOW-343: said once, on the part's red line. The hold line keeps it for screen readers only.
    const hold = await screen.findByText("בחרו פרויקט לחלק ההחזר.");
    expect(hold).toHaveClass("sr-only");
    expect(screen.queryByText("חלק החזר צריך פרויקט.")).toBeNull();
    expect(pick.querySelector(".ui-lsplit-project-error")?.textContent).toBe("פרויקט · חובה בהחזר");
    expect(screen.getByRole("button", { name: "ביטול השינוי" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("פרטי התנועה")).toBeInTheDocument();
    expect(saved).toEqual([]);
  });

  it("the refund's category picker offers expense categories as reversals, and a reversal asks for a project", async () => {
    showEditor({ line: SAMPLE_REFUND_LINE });
    fireEvent.click(addPart());
    const sheet = await screen.findByRole("dialog", { name: /^(בחירת קטגוריה|קטגוריה לחלק \d+)$/ });
    // FLOW-333 C3c: on a refund line the reversal section starts open.
    expect(within(sheet).getByRole("button", { name: "החזר מספק" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(sheet).getByRole("radio", { name: "קבלני משנה" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "שמירה" }));
    const projects = await screen.findByRole("dialog", { name: /^(בחירת פרויקט|פרויקט לחלק \d+)$/ });
    expect(within(projects).getByText("חלק החזר צריך פרויקט.")).toBeInTheDocument();
    expect(within(projects).queryByRole("radio", { name: /פרויקט השורה/ })).toBeNull();
  });

  it("a reversal part in a kept-out category shows its own category checked, and שמירה waits for a change (FLOW-325, 0138, FLOW-831)", async () => {
    showEditor({
      line: SAMPLE_REFUND_LINE,
      categories: [...SAMPLE_SPLIT_CATEGORIES, { id: "c-owner", name: "משיכות בעלים", kind: "expense", hidden: false, excluded_from_pnl: true }],
      parts: [{ key: "a", categoryId: "c-owner", projectId: null, unit: "percent", value: "40" }],
    });
    expect(screen.getByRole("button", { name: /^משרד · פרויקט השורה, פרויקט, שינוי/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^משיכות בעלים, החזר, קטגוריה, שינוי/ }));
    // The part's own kept-out category is the only kept-out reversal listed (0138), and it is the saved value.
    // Keeping the line's project without a project pick is covered by the reversalNeedsProject tests in src/line-split.test.ts.
    const categorySheet = await screen.findByRole("dialog", { name: /^(בחירת קטגוריה|קטגוריה לחלק \d+)$/ });
    expect(within(categorySheet).getByRole("radio", { name: "משיכות בעלים" })).toBeChecked();
    expect(within(categorySheet).getByRole("button", { name: "שמירה" })).toBeDisabled();
  });

  it("shows the over amount in the footer and on the part edited last, once (FLOW-333 C5)", async () => {
    showEditor({
      parts: [
        { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "percent", value: "70" },
        { key: "b", categoryId: "c-ins", projectId: "p-raan", unit: "amount", value: "2000" },
      ],
    });
    expect(screen.getByText(/חולק יותר מהסכום/, { selector: "p" })).toBeInTheDocument();
    // Before any ✕ the part edited last says its problem in its note (FLOW-922), with no hold line.
    const sentence = "החלקים עוברים את השורה ב־₪560. הקטינו חלק.";
    expect(document.querySelector(".ui-lsplit-note-flagged")?.textContent).toBe("יותר מהסכום ב־₪560");
    expect(screen.queryAllByText(sentence)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "ביטול השינוי" })).toBeNull();
    expect(screen.queryByText(/גבוהים מהשורה/)).toBeNull();
    expect(restRow()).toHaveTextContent("₪0");
    // The 70% part keeps its ₪ figure while the split can't be previewed.
    expect(screen.getByText("₪3,360")).toBeInTheDocument();
    // After the first ✕ it moves to the hold line, still once.
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByRole("button", { name: "ביטול השינוי" })).toBeInTheDocument();
    expect(screen.getAllByText(sentence)).toHaveLength(1);
    expect(document.querySelector(".ui-lsplit-note-flagged")).toBeNull();
  });

  it("reads an over amount past 1,000 with separators (FLOW-333 C1, FLOW-922 problem note)", () => {
    // The over problem replaces the share line, so the figure is the amount over the line.
    showEditor({ parts: [{ key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "1234567.89" }] });
    expect(document.querySelector(".ui-lsplit-note-flagged")?.textContent).toContain("1,229,767.89");
  });

  it("a picked part hands focus to its value field, and lists the line's project once (FLOW-333 C3a, C9)", async () => {
    showEditor({ parts: [{ key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "percent", value: "" }] });
    fireEvent.change(screen.getByLabelText("אחוז, חשמל"), { target: { value: "20" } });
    fireEvent.click(addPart());
    const categorySheet = await screen.findByRole("dialog", { name: /^(בחירת קטגוריה|קטגוריה לחלק \d+)$/ });
    fireEvent.click(within(categorySheet).getByRole("radio", { name: "ביטוח" }));
    fireEvent.click(within(categorySheet).getByRole("button", { name: "שמירה" }));
    // The project sheet is asked for again before each step: the category sheet's close swaps the
    // page under it, so a sheet element held from the first find can be detached when clicked.
    const projectSheet = () => screen.getByRole("dialog", { name: /^(בחירת פרויקט|פרויקט לחלק \d+)$/ });
    await waitFor(() => { expect(within(projectSheet()).getByRole("radio", { name: "פרויקט גבעתיים · פרויקט השורה" })).toBeInTheDocument(); });
    expect(within(projectSheet()).queryByRole("radio", { name: "פרויקט גבעתיים" })).toBeNull();
    fireEvent.click(within(projectSheet()).getByRole("radio", { name: "פרויקט הרצליה" }));
    fireEvent.click(within(projectSheet()).getByRole("button", { name: "שמירה" }));
    // Two sheets close one after the other (each waits out --motion-sheet-out), so allow 3s.
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); }, { timeout: 3000 });
    // A new part is in ₪ (the amount), so the focus lands on its amount field.
    await waitFor(() => { expect(screen.getByLabelText("סכום, ביטוח")).toHaveFocus(); });
  });

  it("maps a server refusal to a banner and keeps the screen open", async () => {
    const { api } = recordingApi(SAMPLE_EXPENSE_LINE, new Error("line has an open review"));
    showEditor({ parts: expenseParts, api });
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪2,860"); });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("אשרו את התנועה בתור לאישור, ואז פצלו.")).toBeInTheDocument();
    expect(screen.queryByText("פרטי התנועה")).toBeNull();
  });

  it("an open review's לתור opens that card when its id is known, else the queue (FLOW-327 r1)", () => {
    const first = showEditor({ parts: expenseParts, line: { ...SAMPLE_EXPENSE_LINE, reviewBlocked: true, reviewId: "rv-9" } });
    expect(screen.getByRole("link", { name: "לתור" }).getAttribute("href")).toMatch(/^\/review\?item=rv-9&from=all/);
    first.unmount();
    showEditor({ parts: expenseParts, line: { ...SAMPLE_EXPENSE_LINE, reviewBlocked: true } });
    expect(screen.getByRole("link", { name: "לתור" }).getAttribute("href")).toMatch(/^\/review(\?|$)/);
  });

  it("a dropped connection toasts ניסיון חוזר and keeps the values", async () => {
    const { api, saved } = recordingApi(SAMPLE_EXPENSE_LINE, new Error("Failed to fetch"));
    showEditor({ parts: expenseParts, api });
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪2,860"); });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("הפיצול לא נשמר")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.getByLabelText("אחוז, חשמל")).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר" }));
    await waitFor(() => { expect(saved).toHaveLength(2); });
  });

  it("a server reason from the preview shows before the save", async () => {
    showEditor({
      parts: [{ key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "4800" }],
      warned: true,
    });
    expect(await screen.findAllByText("לא נשאר סכום לשאר. הוסיפו חלק או הקטינו את החלק.")).not.toHaveLength(0);
  });

  it("clearing asks first, then ביטול re-sends the saved parts as amounts", async () => {
    const split: LineSplitRead = {
      transactionId: SAMPLE_EXPENSE_LINE.id,
      currency: "ILS",
      lineMinor: 480_000n,
      partsMatch: true,
      parts: [
        { category_id: "c-elec", category_name: "חשמל", project_id: "p-herz", project_name: "פרויקט הרצליה", amount_minor: 144_000n, percent: 30, rest: false },
        { category_id: "c-build", category_name: "חומרי בניין", project_id: null, project_name: null, amount_minor: 336_000n, percent: null, rest: true },
      ],
    };
    const { api, saved } = recordingApi(SAMPLE_EXPENSE_LINE);
    showEditor({ split, api });
    expect(screen.getByLabelText("אחוז, חשמל")).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "הסרת הפיצול" }));
    // Full runs load the machine, so each wait gets more than the 1s default (FLOW-325 flake).
    const confirm = await screen.findByRole("dialog", { name: "להסיר את הפיצול?" }, { timeout: 5000 });
    expect(within(confirm).getByText("השורה תיספר שוב כולה תחת חומרי בניין · פרויקט גבעתיים.")).toBeInTheDocument();
    expect(saved).toEqual([]);
    fireEvent.click(within(confirm).getByRole("button", { name: "הסרה" }));
    expect(await screen.findByText("הפיצול הוסר", undefined, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => { expect(saved[0]).toEqual([]); }, { timeout: 5000 });
    // The confirm sheet has its own ביטול, so press the toast's action, not whichever button is found first.
    const undo = await waitFor(() => {
      const action = document.querySelector(".ui-toast-host .ui-toast-action");
      if (!(action instanceof HTMLButtonElement) || action.getAttribute("aria-label") !== "ביטול") throw new Error("no ביטול on the toast yet");
      return action;
    }, { timeout: 5000 });
    fireEvent.click(undo);
    await waitFor(() => {
      expect(saved[1]).toEqual([
        { category_id: "c-elec", project_id: "p-herz", amount_minor: 144_000 },
        { category_id: "c-build", project_id: null, amount_minor: 336_000 },
      ]);
    }, { timeout: 5000 });
  }, 20_000);

  it("a split_mismatch line saves its parts again on ✕ with no edit, and offers no ביטול", async () => {
    const mismatch: LineSplitRead = {
      transactionId: SAMPLE_EXPENSE_LINE.id,
      currency: "ILS",
      lineMinor: 500_000n,
      partsMatch: false,
      parts: [
        { category_id: "c-elec", category_name: "חשמל", project_id: "p-herz", project_name: "פרויקט הרצליה", amount_minor: 144_000n, percent: 30, rest: false },
        { category_id: "c-build", category_name: "חומרי בניין", project_id: null, project_name: null, amount_minor: 336_000n, percent: null, rest: true },
      ],
    };
    const line = { ...SAMPLE_EXPENSE_LINE, amountNet: -500_000n };
    const { api, saved } = recordingApi(line);
    showEditor({ line, split: mismatch, api });
    await waitFor(() => { expect(restRow()).toHaveTextContent("₪3,500"); });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("הפיצול נשמר")).toBeInTheDocument();
    expect(saved).toEqual([[{ category_id: "c-elec", project_id: "p-herz", percent: 30 }, { rest: true }]]);
    // The parts before did not sum to the line, so they cannot be put back.
    expect(screen.queryByRole("button", { name: "ביטול" })).toBeNull();
  });

  it("+ חלק נוסף adds a part at once, on the line's category, with what is left (FLOW-922)", () => {
    showEditor({ parts: expenseParts });
    fireEvent.click(screen.getByRole("button", { name: "חלק נוסף" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const amounts = screen.getAllByLabelText(/^(סכום|אחוז), /);
    expect(amounts).toHaveLength(3);
    // ₪4,800 less 30% (₪1,440) and ₪500 is ₪2,860 left for the new part.
    expect(amounts[2]).toHaveValue("2,860");
    expect(screen.getAllByRole("button", { name: /^חומרי בניין, קטגוריה, שינוי/ }).length).toBeGreaterThan(0);
  });

  it("חלוקה שווה on an empty split makes two parts that sum to the line, the last takes the cents (FLOW-922)", () => {
    showEditor({ line: { ...SAMPLE_EXPENSE_LINE, amountNet: -894_017n }, parts: [] });
    fireEvent.click(screen.getByRole("button", { name: "חלוקה שווה" }));
    const amounts = screen.getAllByLabelText(/^סכום, /);
    expect(amounts).toHaveLength(2);
    expect(amounts[0]).toHaveValue("4,470.08");
    expect(amounts[1]).toHaveValue("4,470.09");
  });

  it("a part's project picker is headed for its part and greys the project another part already pairs with its category (FLOW-922)", async () => {
    showEditor({
      parts: [
        { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "100" },
        { key: "b", categoryId: "c-elec", projectId: "p-raan", unit: "amount", value: "200" },
      ],
      target: { partKey: "b", kind: "project" },
    });
    const sheet = await screen.findByRole("dialog", { name: "פרויקט לחלק 2" });
    expect(within(sheet).getByRole("radio", { name: "פרויקט הרצליה" })).toBeDisabled();
    expect(within(sheet).getByText("כבר בפיצול עם חשמל")).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: "פרויקט רעננה" })).toBeEnabled();
  });

  it("switching % to ₪ before any preview keeps the money: the line × percent", () => {
    showEditor({ parts: [{ key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "percent", value: "30" }] });
    // No preview has come back yet (it waits 250ms).
    fireEvent.click(screen.getByRole("radio", { name: "₪" }));
    expect(screen.getByLabelText("סכום, חשמל")).toHaveValue("1,440");
  });

  it("a part's message describes its field and its pick button", () => {
    showEditor({
      parts: [
        { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "100" },
        { key: "b", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "200" },
      ],
    });
    // The first part is the one kept; only the later duplicate says so (FLOW-922).
    expect(screen.getAllByLabelText("סכום, חשמל")[0]).not.toHaveAttribute("aria-describedby");
    const field = screen.getAllByLabelText("סכום, חשמל")[1];
    const id = field?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)).toHaveTextContent("הפרויקט והקטגוריה האלה כבר בפיצול");
    expect(screen.getAllByRole("button", { name: /^חשמל, קטגוריה, שינוי/ })[1]).toHaveAttribute("aria-describedby", id);
  });

  it("the rest row's message sits outside its button and describes it", () => {
    showEditor({ line: { ...SAMPLE_EXPENSE_LINE, categoryId: null, categoryName: null }, parts: expenseParts });
    const row = restRow();
    const id = row.getAttribute("aria-describedby") ?? "";
    const message = document.getElementById(id);
    expect(message).toHaveAttribute("role", "status");
    expect(row).not.toContainElement(message);
    expect(message).toHaveTextContent("לשורה אין קטגוריה. בחרו קטגוריה לשאר.");
  });

  it("the picker hands focus to the part's value field when it closes", async () => {
    showEditor({ parts: expenseParts });
    const pick = screen.getByRole("button", { name: /^ביטוח, קטגוריה, שינוי/ });
    pick.focus();
    fireEvent.click(pick);
    const sheet = await screen.findByRole("dialog", { name: /^(בחירת קטגוריה|קטגוריה לחלק \d+)$/ });
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    // A part's picker hands focus to its value field on close (FLOW-333 C3a), not back to the pick.
    await waitFor(() => { expect(screen.getByLabelText("סכום, ביטוח")).toHaveFocus(); });
  });

  it("הסרת הפיצול stays open on a line the server will not split, and clearing offers no ביטול", async () => {
    const split: LineSplitRead = {
      transactionId: SAMPLE_EXPENSE_LINE.id,
      currency: "ILS",
      lineMinor: 480_000n,
      partsMatch: true,
      parts: [
        { category_id: "c-elec", category_name: "חשמל", project_id: "p-herz", project_name: "פרויקט הרצליה", amount_minor: 144_000n, percent: null, rest: false },
        { category_id: "c-build", category_name: "חומרי בניין", project_id: null, project_name: null, amount_minor: 336_000n, percent: null, rest: true },
      ],
    };
    const line = { ...SAMPLE_EXPENSE_LINE, loanSplit: true };
    const { api, saved } = recordingApi(line);
    showEditor({ line, split, api });
    expect(screen.getByLabelText("סכום, חשמל")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "הסרת הפיצול" }));
    const confirm = await screen.findByRole("dialog", { name: "להסיר את הפיצול?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "הסרה" }));
    expect(await screen.findByText("הפיצול הוסר")).toBeInTheDocument();
    expect(saved).toEqual([[]]);
    // The confirm sheet's own ביטול leaves with the sheet; only then is "no undo" meaningful.
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    expect(screen.queryByRole("button", { name: "ביטול" })).toBeNull();
  });

  it("an unchanged editor closes with no write", async () => {
    const save = vi.fn();
    showEditor({ api: { preview: () => Promise.resolve([]), save } });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("פרטי התנועה")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("the saving state disables every field and ✕", () => {
    showEditor({ parts: expenseParts, saving: true });
    expect(screen.getByRole("button", { name: "סגירה" })).toBeDisabled();
    expect(screen.getByLabelText("אחוז, חשמל")).toBeDisabled();
  });
});

describe("the project split on a line split by category (FLOW-325)", () => {
  it("says why instead of offering ניסיון חוזר", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("line has a split by category")));
    renderWithProviders(
      <Routes>
        <Route
          path="/split"
          element={
            <SplitScreen
              sampleAmount={100_000n}
              sampleProjects={[
                { id: "p1", name: "פרויקט הרצליה" },
                { id: "p2", name: "פרויקט רעננה" },
              ]}
              sampleParts={[{ projectId: "p2", value: "250" }]}
              backTo="/back"
              onSave={onSave}
            />
          }
        />
        <Route path="/back" element={<h1>חזרה</h1>} />
      </Routes>,
      { route: "/split" },
    );
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום, פרויקט רעננה" }), { target: { value: "300" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
      await Promise.resolve();
    });
    expect(await screen.findByText("לשורה יש פיצול לפי קטגוריות. אפשר רק אחד מהשניים.")).toBeInTheDocument();
    expect(screen.queryByText("הפיצול לא נשמר")).toBeNull();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).toBeNull();
  });
});
