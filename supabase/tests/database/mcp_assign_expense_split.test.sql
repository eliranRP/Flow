-- MCP assign_expense_split: validation, happy path, undo, idempotency, cross-tenant.

begin;

select plan(34);

do $users$
begin
  perform tests.create_supabase_user('mcpsplit_owner', 'mcpsplit-owner@example.com');
  perform tests.create_supabase_user('mcpsplit_other', 'mcpsplit-other@example.com');
end
$users$;

create temp table mcpsplit (label text primary key, id uuid);
grant all on mcpsplit to authenticated, service_role;

create temp table mcpsplit_prior (
  label text primary key,
  project_id uuid,
  category_id uuid,
  pnl_role text,
  shares jsonb
);
grant all on mcpsplit_prior to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'mcpsplit_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.mcpsplit where label = p_label;
  if uid is null or tid is null then
    raise exception 'missing mcp actor %', p_label;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', uid,
      'role', 'authenticated',
      'aal', 'aal1',
      'mcp_tid', tid
    )::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

select tests.authenticate_as('mcpsplit_owner');
select lives_ok($$select public.create_company('Example Co', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'North Property', null, 'active')$$, 'north project');
select lives_ok($$select public.upsert_project(null, 'South Property', null, 'active')$$, 'south project');

insert into mcpsplit (label, id) select 'company', id from public.companies;
insert into mcpsplit (label, id) select 'north', id from public.projects where name = 'North Property';
insert into mcpsplit (label, id) select 'south', id from public.projects where name = 'South Property';
insert into mcpsplit (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
select c.id, 'expense', 'expense', 'project',
  -12000, -12000, 0, 'unknown',
  '2026-09-15', 'manual', 'mcpsplit:subscription', n.id, null, 'Monthly SaaS',
  false, false
from mcpsplit c
join mcpsplit n on n.label = 'north'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcpsplit:subscription';

insert into mcpsplit (label, id)
select 'txn', id from public.transactions where idempotency_key = 'mcpsplit:subscription';

insert into mcpsplit_prior (label, project_id, category_id, pnl_role, shares)
select 'txn', t.project_id, t.category_id, t.pnl_role::text,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'project_id', a.project_id, 'share_bp', a.share_bp, 'amount_net', a.amount_net
    ) order by a.project_id)
    from public.allocations a where a.transaction_id = t.id
  ), '[]'::jsonb)
from public.transactions t
where t.idempotency_key = 'mcpsplit:subscription';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcpsplit_owner'), c.id, 'hash-mcpsplit-write1', 'kid', array['write']::text[], '2099-01-01'::timestamptz
from mcpsplit c where c.label = 'company';
insert into mcpsplit (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-mcpsplit-write1';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcpsplit_owner'), c.id, 'hash-mcpsplit-read01', 'kid', array['read']::text[], '2099-01-01'::timestamptz
from mcpsplit c where c.label = 'company';
insert into mcpsplit (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-mcpsplit-read01';

select tests.authenticate_as('mcpsplit_other');
select lives_ok($$select public.create_company('Other Co', true)$$, 'other company');
insert into mcpsplit (label, id) select 'other_company', id from public.companies where name = 'Other Co';
reset role;

select is(
  public.mcp_assign_expense_split('split-bad', (select id from mcpsplit where label = 'txn'), '[]'::jsonb)->'error'->>'code',
  'validation',
  'empty shares is validation'
);

select is(
  public.mcp_assign_expense_split(
    'split-bad-sum',
    (select id from mcpsplit where label = 'txn'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 40),
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 40)
    )
  )->'error'->>'code',
  'validation',
  'shares that do not sum to 100 are validation'
);

select is(
  public.mcp_assign_expense_split(
    'split-dup',
    (select id from mcpsplit where label = 'txn'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50)
    )
  )->'error'->>'code',
  'validation',
  'a repeated project is validation'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense_split(
      'split-happy',
      (select id from mcpsplit where label = 'txn'),
      jsonb_build_array(
        jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
        jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50)
      ),
      (select id from mcpsplit where label = 'materials')
    )->'data'->>'undo_kind'
  ),
  'reassign',
  'happy path returns reassign undo'
);

select is(
  (select pnl_role::text from public.transactions where idempotency_key = 'mcpsplit:subscription'),
  'shared',
  'split sets shared role'
);

