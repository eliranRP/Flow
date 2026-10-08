# QA user (writes in its own sandbox company)

The production QA thread checks every deploy end to end, including saves. The [smoke user](smoke-user.md) can't do that: it is a viewer of Flow Test and the server rejects its writes. Flow has no editor role. Write rights belong to the owner of a company (`private.current_company_id()`).

So QA has its own login that owns its own company, **Flow QA**. It is a normal owner of that one company and nothing else. Row-level security keeps it out of every other company, including NRO Momentum and Flow Test. No schema change is involved.

## What QA may do

- Create, edit, split, assign, undo and delete anything inside Flow QA, in the app and through a Flow MCP key minted for Flow QA.
- Leave test data in Flow QA. Prefix names with `QA ` so they are easy to spot.
- Connect the owner's Mercury account to Flow QA, so sync runs against a copy of the real bank lines. Mercury is only read.
- Seed a scenario straight in the database (Supabase SQL) when the app can't create it. Every insert or update names Flow QA's company id, and the statement first checks that the id belongs to the company named `Flow QA` with `is_demo` false.

## What QA must not do

- Use any other login or key for writes. The NRO Momentum MCP key stays read-only (`readOnlyHint` tools only).
- Join, view or invite into any other company. Never set `is_demo` on Flow QA.
- Run SQL that touches a row of any other company, or that has no company filter.
- Write with the NRO Momentum MCP key, or change NRO Momentum's own Mercury connection.

## Provision once (owner)

1. Supabase dashboard, Authentication, Users, Add user. Use an email and password, and tick auto-confirm. Do not attach it to a company.
2. Store the email and password in the owner's private accounts list, in a row named `Flow QA (Supabase)`. Do not commit them or paste them into a chat or a pull request.
3. QA signs in and finishes onboarding with the company name `Flow QA`. That calls `create_company`, which makes this user its owner.
4. In Settings, QA mints a Flow MCP key for Flow QA. That key stays in the QA session only.

## Check

```sql
select c.name, c.is_demo
from public.companies c
join auth.users u on u.id = c.owner_id
where u.email = '<qa email>';
```

One row, `Flow QA`, `is_demo` false. Any other result means stop.
