-- A bank line the user's project forecast expects (decision 0187): the matcher (amount tolerance,
-- month and pace, direction, currency, another company, one line per edit and month), the sync pass
-- (the suggestion with category_suggested, the match recorded, lines the owner set untouched, a
-- supplier rule's category kept), a re-file or removal drops the match, and what the review, Jev's
-- reasons, the jev-tag read and the forecast read say. Invented data only.

begin;

select plan(50);

do $users$
begin
  perform tests.create_supabase_user('flm_owner', 'flm-owner@example.com');
  perform tests.create_supabase_user('flm_other', 'flm-other@example.com');
end
$users$;

create temp table flm (label text primary key, id uuid);
grant all on flm to authenticated, service_role;
create temp table flm_month (label text primary key, m text);
grant all on flm_month to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from flm where label = p_label;
$$;
create function pg_temp.m(p_label text) returns text language sql stable as $$
  select m from flm_month where label = p_label;
$$;
grant execute on function pg_temp.id(text), pg_temp.m(text) to authenticated, service_role;

insert into flm_month (label, m)
select label, to_char(date_trunc('month', private.flow_today()) + (n || ' month')::interval, 'YYYY-MM')
from (values ('now', 0), ('next', 1), ('next2', 2), ('next3', 3)) v(label, n);

select tests.authenticate_as('flm_other');
select public.create_company('Other Match Co', true);
insert into flm (label, id) values ('other_project', public.upsert_project(p_name => 'Birch Ct', p_status => 'active'));
insert into flm (label, id) values ('other_rent', public.create_category('Ground rent', 'expense'));

select tests.authenticate_as('flm_owner');
select public.create_company('Forecast Match Books', true);
insert into flm (label, id) values ('project', public.upsert_project(p_name => 'Juniper Ct', p_status => 'active'));
insert into flm (label, id) values ('project2', public.upsert_project(p_name => 'Aspen Row', p_status => 'active'));
insert into flm (label, id) values ('rent', public.create_category('Site rent', 'expense'));
insert into flm (label, id) values ('cleaning', public.create_category('Cleaning crew', 'expense'));
insert into flm (label, id) values ('fees', public.create_category('Small fees', 'expense'));
insert into flm (label, id) values ('rent_in', public.create_category('Rent in', 'income'));

-- The forecast lines: rent 2,500.00 next month only, cleaning 400.00 every month from next month,
-- a 5.00 fee next month, and 1,000.00 of income next month.
insert into flm (label, id) values ('e_rent', (public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('next'),
  jsonb_build_object('category_id', pg_temp.id('rent'), 'direction', 'expense', 'amount_minor', 250000))->'edit'->>'id')::uuid);
insert into flm (label, id) values ('e_clean', (public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('next'),
  jsonb_build_object('category_id', pg_temp.id('cleaning'), 'direction', 'expense', 'amount_minor', 40000, 'pace', 'month'))->'edit'->>'id')::uuid);
insert into flm (label, id) values ('e_fee', (public.set_project_forecast_edit(pg_temp.id('project2'), pg_temp.m('next'),
  jsonb_build_object('category_id', pg_temp.id('fees'), 'direction', 'expense', 'amount_minor', 500))->'edit'->>'id')::uuid);
insert into flm (label, id) values ('e_income', (public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('next'),
  jsonb_build_object('category_id', pg_temp.id('rent_in'), 'direction', 'income', 'amount_minor', 100000))->'edit'->>'id')::uuid);

reset role;
insert into flm (label, id) select 'co', p.company_id from public.projects p where p.id = pg_temp.id('project');
insert into flm (label, id) select 'other_co', p.company_id from public.projects p where p.id = pg_temp.id('other_project');
-- The other company forecasts the same rent.
insert into public.project_forecast_edits (company_id, project_id, kind, category_id, direction, amount_minor, pace, start_month)
values (pg_temp.id('other_co'), pg_temp.id('other_project'), 'add', pg_temp.id('other_rent'), 'expense', 250000, 'once', pg_temp.m('next'));

