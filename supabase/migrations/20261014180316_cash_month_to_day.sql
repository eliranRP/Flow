-- FLOW-364 (Home's same-day comparison). What the cash view counts in one month up to a day of
-- it: נכנס (in_minor) and יצא (out_minor) per currency. cash_months runs a month to its end, so
-- Home's "שינוי מול <previous month>, עד ה־<day>" needs this read for the previous month.
-- p_day is clamped to the month's last day (31 in a 30-day month is its 30th).
-- Same company resolution and cash basis as cash_months. Invented data only.
--
-- Security definer, as cash_months: private.cash_parts is not granted to authenticated.

begin;

create or replace function public.cash_month_to_day(p_month date, p_day integer)
returns table (currency text, in_minor bigint, out_minor bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  basis text;
  month_start date;
  month_end date;
  upto date;
begin
  cid := private.readable_company_id();
  if cid is null then
    return;
  end if;
  if p_month is null or p_day is null or p_day < 1 or p_day > 31 then
    raise exception 'validation';
  end if;
  select c.cash_basis into basis
  from public.companies c
  where c.id = cid;

  month_start := date_trunc('month', p_month)::date;
  month_end := (month_start + interval '1 month' - interval '1 day')::date;
  upto := least(month_start + (p_day - 1), month_end);

  return query
    select
      p.currency,
      coalesce(sum(p.amount_minor) filter (where p.in_cash and p.kind = 'income'), 0)::bigint,
      coalesce(sum(-p.amount_minor) filter (where p.in_cash and p.kind = 'expense'), 0)::bigint
    from private.cash_parts(cid, basis, month_start, upto) p
    group by p.currency;
end;
$$;

revoke all on function public.cash_month_to_day(date, integer) from public, anon;
grant execute on function public.cash_month_to_day(date, integer) to authenticated, service_role;

comment on function public.cash_month_to_day(date, integer) is
  'FLOW-364: one month''s cash (נכנס, יצא per currency) up to a day of it, on the company''s cash basis; the day is clamped to the month''s last day.';

commit;
