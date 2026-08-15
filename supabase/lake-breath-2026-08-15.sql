-- LAKE BREATH — presence, the kind-notes wall, and the town's month.
-- Paste this WHOLE file into the Supabase SQL Editor (same btown-games
-- project as the scores leaderboard + game rooms) and click Run. Safe to
-- re-run. Until it's run, the app works fine and simply hides presence,
-- the wall, and the town total (the rooms 'not_ready' philosophy).
--
-- Three small pieces:
--   1. lb_presence — who is breathing right now. Ids rotate daily on the
--      client (a hash of player-id + NY date), so rows carry no durable
--      identity. One RPC (lb_beat) both heartbeats and returns the count
--      of OTHERS; lb_look reads without registering; lb_leave is the
--      polite exit. Sweeping rides along on writes — zero maintenance.
--   2. lb_notes — the kind-notes wall. Launch content is preset-only:
--      the client sends a preset id, the server checks the range and a
--      2-hour per-neighbor rate limit, and the note is live. A free-text
--      column exists but anything with text inserts approved=false —
--      that's the future approve-to-reveal queue, nothing reads it yet.
--   3. lb_town_seconds — Burlington's quiet minutes this month, summed
--      from the existing lake-breath leaderboard rows (each player's
--      score is their cumulative completed seconds this NY month).
--      Per-player cap of 4h/day-so-far keeps one prankster from
--      finishing the maple in an afternoon.
--
-- Security model matches the fleet: RLS locks tables completely; the
-- public anon key only moves through the security-definer functions.
--
-- Honest threat model: like every arcade metric, these are SOFT numbers.
-- The anon key is public by design, so a determined prankster can mint
-- identities and inflate presence or town minutes. The per-player cap,
-- rate limits, and preset validation stop casual mischief; they do not
-- stop Sybils. That's an accepted tradeoff for a friendly-town product —
-- never present these numbers as integrity-protected.

-- ---------------------------------------------------------------- tables

create table if not exists public.lb_presence (
  app text not null check (app ~ '^[a-z0-9-]{1,40}$'),
  pid text not null check (pid ~ '^[a-z0-9]{1,16}$'),
  last_seen timestamptz not null default now(),
  primary key (app, pid)
);

create index if not exists lb_presence_seen
  on public.lb_presence (app, last_seen);
-- the opportunistic sweep deletes by age alone, so it needs its own index
create index if not exists lb_presence_stale
  on public.lb_presence (last_seen);

alter table public.lb_presence enable row level security;
revoke all on table public.lb_presence from anon, authenticated;

create table if not exists public.lb_notes (
  id uuid primary key default gen_random_uuid(),
  app text not null check (app ~ '^[a-z0-9-]{1,40}$'),
  pid text not null check (pid ~ '^[a-z0-9]{1,16}$'),
  preset int,                      -- curated line id (see js/content.js)
  body text check (char_length(body) <= 280),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists lb_notes_wall
  on public.lb_notes (app, approved, created_at desc);
-- the per-neighbor rate check and the age sweep each want their own path
create index if not exists lb_notes_rate
  on public.lb_notes (app, pid, created_at desc);
create index if not exists lb_notes_stale
  on public.lb_notes (created_at);

alter table public.lb_notes enable row level security;
revoke all on table public.lb_notes from anon, authenticated;

-- The highest preset id the server will accept. Bump when js/content.js
-- appends new lines (append-only over there — ids are stable forever).
create or replace function public.lb_note_preset_max() returns int
language sql immutable as $$ select 16; $$;

-- -------------------------------------------------------------- presence

-- Heartbeat + count in one round trip. Returns how many OTHERS were seen
-- in the last 75 seconds (heartbeat cadence is ~30s, so one missed beat
-- doesn't flicker anyone away). Sweeps opportunistically ~2% of calls.
create or replace function public.lb_beat(p_app text, p_pid text)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if random() < 0.02 then
    delete from lb_presence where last_seen < now() - interval '10 minutes';
  end if;
  insert into lb_presence (app, pid, last_seen)
  values (p_app, p_pid, now())
  on conflict (app, pid) do update set last_seen = now();
  select count(*) into n from lb_presence
    where app = p_app and pid <> p_pid
      and last_seen > now() - interval '75 seconds';
  return n;
end $$;

-- Count without registering (the front door peeks, only sessions beat).
create or replace function public.lb_look(p_app text)
returns int
language sql security definer set search_path = public as $$
  select count(*)::int from lb_presence
  where app = p_app and last_seen > now() - interval '75 seconds';
$$;

create or replace function public.lb_leave(p_app text, p_pid text)
returns void
language sql security definer set search_path = public as $$
  delete from lb_presence where app = p_app and pid = p_pid;
$$;

-- ------------------------------------------------------------- the wall

-- Recent approved notes, newest first, capped small. Returns preset id +
-- body (body only ever non-null once the moderation queue exists).
create or replace function public.lb_wall(p_app text)
returns table (preset int, body text, at timestamptz)
language sql security definer set search_path = public as $$
  select n.preset, n.body, n.created_at
  from lb_notes n
  where n.app = p_app and n.approved
    and n.created_at > now() - interval '48 hours'
  order by n.created_at desc
  limit 40;
$$;

-- Send a curated kind note. Preset-only goes live instantly; the range
-- check is the content moderation. One note per neighbor per 2 hours.
create or replace function public.lb_send_note(p_app text, p_pid text, p_preset int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_preset is null or p_preset < 1 or p_preset > lb_note_preset_max() then
    raise exception 'bad_preset';
  end if;
  -- serialize per (app,pid) so two racing requests can't both pass the
  -- rate check before either inserts
  perform pg_advisory_xact_lock(hashtext(p_app || '|' || p_pid));
  if exists (select 1 from lb_notes
             where app = p_app and pid = p_pid
               and created_at > now() - interval '2 hours') then
    raise exception 'slow_down';
  end if;
  -- keep the table tiny: the wall only ever reads 48h back
  delete from lb_notes where created_at < now() - interval '7 days';
  insert into lb_notes (app, pid, preset, approved)
  values (p_app, p_pid, p_preset, true);
end $$;

-- ------------------------------------------------------ the town's month

-- Burlington's completed seconds this NY month, from the existing scores
-- table (game = 'lake-breath', score = that player's cumulative seconds,
-- month_key already America/New_York — same bucketing the whole arcade
-- uses). least() caps any single player at 4 hours per day elapsed.
create or replace function public.lb_town_seconds(p_game text)
returns bigint
language sql security definer set search_path = public as $$
  select coalesce(sum(least(s.score::bigint,
           14400 * extract(day from (now() at time zone 'America/New_York'))::bigint)), 0)
  from scores s
  where s.game = p_game
    and s.month_key = to_char(now() at time zone 'America/New_York', 'YYYY-MM');
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.lb_beat(text, text) from public;
revoke all on function public.lb_look(text) from public;
revoke all on function public.lb_leave(text, text) from public;
revoke all on function public.lb_wall(text) from public;
revoke all on function public.lb_send_note(text, text, int) from public;
revoke all on function public.lb_town_seconds(text) from public;
grant execute on function public.lb_beat(text, text) to anon;
grant execute on function public.lb_look(text) to anon;
grant execute on function public.lb_leave(text, text) to anon;
grant execute on function public.lb_wall(text) to anon;
grant execute on function public.lb_send_note(text, text, int) to anon;
grant execute on function public.lb_town_seconds(text) to anon;
