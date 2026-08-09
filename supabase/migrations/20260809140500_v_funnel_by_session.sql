-- One row per session with a boolean per funnel stage, computed as "reached
-- this stage OR any later stage" rather than "fired this event".
--
-- This is not a stylistic choice. The real event stream is not monotonic:
-- hundreds of sessions fire form_start with no form_open, and dozens reach
-- payment_complete with no form_open. Counting raw events makes later stages
-- exceed earlier ones and inverts the drop-off chart.
--
-- Built from sessions LEFT JOIN events, not from events alone, so the ~900
-- sessions that fired no event at all still get a row with every stage false.
-- Dropping them would understate top-of-funnel.
create or replace view public.v_funnel_by_session
with (security_invoker = true) as
select
  s.id as session_id,
  s.client_id,
  s.product_id,
  (s.created_at at time zone 'Asia/Kolkata')::date as day_ist,
  coalesce(bool_or(e.event_type in (
    'page_load', 'form_open', 'form_start', 'form_submit', 'payment_open', 'payment_complete'
  )), false) as reached_page_load,
  coalesce(bool_or(e.event_type in (
    'form_open', 'form_start', 'form_submit', 'payment_open', 'payment_complete'
  )), false) as reached_form_open,
  coalesce(bool_or(e.event_type in (
    'form_start', 'form_submit', 'payment_open', 'payment_complete'
  )), false) as reached_form_start,
  coalesce(bool_or(e.event_type in (
    'form_submit', 'payment_open', 'payment_complete'
  )), false) as reached_form_submit,
  coalesce(bool_or(e.event_type in (
    'payment_open', 'payment_complete'
  )), false) as reached_payment_open,
  coalesce(bool_or(e.event_type = 'payment_complete'), false) as reached_payment_complete
from public.sessions s
left join public.events e on e.session_id = s.id
group by s.id, s.client_id, s.product_id, s.created_at;

grant select on public.v_funnel_by_session to anon, authenticated;
