-- FLOW-951 (decision 0209). How the legs are posted: the transactions update trigger re-posts only the
-- lines whose posting columns changed (header-only edits leave the legs alone, since the shadow view
-- reads the header at view time); one insert statement posts all its lines; allocation edits post
-- nothing (allocations are read at view time); a deleted line loses its legs through the key; a
-- category rename leaves the legs alone and a keep-out re-posts them. Also: pnl_lines gives the
-- expected rows, a corrupted leg unbalances its line and re-posting repairs it, re-posting every line
-- gives the legs the triggers gave, kept-out routing, leg kinds, and that no client can post or write
-- parts. Since decision 0232 the legs are the only booking store (no legacy rows to compare with).
-- Invented data only; amounts are agorot.

begin;

select plan(23);

do $u$ begin perform tests.create_supabase_user('lpt_owner', 'lpt-owner@example.com'); end $u$;

create temp table lpt (label text primary key, id uuid);
grant all on lpt to authenticated, service_role;
insert into lpt values ('co', tests.fixture_company('lpt_owner', 'Example Posting LLC'));

create or replace function pg_temp.id(p_label text) returns uuid language sql as $$
  select id from pg_temp.lpt where label = p_label $$;
-- The leg ids of one line, as text: unchanged ids mean the line was not re-posted.
create or replace function pg_temp.leg_ids(p_label text) returns text language sql as $$
  select string_agg(id::text, ',' order by id) from public.legs where transaction_id = pg_temp.id(p_label) $$;
-- The company's lines whose legs on the books do not balance.
create or replace function pg_temp.diff_rows() returns bigint language sql as $$
  select count(*) from (
    select l.transaction_id from public.legs l
    where l.company_id = pg_temp.id('co') and not l.draft
    group by l.transaction_id having sum(l.amount_minor) <> 0) x $$;
create temp table lpt_seen (label text primary key, v text);

do $fixture$
declare
  co uuid := pg_temp.id('co');
  pa uuid; pb uuid; c1 uuid; c2 uuid; ci uuid; cx uuid; ln uuid;
begin
  pa := tests.fixture_project(co, 'Posting A');
  pb := tests.fixture_project(co, 'Posting B');
  c1 := tests.fixture_category(co, 'Posting cost');
  c2 := tests.fixture_category(co, 'Posting other');
  ci := tests.fixture_category(co, 'Posting sales', 'income');
  cx := tests.fixture_category(co, 'Posting kept out', 'expense', true);
  insert into pg_temp.lpt values ('pa', pa), ('pb', pb), ('c1', c1), ('c2', c2), ('ci', ci), ('cx', cx);
  insert into pg_temp.lpt values
    ('a', tests.fixture_line(co, 'lpt:a', 10000, 'expense', pa, c1)),
    ('b', tests.fixture_line(co, 'lpt:b', 20000, 'expense', pb, c1)),
    ('inc', tests.fixture_line(co, 'lpt:inc', 50000, 'income', pa, ci)),
    ('out', tests.fixture_line(co, 'lpt:out', 7000, 'expense', pa, cx)),
    ('shared', tests.fixture_line(co, 'lpt:shared', 9000, 'expense', null, c1, p_pnl_role => 'shared'));
  ln := tests.fixture_line(co, 'lpt:split', 8000, 'expense', pa, null);
  insert into pg_temp.lpt values ('split', ln);
  perform tests.line_split(ln, jsonb_build_array(
    jsonb_build_object('category_id', c1, 'project_id', pb, 'amount_minor', 5000),
    jsonb_build_object('category_id', c2, 'project_id', null, 'amount_minor', 3000)));
  insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
  values (co, pg_temp.id('shared'), pa, 5000, -4500), (co, pg_temp.id('shared'), pb, 5000, -4500);
end
$fixture$;

-- 1. pnl_lines reads the expected rows from the legs: each line whole, the split by its parts (the first
-- part on its own project), the kept-out line out of profit.
select is(
  (select string_agg(x.k, ' ' order by x.k) from (
     select coalesce(lt.label, '?') || ':' || coalesce(lc.label, '-') || ':' || coalesce(lp.label, '-') || ':'
       || p.amount_net || ':' || p.in_pnl as k
     from private.pnl_lines p
     left join pg_temp.lpt lt on lt.id = p.transaction_id
     left join pg_temp.lpt lc on lc.id = p.category_id
     left join pg_temp.lpt lp on lp.id = p.project_id
     where p.company_id = pg_temp.id('co')) x),
  'a:c1:pa:-10000:true b:c1:pb:-20000:true inc:ci:pa:50000:true out:cx:pa:-7000:false shared:c1:-:-9000:true split:c1:pb:-5000:true split:c2:pa:-3000:true',
  'pnl_lines gives the expected rows');
