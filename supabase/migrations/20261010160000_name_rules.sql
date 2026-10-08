-- FLOW-205: one name rule in the database for the app and the MCP.
-- Project, category, loan and company names may not hold a control character, a line or
-- paragraph separator, a format character (zero-width, bidi marks such as a pasted RLM,
-- soft hyphen, BOM, tag characters) or a blank filler; ZWJ (U+200D) stays for emoji. This
-- is the flow-mcp HIDDEN_CHARS rule (Unicode 16), spelled out as ranges because Postgres
-- regexes have no \p{Cf}. A no-break or other wide space inside a name becomes a plain
-- space, so two names that look the same are the same.
-- Only an insert or a name change is checked: an existing name never blocks an update of
-- another column.

begin;
set local lock_timeout = '5s';

-- The name without the characters that hide or look like nothing (one place for the set).
create or replace function private.strip_hidden_chars(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(p_name, '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u115F-\u1160\u180E\u200B-\u200C\u200E-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]', '', 'g');
$$;

revoke all on function private.strip_hidden_chars(text) from public, anon, authenticated;

-- True when the name holds a character that hides or looks like nothing.
create or replace function private.name_has_hidden_char(p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_name, '') <> private.strip_hidden_chars(coalesce(p_name, ''));
$$;

revoke all on function private.name_has_hidden_char(text) from public, anon, authenticated;

-- No-break space and the other Unicode space separators become a plain space.
create or replace function private.plain_spaces(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(p_name, '[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]', ' ', 'g');
$$;

revoke all on function private.plain_spaces(text) from public, anon, authenticated;

-- trim_name (20261008013000) also turns inner wide spaces into plain ones. Company names,
-- and below the app's project and category names, so a pasted wide space at either end is
-- trimmed and a name that differs only by one is found as already taken.
create or replace function private.trim_name(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select private.plain_spaces(btrim(
    coalesce(p_name, ''),
    U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  ));
$$;

comment on function private.trim_name(text) is
  'Trims the same whitespace as JavaScript trim() and turns inner wide spaces into plain ones, as flow-mcp does.';

create or replace function private.company_name_problem(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when char_length(coalesce(p_name, '')) < 2 then 'company name is too short'
    when char_length(p_name) > 100 then 'company name is too long'
    when p_name ~ '[\u0001-\u001F\u007F-\u009F]' then 'company name has a control character'
    when private.name_has_hidden_char(p_name) then 'company name has an invisible character'
    else null
  end;
$$;

-- Projects, categories and loans: plain spaces, then no hidden character.
create or replace function private.clean_row_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := private.plain_spaces(new.name);
  if private.name_has_hidden_char(new.name) then
    raise exception 'name has an invisible or control character' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.clean_row_name() from public, anon, authenticated;

-- Named to run before categories_default_pnl, which matches the built-in names. An update
-- that keeps the name is not checked.
drop trigger if exists categories_clean_name on public.categories;
create trigger categories_clean_name
  before insert on public.categories
  for each row
  execute function private.clean_row_name();
drop trigger if exists categories_clean_name_update on public.categories;
create trigger categories_clean_name_update
  before update of name on public.categories
  for each row
  when (new.name is distinct from old.name)
  execute function private.clean_row_name();

drop trigger if exists projects_clean_name on public.projects;
create trigger projects_clean_name
  before insert on public.projects
  for each row
  execute function private.clean_row_name();
drop trigger if exists projects_clean_name_update on public.projects;
create trigger projects_clean_name_update
  before update of name on public.projects
  for each row
  when (new.name is distinct from old.name)
  execute function private.clean_row_name();

drop trigger if exists loans_clean_name on public.loans;
create trigger loans_clean_name
  before insert on public.loans
  for each row
  execute function private.clean_row_name();
drop trigger if exists loans_clean_name_update on public.loans;
create trigger loans_clean_name_update
  before update of name on public.loans
  for each row
  when (new.name is distinct from old.name)
  execute function private.clean_row_name();

-- The app's create_category and upsert_project clean a name like flow-mcp does (trim(),
-- wide spaces plain) before their checks, so a wide-space variant of a taken name is
-- 'category already exists' (or the unique index) on the same text the row gets.
-- A SUMIT budget section name is data from outside: its hidden characters are dropped
-- instead of refusing the whole sync (upsert_connector_lines) or the mapping
-- (map_budget_section). Each is patched in place on one guarded line.
do $clean$
declare
  def text;
  item record;
begin
  for item in
    select * from (values
      ('public.create_category(text,text)',
       $o$clean := btrim(coalesce(p_name, ''));$o$,
       $n$clean := private.trim_name(p_name);$n$),
      ('public.upsert_project(uuid,text,bigint,text)',
       $o$clean := btrim(coalesce(p_name, ''));$o$,
       $n$clean := private.trim_name(p_name);$n$),
      ('public.map_budget_section(bigint,uuid,text)',
       $o$clean := nullif(btrim(coalesce(p_name, '')), '');$o$,
       $n$clean := nullif(private.trim_name(private.strip_hidden_chars(p_name)), '');$n$),
      ('public.upsert_connector_lines(uuid,public.connector_provider,jsonb,text,text)',
       $o$section_name := nullif(btrim(coalesce(line #>> '{project_hint,name}', '')), '');$o$,
       $n$section_name := nullif(private.trim_name(private.strip_hidden_chars(line #>> '{project_hint,name}')), '');$n$)
    ) as v(fn, old_text, new_text)
  loop
    def := pg_get_functiondef(item.fn::regprocedure);
    if position(item.old_text in def) = 0
      or position(item.old_text in substr(def, position(item.old_text in def) + 1)) > 0
    then
      raise exception '% is not the expected definition', item.fn;
    end if;
    execute replace(def, item.old_text, item.new_text);
  end loop;
end
$clean$;

commit;