select is(
  (
    select jsonb_agg(jsonb_build_object('project_id', a.project_id, 'share_bp', a.share_bp) order by a.project_id)
    from public.allocations a
    join public.transactions t on t.id = a.transaction_id
    where t.idempotency_key = 'mcpsplit:subscription'
  ),
  (
    select jsonb_agg(jsonb_build_object('project_id', m.id, 'share_bp', 5000) order by m.id)
    from mcpsplit m
    where m.label in ('north', 'south')
  ),
  'allocations are 50/50'
);

select is(
  (select category_id from public.transactions where idempotency_key = 'mcpsplit:subscription'),
  (select id from mcpsplit where label = 'materials'),
  'split sets the category'
);

select is(
  (
    public.mcp_assign_expense_split(
      'split-happy',
      (select id from mcpsplit where label = 'txn'),
      jsonb_build_array(
        jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
        jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50)
      ),
      (select id from mcpsplit where label = 'materials')
    )->'data'->>'undo_kind'
  ),
  'reassign',
  'idempotent replay returns the stored response'
);

reset role;
insert into mcpsplit (label, id)
select 'undo', w.reassign_id
from private.mcp_writes w
join mcpsplit t on t.id = w.transaction_id
where t.label = 'txn';

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_undo(
      'undo-split',
      'reassign',
      (select id from mcpsplit where label = 'undo')
    )->'data'->>'kind'
  ),
  'reassign',
  'undo split write succeeds'
);

select is(
  (
    select jsonb_build_object(
      'project_id', t.project_id,
      'category_id', t.category_id,
      'pnl_role', t.pnl_role,
      'shares', coalesce((
        select jsonb_agg(jsonb_build_object(
          'project_id', a.project_id, 'share_bp', a.share_bp, 'amount_net', a.amount_net
        ) order by a.project_id)
        from public.allocations a where a.transaction_id = t.id
      ), '[]'::jsonb)
    )
    from public.transactions t
    where t.idempotency_key = 'mcpsplit:subscription'
  ),
  (
    select jsonb_build_object(
      'project_id', project_id,
      'category_id', category_id,
      'pnl_role', pnl_role::public.pnl_role,
      'shares', shares
    )
    from mcpsplit_prior where label = 'txn'
  ),
  'undo restores prior allocation'
);

select is(
  public.mcp_assign_expense_split(
    'split-unknown-project',
    (select id from mcpsplit where label = 'txn'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
      jsonb_build_object('project_id', gen_random_uuid()::text, 'share', 50)
    )
  )->'error'->>'message',
  'project or category not found',
  'a project outside the company is refused'
);

select is(
  public.mcp_assign_expense_split(
    'split-income-category',
    (select id from mcpsplit where label = 'txn'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50)
    ),
    (
      select c.id from public.categories c
      where c.company_id = (select id from mcpsplit where label = 'company') and c.kind = 'income'
      order by c.id limit 1
    )
  )->'error'->>'message',
  'category kind must match the direction',
  'an income category on an expense is refused'
);

reset role;
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcpsplit_other'), c.id, 'hash-mcpsplit-otherw', 'kid', array['write']::text[], '2099-01-01'::timestamptz
from mcpsplit c where c.label = 'other_company';
insert into mcpsplit (label, id) select 'other_write', id from private.mcp_credentials where token_hash = 'hash-mcpsplit-otherw';

do $$ begin perform pg_temp.as_mcp('other_write', 'mcpsplit_other'); end $$;

select is(
  public.mcp_assign_expense_split(
    'split-foreign-txn',
    (select id from mcpsplit where label = 'txn'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50)
    )
  )->'error'->>'code',
  'refused',
  'another company cannot split the owner transaction'
);

do $$ begin perform pg_temp.as_mcp('read', 'mcpsplit_owner'); end $$;

select is(
  public.mcp_assign_expense_split(
    'split-read',
    (select id from mcpsplit where label = 'txn'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50)
    )
  )->'error'->>'code',
  'forbidden',
  'read token cannot assign_expense_split'
);

-- Review path (first real use): a USD subscription line with no project, in review, split 50/50.
reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
select c.id, 'expense', 'expense', null, v.currency,
  v.amount, v.amount, abs(v.amount), 0, 'unknown',
  '2026-09-20', v.source::public.txn_source, v.k, null, null, 'Synthetic line',
  false, false
from mcpsplit c
cross join (values
  ('mcpsplit:usd-review', 'USD', -12000::bigint, 'mercury'),
  ('mcpsplit:plain', 'ILS', -10001::bigint, 'manual'),
  ('mcpsplit:zero', 'ILS', 0::bigint, 'manual')
) v(k, currency, amount, source)
where c.label = 'company';

