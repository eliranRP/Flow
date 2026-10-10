-- get_project keeps one plan per connection. plpgsql builds a fresh custom plan for each of
-- the first five calls of a statement with parameters before it considers a generic one, and
-- a pooled REST connection rarely gets that far, so most calls planned the page's large SELECT
-- again (about half of a call's time). A generic plan is built once per connection and reused.
-- The function reads the project's lines first and looks up each line's rows by index
-- (20261013235425_project_page_speed_stats.sql), so its plan does not depend on the values.
-- Results stay the same. A later `create or replace` of get_project must keep this setting.

alter function public.get_project(uuid, text, date, date) set plan_cache_mode = force_generic_plan;
