# Connector UI states

Copy for the design review of the connection card, the import range, the ₪/$ toggle, and the pending tag. L3 builds the screens. This layer does not.

Hebrew is the UI string. English is the meaning. Keys match `CONNECTOR_COPY_KEYS` in `supabase/functions/_shared/connectors/types.ts`.

| Key | Hebrew | English |
| --- | --- | --- |
| `status.connected` | מחובר | Connected |
| `status.disconnected` | לא מחובר | Not connected |
| `status.reconnect` | צריך לחבר מחדש | Reconnect |
| `sync.today` | עודכן ב-{HH:MM} | Updated at the clock, today |
| `sync.yesterday` | עודכן אתמול ב-{HH:MM} | Updated yesterday at the clock |
| `sync.older` | עודכן ב-{D.M} | Updated on that day and month |
| `refresh.failed` | הרענון נכשל. נסו שוב. | The refresh failed. Try again. |
| `pending.tag` | ממתין | Pending |
| `range.from_start` | מההתחלה | From the start |
| `currency.ils` | ₪ | Shekel |
| `currency.usd` | $ | Dollar |

The row title is the provider's own name: SUMIT, Mercury. Those names are not translated.

## Connection card

One card per provider, from the client descriptor. The SUMIT block in Settings is this card. States:

| State | What the owner sees | Action |
| --- | --- | --- |
| Loading | Skeleton in the hint slot | None |
| Not connected | לא מחובר | Paste the token and connect |
| Connected | מחובר, then one last-sync line | Refresh, or disconnect |
| Reconnect | צריך לחבר מחדש, warning colour | Paste a new token |
| Refreshing | The row shows the refresh in progress | The button does not fire a second request inside 60 seconds |
| Refresh failed | הרענון נכשל. נסו שוב. | Try again after the floor |
| Status failed to load | The row is an error, with ניסיון חוזר (try again) | Retry the status read |

Last sync uses the three lines above. Today is a clock. Yesterday says אתמול (yesterday). An older day is `D.M`. One line.

A Mercury auth error and a SUMIT auth error both use reconnect. A rate limit uses the refresh-failed line, including when the server sent no retry time. A rejected token opens the connect sheet with the reason, then reconnect, then disconnect. That is the current SUMIT sheet, reused.

Disconnect returns focus to the row. The card does not show ciphertext, a token, an account number, or a routing number. Account labels, when shown, are the names the provider returned.

## Import range

Both providers. The owner picks a start date, or מההתחלה (`import_from` null). The choice is stored on that connection. It applies to the next import. It does not change typed amounts.

## ₪/$ toggle

One control, two places: the Home header and Settings. It writes the company display currency. ₪ is `ILS`. $ is `USD`. The other surface updates on the next read.

A Mercury line stays in dollars. The toggle converts a mixed total at read from `fx_rates`. It does not rewrite the row and it does not freeze a rate on the line. Typed amounts stay ₪. The toggle does not rewrite an input. Pending lines stay out of the totals in both currencies.

## Pending tag

A review card whose line is pending shows ממתין. The line is in לאישור. It is not in a P&L, a project total, or the filed-today list. A posted line has no tag. A void line is not on the card.