insert into mcpsplit (label, id)
select v.label, t.id
from public.transactions t
join (values ('usd', 'mcpsplit:usd-review'), ('plain', 'mcpsplit:plain'), ('zero', 'mcpsplit:zero')) v(label, k)
  on t.idempotency_key = v.k;

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_category'
from public.transactions t
where t.id = (select id from mcpsplit where label = 'usd');

create temp table mcpsplit_state (label text primary key, state jsonb);
grant all on mcpsplit_state to authenticated, service_role;

create or replace function pg_temp.line_state(p_id uuid)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_object(
    'project_id', t.project_id,
    'category_id', t.category_id,
    'pnl_role', t.pnl_role,
    'user_assigned', t.user_assigned,
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', a.project_id, 'share_bp', a.share_bp, 'amount_net', a.amount_net
      ) order by a.project_id)
      from public.allocations a where a.transaction_id = t.id
    ), '[]'::jsonb)
  )
  from public.transactions t
  where t.id = p_id
$$;
grant execute on function pg_temp.line_state(uuid) to authenticated, service_role;

insert into mcpsplit_state (label, state)
select v.label, pg_temp.line_state((select id from mcpsplit where label = v.label))
from (values ('usd'), ('zero')) v(label);
insert into mcpsplit (label, id)
select 'other_category', c.id
from public.categories c
where c.company_id = (select id from mcpsplit where label = 'company')
  and c.kind = 'expense'
  and c.id is distinct from (select t.category_id from public.transactions t where t.id = (select id from mcpsplit where label = 'zero'))
order by c.sort_order, c.name
limit 1;

-- Another company's project, category and line, for refusals and the positive control.
insert into public.projects (company_id, name, status)
select c.id, v.name, 'active'
from mcpsplit c
cross join (values ('Other North'), ('Other South')) v(name)
where c.label = 'other_company';
insert into mcpsplit (label, id) select 'other_north', id from public.projects where name = 'Other North';
insert into mcpsplit (label, id) select 'other_south', id from public.projects where name = 'Other South';
insert into mcpsplit (label, id)
select 'other_materials', c.id
from public.categories c
where c.company_id = (select id from mcpsplit where label = 'other_company')
  and c.name = 'חומרים' and c.kind = 'expense';
insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select c.id, 'expense', 'expense', -801, -801, 0, 'unknown',
  '2026-09-21', 'manual', 'mcpsplit:other-line', 'Synthetic other line'
from mcpsplit c where c.label = 'other_company';
insert into mcpsplit (label, id) select 'other_line', id from public.transactions where idempotency_key = 'mcpsplit:other-line';

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (public.mcp_assign_expense_split(
    'split-usd-review',
    (select id from mcpsplit where label = 'usd'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50)
    ),
    (select id from mcpsplit where label = 'materials')
  )->'data') - 'id',
  '{"undo_kind": "review", "closed_review": true}'::jsonb,
  'a line in review closes the review and records review undo'
);

select is(
  (select array_agg(a.amount_net order by a.amount_net) from public.allocations a where a.transaction_id = (select id from mcpsplit where label = 'usd')),
  array[-6000, -6000]::bigint[],
  'the USD subscription splits 50/50 to the cent'
);

select is(
  public.mcp_undo(
    'undo-usd-review',
    'review',
    (select q.id from public.review_queue q where q.transaction_id = (select id from mcpsplit where label = 'usd'))
  )->>'ok',
  'true',
  'review undo of a split succeeds'
);

select is(
  pg_temp.line_state((select id from mcpsplit where label = 'usd')),
  (select state from mcpsplit_state where label = 'usd'),
  'review undo restores the allocation, role and category from before the split'
);

select is(
  (select q.status::text from public.review_queue q where q.transaction_id = (select id from mcpsplit where label = 'usd')),
  'open',
  'review undo reopens the review'
);

-- Replay writes nothing; the same key with other shares is a conflict.
select is(
  public.mcp_assign_expense_split(
    'split-plain',
    (select id from mcpsplit where label = 'plain'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 33),
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 67)
    )
  ) = public.mcp_assign_expense_split(
    'split-plain',
    (select id from mcpsplit where label = 'plain'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 33),
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 67)
    )
  ),
  true,
  'replay returns the same response'
);

select is(
  (select sum(a.amount_net) from public.allocations a where a.transaction_id = (select id from mcpsplit where label = 'plain')),
  -10001::numeric,
  'an odd amount splits 33/67 with no lost agora'
);

