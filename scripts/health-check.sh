#!/usr/bin/env bash
# FLOW-802: runs private.health() read only and fails when it reports an alert (decision 0151).
# The daily GitHub run (.github/workflows/health.yml) calls this, so a failed run emails the
# repo owner. Prints counts only: the alerts carry no company names, ids or amounts.
# Exit: 0 healthy, 2 an alert, 1 the check did not finish.
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "health-check: SUPABASE_DB_URL is missing. The check did not finish." >&2
  exit 1
fi

# psql's errors can quote the URL; mask it before it reaches the public log.
if ! report="$(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -At --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -c "select private.health()::text;" \
  2> >(sed -E 's#(postgres(ql)?://)[^[:space:]'"'"'"]+#\1***#g' >&2))"; then
  echo "health-check: could not read private.health(). The check did not finish." >&2
  exit 1
fi
report="${report//$'\n'/}"

if ! summary="$(node -e '
  const report = JSON.parse(process.argv[1]);
  if (typeof report.ok !== "boolean" || !Array.isArray(report.alerts)) process.exit(3);
  const lines = report.alerts.map((a) => `${a.level === "warning" ? "warning " : ""}${a.check}: ${a.count} (${a.detail})`);
  console.log([report.ok ? "ok" : "alert", ...lines].join("\n"));
' "$report")"; then
  echo "health-check: the report was not readable. The check did not finish." >&2
  exit 1
fi

state="${summary%%$'\n'*}"
rest=""
[[ "$summary" == *$'\n'* ]] && rest="${summary#*$'\n'}"
if [[ "$state" == "ok" ]]; then
  echo "health-check: all checks passed."
  [[ -n "$rest" ]] && printf '%s\n' "$rest"
  exit 0
fi
echo "health-check: alerts found:"
printf '%s\n' "$rest"
echo "What each alert means and what to do: docs/runbooks/health-check.md"
exit 2
