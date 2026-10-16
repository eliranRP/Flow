-- FLOW-446 (server part). get_project's loans carry their terms, so the client works out the next
-- payment with packages/shared/src/loan-schedule.ts, the same way FLOW-139's list does. Closed
-- loans were already returned; they carry closed_on. The function is patched, like the migrations
-- before it, and only the anchor below changes.

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $loan_terms$
declare
  def text;
  anchor text := $a$'kind', l.kind$a$;
begin
  def := pg_get_functiondef('public.get_project(uuid,text,date,date)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'get_project is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $a$,
        'principal_minor', l.principal_minor,
        'annual_rate_ppm', l.annual_rate_ppm,
        'term_months', l.term_months,
        'start_date', l.start_date,
        'payment_minor', l.payment_minor,
        'escrow_minor', l.escrow_minor,
        'interest_only_months', l.interest_only_months,
        'amortization_months', l.amortization_months,
        'rates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'effective_date', r.effective_date,
            'annual_rate_ppm', r.annual_rate_ppm
          ) order by r.effective_date)
          from public.loan_rates r
          where r.company_id = l.company_id
            and r.loan_id = l.id
        ), '[]'::jsonb)$a$);
  execute def;
end
$loan_terms$;