select is(
  public.mcp_assign_expense_split(
    'split-plain',
    (select id from mcpsplit where label = 'plain'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50)
    )
  )->'error'->>'code',
  'conflict',
  'the same key with other shares is a conflict'
);

reset role;
select is(
  (
    select jsonb_build_array(
      (select count(*) from private.mcp_writes w where w.transaction_id = (select id from mcpsplit where label = 'plain')),
      (select count(*) from public.reassign_undo u where u.transaction_id = (select id from mcpsplit where label = 'plain'))
    )
  ),
  '[1, 1]'::jsonb,
  'replay adds no second write or undo row'
);
insert into mcpsplit (label, id)
select 'plain_undo', w.reassign_id from private.mcp_writes w where w.transaction_id = (select id from mcpsplit where label = 'plain');

do $$ begin perform pg_temp.as_mcp('write'); end $$;
select public.save_split(
  (select id from mcpsplit where label = 'plain'),
  jsonb_build_array(
    jsonb_build_object('project_id', (select id from mcpsplit where label = 'north'), 'share_bp', 9000),
    jsonb_build_object('project_id', (select id from mcpsplit where label = 'south'), 'share_bp', 1000)
  )
);

select is(
  public.mcp_undo('undo-plain', 'reassign', (select id from mcpsplit where label = 'plain_undo'))->'error'->>'code',
  'conflict',
  'undo after a later change to the split is a conflict'
);

select is(
  (
    select array_agg(distinct public.mcp_assign_expense_split('split-v-' || v.n, (select id from mcpsplit where label = 'plain'), v.shares)->'error'->>'code')
    from (values
      (1, jsonb_build_array(jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 100))),
      (2, jsonb_build_array(jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 0), jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 100))),
      (3, jsonb_build_array(jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', -10), jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 110))),
      (4, jsonb_build_array(jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', null), jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 100))),
      (5, jsonb_build_array(jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50.5), jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 49.5))),
      (6, jsonb_build_array(jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', '50'), jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50))),
      (7, jsonb_build_array(jsonb_build_object('project_id', 'not-a-uuid', 'share', 50), jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50))),
      (8, jsonb_build_array(jsonb_build_object('share', 50), jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50)))
    ) v(n, shares)
  ),
  array['validation'],
  'one project, zero, negative, null, fractional, string, non-uuid and missing ids are validation'
);

select is(
  public.mcp_assign_expense_split(
    'split-zero',
    (select id from mcpsplit where label = 'zero'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50)
    ),
    (select id from mcpsplit where label = 'other_category')
  )->>'ok',
  'true',
  'a zero-amount line can be split'
);

select is(
  jsonb_build_array(
    public.mcp_assign_expense_split(
      'split-other-project',
      (select id from mcpsplit where label = 'zero'),
      jsonb_build_array(
        jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
        jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'other_north'), 'share', 50)
      )
    )->'error'->>'message',
    public.mcp_assign_expense_split(
      'split-other-category',
      (select id from mcpsplit where label = 'zero'),
      jsonb_build_array(
        jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'north'), 'share', 50),
        jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'south'), 'share', 50)
      ),
      (select id from mcpsplit where label = 'other_materials')
    )->'error'->>'message'
  ),
  '["project or category not found", "category not found"]'::jsonb,
  'another company''s project or category is refused'
);

reset role;
insert into mcpsplit (label, id)
select 'zero_undo', w.reassign_id from private.mcp_writes w where w.transaction_id = (select id from mcpsplit where label = 'zero');
do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  public.mcp_undo('undo-zero', 'reassign', (select id from mcpsplit where label = 'zero_undo'))->>'ok',
  'true',
  'reassign undo of a split with a new category succeeds'
);

select is(
  pg_temp.line_state((select id from mcpsplit where label = 'zero')),
  (select state from mcpsplit_state where label = 'zero'),
  'reassign undo restores no allocation and the previous category'
);

do $$ begin perform pg_temp.as_mcp('other_write', 'mcpsplit_other'); end $$;

select is(
  public.mcp_assign_expense_split(
    'split-own-line',
    (select id from mcpsplit where label = 'other_line'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'other_north'), 'share', 50),
      jsonb_build_object('project_id', (select id::text from mcpsplit where label = 'other_south'), 'share', 50)
    )
  )->>'ok',
  'true',
  'the other company splits its own line (positive control)'
);

select * from finish();
rollback;
