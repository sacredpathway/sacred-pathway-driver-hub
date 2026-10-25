-- READ-ONLY: compare a database's recorded migration versions with this repo's files.
-- Run in the SQL editor (or via a read-only role). Writes nothing.
with repo(version) as (values
  ('20260101000000'),('20260101010000'),('20260417120000'),('20260419230000'),('20260420000000'),('20260420010000'),
  ('20260421000000'),('20260521000000'),('20260521010000'),('20260521020000'),('20260521030000'),('20260522000000'),
  ('20260523000000'),('20260524000000'),('20260525000000'),('20260526000000'),('20260527000000'),('20260528000000'),
  ('202605290001'),('20260529100000'),('20260529123000'),('20260529140000'),('20261001120000'),('20261001120100'),
  ('20261002120000'),('20261024011809'),('20261024012624'),('20261024092246')
)
select coalesce(m.version, r.version) as version, m.name,
       case when m.version is null then 'LOCAL ONLY (would be applied by db push!)'
            when r.version is null then 'production only (no file in repo)'
            else 'ok' end as state
from supabase_migrations.schema_migrations m
full join repo r on r.version = m.version
order by 1;