-- A ledger line: signed net (an expense negative), on the 15th of a month.
create function pg_temp.line(p_label text, p_co text, p_direction text, p_net bigint, p_month text, p_currency text default 'ILS')
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.transactions (
    company_id, direction, doc_kind, amount_gross, amount_net, vat_amount, vat_status, doc_date,
    source, idempotency_key, currency, amount_original
  ) values (
    pg_temp.id(p_co), p_direction::public.txn_direction, 'expense', p_net, p_net, 0, 'unknown', (p_month || '-15')::date,
    'manual', 'flm:' || p_label, p_currency, abs(p_net)
  ) returning id into v;
  insert into flm (label, id) values (p_label, v);
  return v;
end;
$$;

-- The edit a line matches alone, or null.
create function pg_temp.match_of(p_line text) returns uuid language sql stable as $$
  select f.edit_id from private.forecast_line_match(pg_temp.id('co'), array[pg_temp.id(p_line)]) f;
$$;

select pg_temp.line('in_tol', 'co', 'expense', -260000, pg_temp.m('next'));
select pg_temp.line('out_tol', 'co', 'expense', -280000, pg_temp.m('next'));
select pg_temp.line('too_early', 'co', 'expense', -250000, pg_temp.m('now'));
select pg_temp.line('once_later', 'co', 'expense', -250000, pg_temp.m('next2'));
select pg_temp.line('clean_later', 'co', 'expense', -40000, pg_temp.m('next2'));
select pg_temp.line('refund', 'co', 'expense', 250000, pg_temp.m('next'));
select pg_temp.line('income', 'co', 'income', 102000, pg_temp.m('next'));
select pg_temp.line('usd', 'co', 'expense', -250000, pg_temp.m('next'), 'USD');
select pg_temp.line('fee', 'co', 'expense', -590, pg_temp.m('next'));
select pg_temp.line('other_line', 'other_co', 'expense', -250000, pg_temp.m('next'));

-- The amount tolerance: max(10% of the expected amount, 1.00).
select is(pg_temp.match_of('in_tol'), pg_temp.id('e_rent'), 'a line 4% over the expected amount matches');
select is(pg_temp.match_of('out_tol'), null, 'a line 12% over does not');
select is(pg_temp.match_of('fee'), pg_temp.id('e_fee'), 'a small line within 1.00 of the expected amount matches');
select is(
  (select f.project_id from private.forecast_line_match(pg_temp.id('co'), array[pg_temp.id('in_tol')]) f),
  pg_temp.id('project'),
  'the match names the edit''s project'
);

-- The month and the pace.
select is(pg_temp.match_of('too_early'), null, 'a line before the edit''s start month does not match');
select is(pg_temp.match_of('once_later'), null, 'a once edit does not match the month after');
select is(pg_temp.match_of('clean_later'), pg_temp.id('e_clean'), 'a monthly edit matches a later month');
select is(
  (select f.month from private.forecast_line_match(pg_temp.id('co'), array[pg_temp.id('clean_later')]) f),
  pg_temp.m('next2'),
  'the match is for the line''s month'
);

-- A change of the added line for the month moves the expected amount.
insert into public.project_forecast_edits (company_id, project_id, kind, row_key, amount_minor, pace, start_month)
values (pg_temp.id('co'), pg_temp.id('project'), 'change', 'add:' || pg_temp.id('e_clean'), 60000, 'once', pg_temp.m('next2'));
select is(pg_temp.match_of('clean_later'), null, 'a changed amount for the month is the one compared');
delete from public.project_forecast_edits where kind = 'change' and row_key = 'add:' || pg_temp.id('e_clean');

-- A removal of the added line for the month: nothing to match.
insert into public.project_forecast_edits (company_id, project_id, kind, row_key, pace, start_month)
values (pg_temp.id('co'), pg_temp.id('project'), 'remove', 'add:' || pg_temp.id('e_clean'), 'once', pg_temp.m('next2'));
select is(pg_temp.match_of('clean_later'), null, 'an added line taken out of the month does not match');
delete from public.project_forecast_edits where kind = 'remove' and row_key = 'add:' || pg_temp.id('e_clean');

-- The direction and the currency.
select is(pg_temp.match_of('refund'), null, 'a refund (money in on an expense) does not match an expense line');
select is(pg_temp.match_of('income'), pg_temp.id('e_income'), 'income matches an income line');
select is(pg_temp.match_of('usd'), null, 'a line in another currency than the books does not match');

