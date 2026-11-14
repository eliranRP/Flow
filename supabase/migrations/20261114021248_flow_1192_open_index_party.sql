-- FLOW-1192 (perf review, 2026-11-14), two index fixes.
-- 1. review_queue_open_idx comes back. Migration 20261113060409 dropped it and said review_queue_company_idx (company_id,
--    status) serves the open-row reads. Under RLS it does not: enum_eq is not leakproof, so status = 'open' is a Filter
--    on that index, not an index condition (list_review_page as the QA user: Rows Removed by Filter 795). The partial
--    index's predicate is still matched under RLS. Same definition as schema_v1 (20260928080538).
-- 2. private.recurring_match_suggestions: the "first seen lately" anti-join also tests coalesce(supplier_id, customer_id)
--    = the party, the expression transactions_party_date_idx is on (company_id, coalesce(supplier_id, customer_id),
--    doc_date) where removed_at is null. The case test stays as an extra filter. The function is re-created from its
--    body in 20261113141912, with that one predicate added; signature, security definer, search_path, stable, grants
--    and revokes are unchanged (create or replace keeps the grants; the revoke is restated).
--    The answers are unchanged while no line carries both a supplier and a customer: for an income charge, such a line
--    used to count as an earlier line of its customer and no longer does. No constraint forbids such a line; production
--    had none on 2026-11-14 (0 of 2,828 lines, a read-only count). Exact equality would need an OR branch and a second
--    index, out of scope here.

begin;

create index if not exists review_queue_open_idx on public.review_queue (company_id) where status = 'open';

create or replace function private.recurring_match_suggestions(p_company uuid, p_today date, p_charges jsonb)
returns table(direction public.txn_direction, party_id uuid, currency text, due_month date, typical bigint, suggestion jsonb)
language sql
stable
security definer
set search_path to ''
as $$
  with ch as (
    select distinct c.direction, c.party_id, c.currency, c.due_month, c.typical
    from jsonb_to_recordset(p_charges)
      as c(direction public.txn_direction, party_id uuid, currency text, due_month date, typical bigint)
  ),
  -- Every party's name, its words made once (private.party_name_words).
  names as (
    select 'expense'::public.txn_direction as direction, s.id, s.name, private.party_name_words(s.name) as words
    from public.suppliers s where s.company_id = p_company
    union all
    select 'income'::public.txn_direction, cu.id, cu.name, private.party_name_words(cu.name)
    from public.customers cu where cu.company_id = p_company
  ),
  -- The one definition of two names that may be one party, on the words: neither empty, and the same first word of 3 letters
  -- or more, or one name inside the other.
  alike as (
    select me.direction, me.id as party_id, n.id, n.name
    from (select distinct c.direction, c.party_id from ch c) cp
    join names me on me.direction = cp.direction and me.id = cp.party_id
    join names n on n.direction = me.direction and n.id <> me.id
    where me.words <> '' and n.words <> ''
      and ((char_length(split_part(me.words, ' ', 1)) >= 3 and split_part(me.words, ' ', 1) = split_part(n.words, ' ', 1))
        or position(me.words in n.words) > 0 or position(n.words in me.words) > 0)
  )
  select ch.direction, ch.party_id, ch.currency, ch.due_month, ch.typical,
    (select jsonb_build_object(
        'party_id', l.id,
        'party_name', l.name,
        'transaction_id', l.transaction_id,
        'doc_date', l.doc_date,
        'amount_minor', l.amount_net
      )
     from (
       select distinct on (c.id) c.id, c.name, t.id as transaction_id, t.doc_date, t.amount_net
       from alike c
       join public.transactions t
         on t.company_id = p_company and t.direction = ch.direction and t.currency = ch.currency
         and c.id = case when ch.direction = 'expense' then t.supplier_id else t.customer_id end
       where c.direction = ch.direction and c.party_id = ch.party_id
         and not exists (
           select 1 from public.recurring_matches m
           where m.company_id = p_company and m.direction = ch.direction
             and ((m.party_id = ch.party_id and m.match_party_id = c.id) or (m.match_party_id = c.id and m.same)
               or m.party_id = c.id)
         )
         and t.removed_at is null
         and t.line_status = 'posted'
         and (ch.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
         and t.doc_date >= (ch.due_month - interval '1 month')::date
         and t.doc_date <= p_today
         -- First seen lately: no line before the month ahead of the due month.
         and not exists (
           select 1 from public.transactions o
           where o.company_id = p_company and o.removed_at is null and o.line_status = 'posted'
             and coalesce(o.supplier_id, o.customer_id) = c.id
             and c.id = case when ch.direction = 'expense' then o.supplier_id else o.customer_id end
             and o.doc_date < (ch.due_month - interval '1 month')::date
         )
       order by c.id, t.doc_date desc, t.created_at desc
     ) l
     where ch.typical <> 0
       and abs(l.amount_net) * 2 >= abs(ch.typical)
       and abs(l.amount_net) * 2 <= abs(ch.typical) * 3
     order by abs(abs(l.amount_net) - abs(ch.typical)), l.doc_date desc, l.id
     limit 1) as suggestion
  from ch;
$$;

revoke all on function private.recurring_match_suggestions(uuid, date, jsonb) from public, anon, authenticated;

commit;
