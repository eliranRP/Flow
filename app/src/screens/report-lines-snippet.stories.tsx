import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CATEGORY_ROWS, CategoryLinesView, inView, line, titleLines } from "./report-lines-story-support";

/**
 * FLOW-170 and FLOW-169: the reports drill-down's search, for a line found by its description. The
 * title is laid out whole first and cut only when a matched word would fall past its three lines
 * (report-lines-snippet.tsx says the rule). Every story here runs in light and dark.
 */
const meta = {
  title: "Screens/Reports/Drill-down search",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const phone320 = { globals: { viewport: { value: "flow320", isRotated: false } } };
const phone393 = { globals: { viewport: { value: "flow393", isRotated: false } } };

const NO_SPACES = "INV/2026/10/0042/BUILDING-B/WATERHEATER/REPLACEMENT/PARTS-AND-LABOUR/SHUTOFF-VALVES/EXPANSION-TANK/UNIT2/FINAL";
const CLOSE_WORDS = "Yearly visit to the storage rooms and the shared laundry on the ground floor, then the gas meter check and the chimney sweep";
const TWO_WORDS = "Quarterly service visit for the boiler room and the shared laundry on the ground floor, parts, labour, inspection 120";

const ROWS = [
  ...CATEGORY_ROWS,
  line("0008", "2026-08-12", 300, "Maple Ave", "Northside Hardware", NO_SPACES),
  line("0009", "2026-08-02", 500, "Oak Ridge", "Bright Electric", TWO_WORDS),
  line("0010", "2026-07-28", 200, "Maple Ave", "Bright Electric", CLOSE_WORDS),
];

/** Types the search and waits for one row; returns it, its title and the title's drawn text. */
async function searchOne(canvasElement: HTMLElement, words: string) {
  const field = within(canvasElement).getByRole("searchbox", { name: "חיפוש בתנועות" });
  await userEvent.clear(field);
  await userEvent.type(field, words);
  await waitFor(() => expect(canvasElement.querySelectorAll(".ui-lines-group .ui-row")).toHaveLength(1));
  const row = canvasElement.querySelector(".ui-lines-group .ui-row");
  const title = row?.querySelector(".ui-row-title") ?? null;
  const drawn = title?.querySelector("[aria-hidden='true']")?.textContent ?? title?.textContent ?? "";
  return { row, title, drawn };
}

const fitsWhole = async (canvasElement: HTMLElement) => {
  const { title, drawn } = await searchOne(canvasElement, "unit");
  await expect(drawn).toBe("Water heater replacement, unit 2");
  await expect(title != null && inView(title, "unit")).toBe(true);
};

/** N3: "Water heater replacement, unit 2" fits its three lines with "unit" in them, so it shows whole. */
export const FitsWhole320: Story = {
  name: "Snippet · fits whole at 320",
  ...phone320,
  render: () => <CategoryLinesView />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    await fitsWhole(canvasElement);
  },
};

export const FitsWhole393: Story = {
  name: "Snippet · fits whole at 393",
  ...phone393,
  render: () => <CategoryLinesView />,
  play: async ({ canvasElement }) => { await fitsWhole(canvasElement); },
};

/**
 * N4: two words. Near enough, the first cut that shows both wins. Too far apart for any cut at 320
 * ("boiler" … "inspection"), the earliest one that shows the most: here the whole text, with "boiler".
 */
export const TwoWords320: Story = {
  name: "Snippet · two words at 320",
  ...phone320,
  render: () => <CategoryLinesView rows={ROWS} />,
  play: async ({ canvasElement }) => {
    const near = await searchOne(canvasElement, "meter chimney");
    await expect(near.drawn.startsWith("…")).toBe(true);
    await expect(near.title != null && inView(near.title, "meter") && inView(near.title, "chimney")).toBe(true);
    await expect(near.title != null && titleLines(near.title) <= 3).toBe(true);
    await expect(near.row?.textContent.includes(CLOSE_WORDS)).toBe(true);
    const far = await searchOne(canvasElement, "boiler inspection");
    await expect(far.drawn).toBe(TWO_WORDS);
    await expect(far.title != null && inView(far.title, "boiler")).toBe(true);
  },
};

/** N5: a description with no spaces is cut after the "/" before the match, and the match is in view. */
export const NoSpaces320: Story = {
  name: "Snippet · no spaces at 320",
  ...phone320,
  render: () => <CategoryLinesView rows={ROWS} />,
  play: async ({ canvasElement }) => {
    const { title, drawn } = await searchOne(canvasElement, "unit2");
    await expect(drawn.startsWith("…")).toBe(true);
    // Two parts before the match, as two words before it in a text with spaces.
    await expect(drawn).toBe("…EXPANSION-TANK/UNIT2/FINAL");
    await expect(title != null && inView(title, "UNIT2")).toBe(true);
    await expect(title != null && titleLines(title) <= 3).toBe(true);
  },
};

/** Whether the word's letters are drawn inside the element's box (a part cut with "…" may still show it). */
function wordInBox(element: Element, word: string): boolean {
  const node = element.firstChild;
  const at = node?.textContent?.indexOf(word) ?? -1;
  if (node == null || at < 0) return false;
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + word.length);
  const rect = range.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  return rect.width > 0 && rect.left >= box.left - 1 && rect.right <= box.right + 1;
}

/**
 * FLOW-169: "heater cedar" matched the description and the project, so the project stays in the hint,
 * after the supplier, which names the line (review of #868). Each part shows whole or cut with "…" while
 * 4em of it fits (FLOW-168); `shown` lists the parts whose start is drawn on the hint's one line.
 */
const matchedProject = async (canvasElement: HTMLElement, shown: readonly (readonly [string, string])[], dropped: readonly string[]) => {
  const { row } = await searchOne(canvasElement, "heater cedar");
  // Screen readers get every part, the dropped one included.
  await expect(row?.querySelector(".ui-row-hint")?.textContent).toBe("18/10 · Quick Fix Plumbing · Cedar St");
  const texts = [...(row?.querySelectorAll(".ui-row-hint .ui-hint-text") ?? [])];
  const line = texts[0]?.getBoundingClientRect().top ?? 0;
  const onLine = (part: Element | undefined) => Math.abs((part?.getBoundingClientRect().top ?? -99) - line) < 1;
  for (const [whole, start] of shown) {
    const part = texts.find((text) => text.textContent === whole);
    await expect(onLine(part)).toBe(true);
    await expect(part != null && wordInBox(part, start)).toBe(true);
  }
  for (const whole of dropped) await expect(onLine(texts.find((text) => text.textContent === whole))).toBe(false);
};

export const MatchedProject320: Story = {
  name: "Snippet · the matched project stays at 320",
  ...phone320,
  render: () => <CategoryLinesView rows={ROWS} />,
  // Beside a dollar amount the hint is about 110px: the date and the supplier at 4em fill it, so the
  // project drops to the hidden line (logged for the design lead).
  play: async ({ canvasElement }) => { await matchedProject(canvasElement, [["Quick Fix Plumbing", "Qui"]], ["Cedar St"]); },
};

export const MatchedProject393: Story = {
  name: "Snippet · the matched project stays at 393",
  ...phone393,
  render: () => <CategoryLinesView rows={ROWS} />,
  play: async ({ canvasElement }) => { await matchedProject(canvasElement, [["Quick Fix Plumbing", "Qui"], ["Cedar St", "Ced"]], []); },
};