-- Another company.
select is(
  (select count(*)::integer from private.forecast_line_match(pg_temp.id('co'), array[pg_temp.id('other_line')])),
  0,
  'another company''s line is not read'
);
select is(
  (select f.edit_id from private.forecast_line_match(pg_temp.id('other_co'), array[pg_temp.id('other_line')]) f),
  (select e.id from public.project_forecast_edits e where e.company_id = pg_temp.id('other_co')),
  'each company matches only its own edits'
);

-- One line per edit and month: the closest wins, and a held month is taken.
select pg_temp.line('exact', 'co', 'expense', -250000, pg_temp.m('next'));
select is(
  (select array_agg(f.line_id) from private.forecast_line_match(pg_temp.id('co'), array[pg_temp.id('in_tol'), pg_temp.id('exact')]) f
   where f.edit_id = pg_temp.id('e_rent')),
  array[pg_temp.id('exact')],
  'two lines for one edit and month: only the closest matches'
);
insert into public.forecast_line_matches (company_id, edit_id, month, transaction_id, expected_minor)
values (pg_temp.id('co'), pg_temp.id('e_rent'), pg_temp.m('next'), pg_temp.id('exact'), 250000);
select is(pg_temp.match_of('in_tol'), null, 'an edit month another line holds is taken');
delete from public.forecast_line_matches;

-- A line the owner split is never one forecast line.
select pg_temp.line('shared', 'co', 'expense', -250000, pg_temp.m('next'));
update public.transactions set pnl_role = 'shared' where id = pg_temp.id('shared');
select is(pg_temp.match_of('shared'), null, 'a line split as a shared cost does not match');

-- The sync pass, through upsert_connector_lines.
delete from public.transactions where idempotency_key like 'flm:%';

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

-- One bank line: an expense of p_amount (minor units) on the 12th. No pnl_role is a bank line (Mercury);
-- 'project' with a hint is a SUMIT line filed to a budget section.
create function pg_temp.ln(p_ext text, p_amount bigint, p_month text, p_role text default null,
  p_supplier text default null, p_section text default null)
returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'source', 'sumit',
    'external_id', p_ext,
    'direction', 'expense',
    'line_status', 'posted',
    'doc_kind', 'expense',
    'pnl_role', p_role,
    'currency', 'ILS',
    'amount_original', p_amount,
    'amount_negated', true,
    'doc_date', p_month || '-12',
    'description', 'Bank line ' || p_ext,
    'counterparty', case when p_supplier is null then null else jsonb_build_object('name', p_supplier, 'kind', 'supplier') end,
    'project_hint', case when p_section is null then null else jsonb_build_object('name', p_section) end,
    'vat', jsonb_build_object('amount', 0, 'status', 'unknown'),
    'provider_meta', '{}'::jsonb
  ));
$$;

create function pg_temp.sync(variadic p_lines jsonb[]) returns void language sql as $$
  select public.upsert_connector_lines(
    pg_temp.id('co'), 'sumit',
    jsonb_build_object('lines', to_jsonb(p_lines), 'removed_ids', '[]'::jsonb, 'complete', false),
    null, null
  );
$$;

create function pg_temp.txn(p_ext text) returns public.transactions language sql stable as $$
  select t.* from public.transactions t where t.company_id = pg_temp.id('co') and t.external_id = p_ext;
$$;

create function pg_temp.matched(p_ext text) returns text language sql stable as $$
  select m.edit_id::text || ':' || m.month from public.forecast_line_matches m where m.transaction_id = (pg_temp.txn(p_ext)).id;
$$;

create function pg_temp.queued(p_ext text) returns text language sql stable as $$
  select q.reason from public.review_queue q where q.transaction_id = (pg_temp.txn(p_ext)).id and q.status = 'open';
$$;

select pg_temp.sync(pg_temp.ln('rent-1', 251000, pg_temp.m('next')));
select is((pg_temp.txn('rent-1')).project_id, pg_temp.id('project'), 'the sync suggests the forecast line''s project');
select is((pg_temp.txn('rent-1')).category_id, pg_temp.id('rent'), 'and its category');
select is((pg_temp.txn('rent-1')).category_suggested, true, 'the category stays a suggestion');
select is((pg_temp.txn('rent-1')).pnl_role, null, 'the line stays unassigned in the P&L until approved');
select is(
  (select a.project_id::text || ':' || a.share_bp::text || ':' || a.amount_net::text from public.allocations a
   where a.transaction_id = (pg_temp.txn('rent-1')).id),
  pg_temp.id('project')::text || ':10000:-251000',
  'the expense carries one allocation to the project'
);
select is(
  (select m.edit_id::text || ':' || m.month || ':' || m.expected_minor::text from public.forecast_line_matches m
   where m.transaction_id = (pg_temp.txn('rent-1')).id),
  pg_temp.id('e_rent')::text || ':' || pg_temp.m('next') || ':250000',
  'the match is recorded with the month and the expected amount'
);
select is(pg_temp.queued('rent-1'), 'suggested', 'the line waits in review as a suggestion');

