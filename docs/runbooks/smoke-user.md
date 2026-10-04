# Smoke user

The live check after Pages signs in as one email-and-password user and only reads. That user is a viewer of the demo company **Flow Test 2**. It is not a member of any real company, and it cannot write. The write controls stay on screen. The server rejects the write. Hiding those controls is backlog.

There is no viewer role on `companies`. `private.current_company_id()` is still the owner. Write policies and write RPCs use that. `public.company_viewers` adds one user to one company, and a trigger rejects the row unless `companies.is_demo` is true. Select policies use `private.readable_company_id()`, so the list RPCs below can run. A table read follows that same company. Detail RPCs do not.

A viewer gets these reads:

| Read | What it returns |
| --- | --- |
| `get_home` | The demo company name and cash net. The smoke does not open `/auth/callback`, so it does not call this. |
| `get_dashboard` | The demo P&L for the signed-in period, through `company_pnl`. |
| `company_pnl` | That same company only. Another company is `forbidden`. |
| `list_unpaid` | Open invoices for the demo company. |
| `list_review` | The open review list. `auto_approved_today` and `assistant_filed_today` stay empty, because they call `private.filed_today_rows()`. |
| `sumit_status` | Whether the demo SUMIT connection is up, and its company number. No secret. |
| `company_integrations` | The Jev row: enabled, mode, and threshold. This is a select, not an RPC. |

These stay on `private.current_company_id()` and return nothing for a viewer. The smoke does not call them:

- `get_project`
- `list_project_category` and `private.project_category_entries`
- `project_waiting`
- `private.overhead_share`
- `get_transaction`
- `list_auto_assigned_today` and `private.filed_today_rows`
- `list_categories`

The product has no `/reports` route. The check opens only `/`, `/projects`, `/review`, and `/settings`. It does not open a project, a transaction, or a category. Home calls `get_dashboard` and `list_unpaid`. Projects calls `get_dashboard`. Review calls `list_review`. Settings calls `get_dashboard` and `sumit_status`, selects `company_integrations`, and POSTs `flow-mcp/status`. Each of those has to return 200 before the next screen. The home lines are נכנס and יצא when the demo has income, expenses, or a project. A demo with none of those still passes on the empty heading. The check does not require a project row.

## Provision once

Run this from your machine. Do not commit the password, do not put it in a pull request, and do not paste it into the shell as an argument.

The Auth admin API creates the user even when public sign-up is off. Email sign-in has to be enabled or `signInWithPassword` fails. Confirm the user in this call so no inbox is required. Use a password without `"` or `\` so the JSON body stays valid.

`SUPABASE_URL` is `https://sxqpnetmtufkzowutduq.supabase.co`. The service-role key is the project secret from the Supabase dashboard, not a GitHub secret. Read it with `read -rs` so it is not echoed and not written to shell history. While `curl` is running, that key is in the process arguments, so `ps` can show it. Unset it when the request returns.

```bash
read -rs SERVICE_ROLE
read -rs SMOKE_PASSWORD
curl -sS -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "Authorization: Bearer $SERVICE_ROLE" \
  -H "apikey: $SERVICE_ROLE" \
  -H "Content-Type: application/json" \
  --data-binary @- <<EOF
{"email":"smoke@example.com","password":"$SMOKE_PASSWORD","email_confirm":true}
EOF
unset SERVICE_ROLE SMOKE_PASSWORD
```

If the user already exists, the API returns an error. Do not create a second one. Reset the password from the dashboard if it was lost, and replace the GitHub secret.

Then, in the Supabase SQL editor (the postgres role, once):

```sql
do $$
declare
  uid uuid;
  cid uuid;
  n int;
begin
  select count(*) into n
  from public.companies
  where name = 'Flow Test 2' and is_demo;
  if n <> 1 then
    raise exception 'Flow Test 2 must be exactly one demo company';
  end if;
  select id into cid
  from public.companies
  where name = 'Flow Test 2' and is_demo;
  select id into uid
  from auth.users
  where email = 'smoke@example.com';
  if uid is null then
    raise exception 'smoke user is missing';
  end if;
  insert into public.company_viewers (user_id, company_id)
  values (uid, cid);
end $$;
```

That block raises when Flow Test 2 is missing, is not `is_demo`, or matches more than one company. Check that one row exists before you leave the editor:

```sql
select c.name, c.is_demo
from public.company_viewers v
join public.companies c on c.id = v.company_id
join auth.users u on u.id = v.user_id
where u.email = 'smoke@example.com';
```

The name is `Flow Test 2` and `is_demo` is true. Any other result means stop. Do not point this user at a real company. The trigger rejects that insert.

## GitHub secrets

The deploy job uses the GitHub environment `production`. Add both secrets there, not as repository secrets. A job that does not select `production` cannot see them.

| Name | Value |
| --- | --- |
| `SMOKE_EMAIL` | The address you created. `smoke@example.com` in the commands above is a placeholder. |
| `SMOKE_PASSWORD` | The password from the provision step |

Where: GitHub → Settings → Environments → `production` → Environment secrets.

`smoke@example.com` is not a mailbox. Replace it in both commands with the address you created, and store that same address as `SMOKE_EMAIL`. Do not commit the real address.

If either secret is missing, the deploy step writes a warning to the job summary and exits 0. That does not fail the deploy. When both are set, the step installs Chromium and runs `pnpm --filter @flow/app test:e2e:smoke` against `https://flow-app-dx5.pages.dev` after the hostname check. A failed smoke writes a job summary that production is already live and quotes the Playwright output, then exits 1. Pages is not rolled back. GitHub masks the password because it is a secret. The workflow does not mask it again.
