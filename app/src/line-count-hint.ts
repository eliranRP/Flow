export function lineCountHint(count: number, shared: boolean): string {
  const lines = count === 1 ? "תנועה אחת" : `${String(count)} תנועות`;
  return shared ? `${lines} · כולל חלק משותף` : lines;
}