-- The same line synced again keeps its match, matched_at included.
update public.forecast_line_matches set matched_at = '2026-01-01T00:00:00Z' where transaction_id = (pg_temp.txn('rent-1')).id;
select pg_temp.sync(pg_temp.ln('rent-1', 251000, pg_temp.m('next')));
select is(
  (select m.matched_at from public.forecast_line_matches m where m.transaction_id = (pg_temp.txn('rent-1')).id),
  '2026-01-01T00:00:00Z'::timestamptz,
  'a second sync of the line keeps the match and when it was made'
);
select is((pg_temp.txn('rent-1')).project_id, pg_temp.id('project'), 'and the suggested project');

-- What the review, Jev's reasons, the jev-tag read and the forecast read say.
select tests.authenticate_as('flm_owner');
select is(
  (select r->'forecast_match' from jsonb_array_elements(public.list_review()) r
   where r->>'transaction_id' = (select t.id::text from public.transactions t where t.external_id = 'rent-1')),
  jsonb_build_object('month', pg_temp.m('next'), 'amount_minor', 250000, 'category_name', 'Site rent', 'project_name', 'Juniper Ct'),
  'list_review carries the forecast line'
);
select is(
  (select e->>'matched_transaction_id' from jsonb_array_elements(public.project_forecast_edits_for(pg_temp.id('project'), pg_temp.m('next'))) e
   where e->>'id' = pg_temp.id('e_rent')::text),
  (select t.id::text from public.transactions t where t.external_id = 'rent-1'),
  'the forecast read names the line an added line matched in the month'
);
select is(
  (select e->'matched_transaction_id' from jsonb_array_elements(public.project_forecast_edits_for(pg_temp.id('project'), pg_temp.m('next'))) e
   where e->>'id' = pg_temp.id('e_clean')::text),
  'null'::jsonb,
  'an added line with no line yet has none'
);
reset role;

insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
values (
  pg_temp.id('co'), (pg_temp.txn('rent-1')).id,
  jsonb_build_object('project', jsonb_build_object('choice', pg_temp.id('project')), 'category', jsonb_build_object('choice', pg_temp.id('rent'))),
  0.9, 'test', 'test'
);
select is(
  (select s->>'reason' || ':' || (s->>'forecast_month')
   from jsonb_array_elements(private.jev_suggestions_for(pg_temp.id('co'), array[(pg_temp.txn('rent-1')).id])) s),
  'forecast_line:' || pg_temp.m('next'),
  'Jev''s reason is the forecast line, with its month'
);
update public.tag_suggestions
set answers = jsonb_build_object('project', jsonb_build_object('choice', pg_temp.id('project2')))
where transaction_id = (pg_temp.txn('rent-1')).id;
select is(
  (select s->>'reason' || ':' || coalesce(s->>'forecast_month', '-')
   from jsonb_array_elements(private.jev_suggestions_for(pg_temp.id('co'), array[(pg_temp.txn('rent-1')).id])) s),
  'new_party:-',
  'a Jev suggestion that disagrees with the forecast line keeps its own reason'
);

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;
select is(
  public.jev_forecast_lines(pg_temp.id('co'), array[(pg_temp.txn('rent-1')).id]),
  jsonb_build_array(jsonb_build_object(
    'transaction_id', (pg_temp.txn('rent-1')).id, 'month', pg_temp.m('next'), 'amount_minor', 250000,
    'category_name', 'Site rent', 'project_name', 'Juniper Ct'
  )),
  'the jev-tag read gives the forecast line'
);
select is(
  public.jev_forecast_lines(pg_temp.id('other_co'), array[(pg_temp.txn('rent-1')).id]),
  '[]'::jsonb,
  'the jev-tag read of another company gives nothing'
);

