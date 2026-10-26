-- =============================================================================
--  Global invariants after every concurrency race (C1–C9). Any partial
--  write, double payment, duplicate repayment or inconsistent state fails.
-- =============================================================================
\set ON_ERROR_STOP on
select tst.eq((select count(*)::text from (
    select sl.load_id from public.settlement_loads sl join public.settlements s on s.id = sl.settlement_id
     where sl.is_adjustment = false and sl.load_id is not null and s.status in ('approved', 'paid') and coalesce(s.is_estimate, false) = false
     group by sl.load_id having count(distinct s.id) > 1) x), '0',
  'invariant: no load is paid on two approved/paid settlements');
select tst.eq((select count(*)::text from public.loads l
    where l.id::text ~ '^c[6-9]a'
      and (lower(coalesce(l.status, '')) = 'settled') is distinct from exists (
           select 1 from public.settlement_loads sl join public.settlements s on s.id = sl.settlement_id
            where sl.load_id = l.id and sl.is_adjustment = false and s.status in ('approved', 'paid'))), '0',
  'invariant: every raced load is settled exactly when an approved/paid settlement pays it');
select tst.eq((select count(*)::text from public.driver_advances a
    where a.recovered_amount is distinct from coalesce((select sum(r.amount) from public.driver_advance_repayments r where r.advance_id = a.id), 0)
       or a.recovered_amount > a.amount
       or a.is_closed is distinct from (a.recovered_amount >= a.amount)), '0',
  'invariant: every advance balance equals its repayments, never over-recovered, closed flag exact');
select tst.eq((select count(*)::text from public.driver_advance_repayments r join public.settlements s on s.id = r.settlement_id
    where s.status not in ('approved', 'paid')), '0',
  'invariant: repayments exist only for approved/paid settlements');
select tst.eq((select count(*)::text from (select r.settlement_id, r.deduction_id from public.driver_advance_repayments r
    group by 1, 2 having count(*) > 1) x), '0',
  'invariant: no duplicate repayment for a deduction');
select tst.eq((select count(*)::text from public.settlements s
    where s.id::text ~ '^c[1-9]'
      and ((s.status in ('approved', 'paid') and (s.approved_at is null or s.approved_by is null))
        or (s.status = 'voided' and s.voided_at is null)
        or (s.status = 'draft' and (s.approved_at is not null or s.voided_at is not null)))), '0',
  'invariant: status timestamps match the status of every raced settlement');
select tst.eq((select count(*)::text from public.settlements s
    where s.id::text ~ '^c[6-9]' and (
          (s.status = 'approved' and (select count(*) from public.settlement_audit_events e where e.settlement_id = s.id and e.action = 'approved') <> 1)
       or (s.status = 'draft' and s.id::text ~ '^c[689]1' and exists (select 1 from public.settlement_audit_events e where e.settlement_id = s.id and e.action = 'approved'))
       or (s.status = 'voided' and (select count(*) from public.settlement_audit_events e where e.settlement_id = s.id and e.action = 'voided') <> 1))), '0',
  'invariant: audit rows match committed moves only (a refused approval left no audit row)');
