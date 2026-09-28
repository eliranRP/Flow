begin;

select plan(2);

select has_function(
  'public',
  'reopen_review',
  array['uuid'],
  'reopen_review exists for an authenticated owner'
);

select function_privs_are(
  'public',
  'reopen_review',
  array['uuid'],
  'anon',
  array[]::text[],
  'anon cannot reopen a review item'
);

select * from finish();

rollback;