-- A supplier rule's line (a firm category) of the same category gets the project as a suggestion,
-- and waits in review: it is never filed unseen.
insert into public.suppliers (company_id, name, remembered_category_id)
values (pg_temp.id('co'), 'Window Team', pg_temp.id('cleaning'));
select pg_temp.sync(pg_temp.ln('rule-1', 39000, pg_temp.m('next2'), null, 'Window Team'));
select is(
  (pg_temp.txn('rule-1')).project_id::text || ':' || (pg_temp.txn('rule-1')).category_id::text || ':' || (pg_temp.txn('rule-1')).category_suggested::text,
  pg_temp.id('project')::text || ':' || pg_temp.id('cleaning')::text || ':false',
  'a supplier rule''s line takes the project and keeps the rule''s category'
);
select is(pg_temp.queued('rule-1'), 'suggested', 'and waits in review as a suggestion');
insert into public.suppliers (company_id, name, remembered_category_id)
values (pg_temp.id('co'), 'Fee Desk', pg_temp.id('fees'));
select pg_temp.sync(pg_temp.ln('rule-2', 40000, pg_temp.m('next'), null, 'Fee Desk'));
select is((pg_temp.txn('rule-2')).project_id, null, 'a supplier rule of another category is not the forecast line');

-- A SUMIT budget section's project is the bookkeeper's: never changed, and not this forecast line.
select pg_temp.sync(pg_temp.ln('sec-1', 40000, pg_temp.m('next'), 'project', null, 'Aspen Row'));
select is((pg_temp.txn('sec-1')).project_id, pg_temp.id('project2'), 'a budget section''s project stays');
select is(pg_temp.matched('sec-1'), null, 'and the line is not the forecast line of another project');

-- A provider project line with no project gets a pending match: no project, the card shows the line.
select pg_temp.sync(pg_temp.ln('sumit-1', 40000, pg_temp.m('next'), 'project'));
select is((pg_temp.txn('sumit-1')).project_id, null, 'a provider''s project line gets no project from the forecast');
select is(pg_temp.matched('sumit-1'), pg_temp.id('e_clean')::text || ':' || pg_temp.m('next'), 'its match is pending');
select is(pg_temp.queued('sumit-1'), 'missing_project', 'and it waits in review for its project');

-- In one sync, a line that moved out of tolerance frees its month for a better line.
select pg_temp.sync(pg_temp.ln('clean-a', 40000, pg_temp.m('next3')));
select is(pg_temp.matched('clean-a'), pg_temp.id('e_clean')::text || ':' || pg_temp.m('next3'), 'a line holds the month');
select pg_temp.sync(pg_temp.ln('clean-a', 90000, pg_temp.m('next3')), pg_temp.ln('clean-b', 40500, pg_temp.m('next3')));
select is(pg_temp.matched('clean-b'), pg_temp.id('e_clean')::text || ':' || pg_temp.m('next3'), 'its month goes to the line that fits now');
select is(pg_temp.matched('clean-a'), null, 'and the line that moved has none');

-- From here a change drops a match at once (the trigger is deferred to the end of a transaction).
set constraints transactions_forecast_line_refiled immediate;

-- A line the owner set is never changed by the pass.
update public.transactions
set project_id = pg_temp.id('project2'), user_assigned = true, project_assigned = true
where id = (pg_temp.txn('clean-b')).id;
select pg_temp.sync(pg_temp.ln('clean-b', 40500, pg_temp.m('next3')));
select is((pg_temp.txn('clean-b')).project_id, pg_temp.id('project2'), 'the owner''s project stays');
select is(pg_temp.matched('clean-b'), null, 'a line the owner filed elsewhere is not the forecast line');

-- A re-file to another project or category drops the match; so does a removed line.
update public.transactions set project_id = pg_temp.id('project2') where id = (pg_temp.txn('rent-1')).id;
select is(pg_temp.matched('rent-1'), null, 'a line re-filed to another project loses its match');
update public.transactions set category_id = pg_temp.id('fees') where id = (pg_temp.txn('sumit-1')).id;
select is(pg_temp.matched('sumit-1'), null, 'a line re-filed to another category loses its match');
update public.transactions set removed_at = now() where id = (pg_temp.txn('rule-1')).id;
select is(pg_temp.matched('rule-1'), null, 'a removed line loses its match');

select * from finish();

rollback;