select is(pg_temp.diff_rows(), 0::bigint, 'every line''s legs balance after the fixture');

-- 2. Header-only edits do not re-post (the shadow reads them at view time).
insert into lpt_seen values ('a', pg_temp.leg_ids('a')), ('b', pg_temp.leg_ids('b'));
update public.transactions
set description = 'lpt edited', doc_date = date '2026-06-02', cash_date = date '2026-06-03',
    doc_kind = 'invoice', currency = 'USD', pnl_role = 'shared', in_cash_override = false
where id = pg_temp.id('a');
select is(pg_temp.leg_ids('a'), (select v from lpt_seen where label = 'a'), 'a header-only edit leaves the line''s legs alone');
select is(pg_temp.diff_rows(), 0::bigint, 'after a header-only edit the legs still balance');

-- 3. A posting edit re-posts only that line.
update public.transactions set amount_net = -11000, amount_gross = -11000 where id = pg_temp.id('a');
select isnt(pg_temp.leg_ids('a'), (select v from lpt_seen where label = 'a'), 'an amount edit re-posts the line');
select is(pg_temp.leg_ids('b'), (select v from lpt_seen where label = 'b'), 'another line is not re-posted');
select is((select amount_minor from public.legs where transaction_id = pg_temp.id('a') and leg_kind = 'bank'), -11000::bigint,
  'the re-posted bank leg carries the new amount');

-- 4. One update statement over several lines: only the changed ones are re-posted.
update lpt_seen set v = pg_temp.leg_ids('a') where label = 'a';
insert into lpt_seen values ('inc', pg_temp.leg_ids('inc'));
update public.transactions
set project_id = case when id = pg_temp.id('b') then pg_temp.id('pa') else project_id end,
    description = description || '.'
where id in (pg_temp.id('a'), pg_temp.id('b'), pg_temp.id('inc'));
select ok(
  pg_temp.leg_ids('a') = (select v from lpt_seen where label = 'a')
  and pg_temp.leg_ids('inc') = (select v from lpt_seen where label = 'inc')
  and pg_temp.leg_ids('b') <> (select v from lpt_seen where label = 'b'),
  'a multi-row update re-posts the line whose project changed and no other');
select is((select project_id from public.legs where transaction_id = pg_temp.id('b') and leg_kind = 'item'), pg_temp.id('pa'),
  'its item leg moved to the new project');

-- 5. One insert statement of several lines posts each, with bank, item and VAT legs.
insert into public.transactions (company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date, source,
  idempotency_key, project_id, category_id, description, user_assigned)
select pg_temp.id('co'), 'expense', 'receipt', 'project', 'posted', 'ILS', -11800, -10000, 11800, -1800, 'source',
  date '2026-06-10', date '2026-06-10', 'manual', 'lpt:bulk:' || g, pg_temp.id('pa'), pg_temp.id('c2'), 'lpt bulk', true
from generate_series(1, 3) g;
select is(
  (select string_agg(k, ',' order by k) from (
     select l.leg_kind || ':' || count(*) as k
     from public.legs l join public.transactions t on t.id = l.transaction_id
     where t.idempotency_key like 'lpt:bulk:%' group by l.leg_kind) x),
  'bank:3,item:3,vat:3', 'one insert of three lines posts three bank, three item and three VAT legs');
select is(pg_temp.diff_rows(), 0::bigint, 'after a bulk insert the legs balance');

-- 6. Allocation edits post nothing; the shadow follows them at view time.
insert into lpt_seen values ('shared', pg_temp.leg_ids('shared'));
delete from public.allocations where transaction_id = pg_temp.id('shared');
select is(pg_temp.leg_ids('shared'), (select v from lpt_seen where label = 'shared'), 'removing allocations leaves the legs alone');
select is(
  (select bool_and(unassigned) from private.pnl_lines where transaction_id = pg_temp.id('shared')), true,
  'the P&L over the legs shows the shared line unassigned at once');
select is(pg_temp.diff_rows(), 0::bigint, 'after an allocation edit the legs balance');

