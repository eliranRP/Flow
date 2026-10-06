begin;

-- Adding mercury to txn_source. The next migration is the one that uses it.
-- A new enum value cannot be used in the same transaction.

set local lock_timeout = '5s';
alter type public.txn_source add value if not exists 'mercury';

commit;
