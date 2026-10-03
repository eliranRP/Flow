# Smoke user

The live check after Pages signs in as one email-and-password user and only reads. That user is a viewer of the demo company **Flow Test 2**. It is not a member of any real company, and it cannot write.

There is no viewer role on `companies`. `private.current_company_id()` is still the owner. Write policies and write RPCs use that. `public.company_viewers` adds one user to one company, and a trigger rejects the row unless `companies.is_demo` is true. Select policies and the read RPCs for home, projects, review, and settings use `private.readable_company_id()`.

The product has no `/reports` route. The check opens `/`, `/projects`, `/review`, and `/settings`.

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
{"email":"ops+smoke@nromomentum.com","password":"$SMOKE_PASSWORD","email_confirm":true}
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
  where email = 'ops+smoke@nromomentum.com';
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
where u.email = 'ops+smoke@nromomentum.com';
```

The name is `Flow Test 2` and `is_demo` is true. Any other result means stop. Do not point this user at a real company. The trigger rejects that insert.

## GitHub secrets

The deploy job uses the GitHub environment `production`. Add both secrets there, not as repository secrets. A job that does not select `production` cannot see them.

| Name | Value |
| --- | --- |
| `SMOKE_EMAIL` | `ops+smoke@nromomentum.com` |
| `SMOKE_PASSWORD` | The password from the provision step |

Where: GitHub → Settings → Environments → `production` → Environment secrets.

If either secret is missing, the deploy step prints that it is skipping and exits 0. The rest of the deploy still runs. When both are set, the step installs Chromium and runs `pnpm --filter @flow/app test:e2e:smoke` against `https://flow-app-dx5.pages.dev` after the hostname check. The password is masked in the log.