-- 7. A category rename leaves the legs alone (the bridge account takes the name); a keep-out re-posts.
update lpt_seen set v = pg_temp.leg_ids('b') where label = 'b';
update public.categories set name = 'Posting cost renamed' where id = pg_temp.id('c1');
select ok(
  pg_temp.leg_ids('b') = (select v from lpt_seen where label = 'b')
  and (select name from public.accounts where category_id = pg_temp.id('c1')) = 'Posting cost renamed',
  'a rename leaves the legs alone and renames the bridge account');
update public.categories set excluded_from_pnl = true where id = pg_temp.id('c1');
select is(
  (select a.name from public.legs l join public.accounts a on a.id = l.account_id
   where l.transaction_id = pg_temp.id('b') and l.leg_kind = 'item'),
  'Suspense', 'a keep-out re-posts the line onto the kept-out account');
select is(
  (select category_id from public.legs where transaction_id = pg_temp.id('b') and leg_kind = 'item'), pg_temp.id('c1'),
  'the kept-out leg still names the category the person sees');

-- 8. A deleted line's legs go with it (the key cascades; no delete trigger is needed).
delete from public.transactions where id = pg_temp.id('out');
select is((select count(*) from public.legs where transaction_id = pg_temp.id('out')), 0::bigint, 'a deleted line has no legs');

-- 9. A corrupted bank leg unbalances its line (the balance check waits for the commit), and re-posting
-- the line repairs it.
update public.legs set amount_minor = amount_minor - 100
where transaction_id = pg_temp.id('split') and leg_kind = 'bank';
select is(pg_temp.diff_rows(), 1::bigint, 'a corrupted leg unbalances its line');
select private.post_lines(pg_temp.id('co'), array[pg_temp.id('split')]);
select is(pg_temp.diff_rows(), 0::bigint, 'post_lines repairs it');

-- 10. post_lines over every line posts exactly what the triggers posted, parts included.
create temp table lpt_one as
select transaction_id, account_id, project_id, amount_minor, ordinal, leg_kind, category_id, part, gross_up,
  loan_split_fallback, project_explicit, split_part, part_ordinal, loan_id, scheduled_minor, needs_review, draft
from public.legs where company_id = pg_temp.id('co');
select private.post_lines(pg_temp.id('co'), array(select id from public.transactions where company_id = pg_temp.id('co')));
select is(
  (select count(*) from (
    (select * from lpt_one except all
     select transaction_id, account_id, project_id, amount_minor, ordinal, leg_kind, category_id, part, gross_up,
       loan_split_fallback, project_explicit, split_part, part_ordinal, loan_id, scheduled_minor, needs_review, draft
     from public.legs where company_id = pg_temp.id('co'))
    union all
    (select transaction_id, account_id, project_id, amount_minor, ordinal, leg_kind, category_id, part, gross_up,
       loan_split_fallback, project_explicit, split_part, part_ordinal, loan_id, scheduled_minor, needs_review, draft
     from public.legs where company_id = pg_temp.id('co')
     except all select * from lpt_one)) d)::bigint,
  0::bigint, 'post_lines posts the same legs as the triggers did');

-- 11. Kept-out routing and leg kinds.
select is(
  array[
    (select name from public.accounts where id = private.kept_out_account(pg_temp.id('co'), null, 'principal')),
    (select name from public.accounts where id = private.kept_out_account(pg_temp.id('co'), null, 'escrow')),
    (select name from public.accounts where id = private.kept_out_account(pg_temp.id('co'), pg_temp.id('cx'), null)),
    (select name from public.accounts where id = private.kept_out_account(pg_temp.id('co'),
      (select id from public.categories where company_id = pg_temp.id('co') and loan_part = 'principal'), null))
  ],
  array['Loan principal', 'Escrow', 'Suspense', 'Loan principal'],
  'kept_out_account routes by loan part (given, or read from the category), else Suspense');

-- 12. No client posts lines or writes parts. The P&L (private.pnl_lines) reads the legs; a member reads
-- it as before, and anon does not.
select ok(
  has_table_privilege('authenticated', 'private.pnl_lines', 'select')
  and not has_function_privilege('authenticated', 'private.post_lines(uuid,uuid[])', 'execute')
  and not has_function_privilege('authenticated', 'private.set_line_parts(uuid,uuid,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.set_loan_parts(uuid,uuid,uuid,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.kept_out_account(uuid,uuid,public.loan_split_part)', 'execute')
  and not has_table_privilege('anon', 'private.pnl_lines', 'select'),
  'posting and the parts writers are closed to clients; the P&L over the legs is read as before');

select finish();
rollback;
