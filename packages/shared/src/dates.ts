/** Hebrew dates. The week starts on Sunday. Display is dd/mm/yyyy. Decision 0027. */

export function formatDayMonthYear(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const year = match?.[1];
  const month = match?.[2];
  const day = match?.[3];
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

export interface MonthCell {
  iso: string;
  day: number;
  inMonth: boolean;
}

function isoFromUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${String(year)}-${month}-${day}`;
}

/** Cells for one month, padded so the first column is Sunday. */
export function monthCells(year: number, month: number): MonthCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = first.getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: MonthCell[] = [];
  for (let index = 0; index < start; index += 1) {
    const date = new Date(Date.UTC(year, month - 1, 1 - (start - index)));
    cells.push({ iso: isoFromUtc(date), day: date.getUTCDate(), inMonth: false });
  }
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    cells.push({ iso: isoFromUtc(date), day, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const date = new Date(Date.UTC(year, month - 1, days + (cells.length - (start + days)) + 1));
    cells.push({ iso: isoFromUtc(date), day: date.getUTCDate(), inMonth: false });
  }
  return cells;
}
