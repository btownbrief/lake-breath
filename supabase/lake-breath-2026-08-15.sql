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
--   2. lb_notes — the kind-notes wall. People write their OWN notes:
--      lb_send_text takes 3..280 characters, strips control characters,
--      rate-limits one per neighbor per 2 hours, and stores the note
--      UNAPPROVED. Nothing reaches the wall until a human approves it in
--      mod.html (lb_pending / lb_moderate, gated by a bcrypt hash in
--      lb_mod_hash).
--      lb_send_note, the old preset path, still works for the transition;
--      the client no longer calls it.
--
--      >>> BEFORE YOU RUN THIS: put a bcrypt HASH of your moderator
--      >>> secret into lb_mod_hash() below. Instructions are on the
--      >>> function. Until you do, the queue stays shut: the gate fails
--      >>> closed on the placeholder, so nobody gets in, including you.
--
--      OPTIONAL, for near-real-time notes: deploy the edge function in
--      supabase/functions/note-check/index.ts (deploy steps are at the
--      top of that file; it needs an ANTHROPIC_API_KEY secret). Claude
--      then approves clearly kind notes onto the wall within seconds and
--      leaves anything uncertain for you in mod.html. Without it, every
--      note simply waits for you, exactly as described above.
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

-- ------------------------------------------------------------ extensions

-- pgcrypto (crypt / gen_salt) gates the moderation queue. Supabase ships it
-- in the extensions schema; this is a no-op on a project that already has
-- it, which is every project in the fleet.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables

create table if not exists public.lb_presence (
  app text not null check (app ~ '^[a-z0-9-]{1,40}$'),
  pid text not null check (pid ~ '^[a-z0-9]{1,16}$'),
  last_seen timestamptz not null default now(),
  -- Glass at 8:02: each phone reports its own smoothed hand motion (0 =
  -- glass, 1 = churn) on every beat; the lake everyone sees is as calm as
  -- the town's hands. Averages only ever leave this table, never a row.
  churn real check (churn is null or (churn >= 0 and churn <= 1)),
  -- a neighbor just finished a sit: everyone sitting sees one ripple
  finished_at timestamptz,
  primary key (app, pid)
);
alter table public.lb_presence add column if not exists churn real
  check (churn is null or (churn >= 0 and churn <= 1));
alter table public.lb_presence add column if not exists finished_at timestamptz;

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
  created_at timestamptz not null default now(),
  -- when a human said yes. The wall's 48 hours run from HERE, so a note
  -- that waited a day in the queue still gets its full time on the wall,
  -- while created_at keeps meaning "when it was sent" for the rate limit.
  approved_at timestamptz
);

-- re-runnable on a table created before approved_at existed
alter table public.lb_notes add column if not exists approved_at timestamptz;

create index if not exists lb_notes_wall
  on public.lb_notes (app, approved, created_at desc);
create index if not exists lb_notes_wall_approved
  on public.lb_notes (app, approved, approved_at desc);
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
create or replace function public.lb_beat(p_app text, p_pid text, p_churn real default null)
returns json
language plpgsql security definer set search_path = public as $$
declare n int; calm real; fin int;
begin
  if random() < 0.02 then
    delete from lb_presence where last_seen < now() - interval '10 minutes';
  end if;
  insert into lb_presence (app, pid, last_seen, churn)
  values (p_app, p_pid, now(), least(1, greatest(0, p_churn)))
  on conflict (app, pid) do update
    set last_seen = now(), churn = coalesce(least(1, greatest(0, excluded.churn)), lb_presence.churn);
  select count(*), avg(1 - churn), count(*) filter (where finished_at > now() - interval '40 seconds')
    into n, calm, fin
    from lb_presence
    where app = p_app and pid <> p_pid
      and last_seen > now() - interval '75 seconds';
  -- n: how many others are live; calm: 0..1 average stillness of their
  -- hands (null until somebody reports); finished: others who ended a sit
  -- in the last beat or so
  return json_build_object('n', n, 'calm', calm, 'finished', fin);
end $$;

-- A finished sit leaves a mark for one beat so neighbors see the ripple.
create or replace function public.lb_finish(p_app text, p_pid text)
returns void
language sql security definer set search_path = public as $$
  update lb_presence set finished_at = now() where app = p_app and pid = p_pid;
$$;

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
  select n.preset, n.body, coalesce(n.approved_at, n.created_at)
  from lb_notes n
  where n.app = p_app and n.approved
    -- age from approval, falling back to created_at for the preset-era
    -- rows that went live without ever passing through the queue
    and coalesce(n.approved_at, n.created_at) > now() - interval '48 hours'
  order by coalesce(n.approved_at, n.created_at) desc
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
  insert into lb_notes (app, pid, preset, approved, approved_at)
  values (p_app, p_pid, p_preset, true, now());
end $$;

-- Send a note somebody wrote. Trimmed, length-checked, control characters
-- stripped, and stored approved=false: the wall shows nothing until a
-- human says so. Same 2-hour per-neighbor limit as the preset path.
create or replace function public.lb_send_text(p_app text, p_pid text, p_text text)
returns void
language plpgsql security definer set search_path = public as $$
declare clean text;
begin
  -- strip control characters (newlines and tabs included: the wall is one
  -- line per note), collapse runs of whitespace, then trim
  clean := btrim(regexp_replace(regexp_replace(coalesce(p_text, ''),
             '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
  if char_length(clean) < 3 or char_length(clean) > 280 then
    raise exception 'bad_text';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_app || '|' || p_pid));
  if exists (select 1 from lb_notes
             where app = p_app and pid = p_pid
               and created_at > now() - interval '2 hours') then
    raise exception 'slow_down';
  end if;
  delete from lb_notes where created_at < now() - interval '7 days';
  insert into lb_notes (app, pid, body, approved)
  values (p_app, p_pid, clean, false);
end $$;

-- ---------------------------------------------------------- moderation

-- EDIT THIS BEFORE RUNNING. The queue is gated by a moderator secret, and
-- what lives here is a bcrypt HASH of that secret, never the secret. The
-- plaintext exists only in your password manager and in the browser tab
-- you moderate from.
--
-- 1. Pick a long random string (a password manager's "generate" is perfect).
-- 2. Run this in the SQL editor, with your string in place of the example:
--
--      select extensions.crypt('your-secret', extensions.gen_salt('bf'));
--
-- 3. Paste the '$2a$...' result it prints between the quotes below, and
--    run this file.
--
-- To rotate the secret, repeat and re-run this one function. While the
-- placeholder is still here the gate FAILS CLOSED: no secret opens the
-- queue at all, which is the right way for a half-installed lock to fail.
create or replace function public.lb_mod_hash() returns text
language sql immutable as $$ select 'CHANGE-ME-PASTE-A-BCRYPT-HASH-HERE'::text; $$;

-- Never grant these to anon: the hash must not be readable, only
-- comparable inside the gate.
revoke all on function public.lb_mod_hash() from public, anon, authenticated;

-- The gate. bcrypt is deliberately slow, so guessing over the public RPC
-- costs real time per attempt instead of being a plain string compare.
create or replace function public.lb_mod_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_secret is not null
     and lb_mod_hash() like '$2%'   -- an unedited placeholder opens nothing
     and extensions.crypt(p_secret, lb_mod_hash()) = lb_mod_hash();
$$;

revoke all on function public.lb_mod_ok(text) from public, anon, authenticated;

-- The queue: notes waiting on a human, newest first.
create or replace function public.lb_pending(p_secret text)
returns table (id uuid, body text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not lb_mod_ok(p_secret) then
    raise exception 'bad_secret';
  end if;
  return query
    select n.id, n.body, n.created_at
    from lb_notes n
    where not n.approved and n.body is not null
    order by n.created_at desc
    limit 50;
end $$;

-- Approve puts it on the wall for 48 hours; the other way deletes it.
create or replace function public.lb_moderate(p_secret text, p_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not lb_mod_ok(p_secret) then
    raise exception 'bad_secret';
  end if;
  if p_approve then
    -- approved_at starts the note's 48 hours on the wall. created_at is
    -- left alone: it is when the note was SENT, and moving it would hand
    -- that neighbor a fresh two-hour rate-limit window as a side effect.
    update lb_notes set approved = true, approved_at = now() where id = p_id;
  else
    delete from lb_notes where id = p_id;
  end if;
end $$;

-- ------------------------------------------------------ the town's month

-- Burlington's completed seconds this NY month, from the existing scores
-- table (game = 'lake-breath', score = that player's cumulative seconds,
-- month already America/New_York — same bucketing the whole arcade
-- uses). least() caps any single player at 4 hours per day elapsed.
create or replace function public.lb_town_seconds(p_game text)
returns bigint
language sql security definer set search_path = public as $$
  select coalesce(sum(least(s.score::bigint,
           14400 * extract(day from (now() at time zone 'America/New_York'))::bigint)), 0)
  from scores s
  where s.game = p_game
    -- production's column is `month` (not month_key as the per-game schema.sql files say);
    -- left(...,7) works whether it holds 'YYYY-MM' text or a first-of-month date
    and left(s.month::text, 7) = to_char(now() at time zone 'America/New_York', 'YYYY-MM');
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.lb_beat(text, text, real) from public;
revoke all on function public.lb_finish(text, text) from public;
revoke all on function public.lb_look(text) from public;
revoke all on function public.lb_leave(text, text) from public;
revoke all on function public.lb_wall(text) from public;
revoke all on function public.lb_send_note(text, text, int) from public;
revoke all on function public.lb_send_text(text, text, text) from public;
revoke all on function public.lb_pending(text) from public;
revoke all on function public.lb_moderate(text, uuid, boolean) from public;
revoke all on function public.lb_town_seconds(text) from public;
grant execute on function public.lb_beat(text, text, real) to anon;
grant execute on function public.lb_finish(text, text) to anon;
grant execute on function public.lb_look(text) to anon;
grant execute on function public.lb_leave(text, text) to anon;
grant execute on function public.lb_wall(text) to anon;
grant execute on function public.lb_send_note(text, text, int) to anon;
grant execute on function public.lb_send_text(text, text, text) to anon;
-- the hashed secret is the gate on these two, not the grant
grant execute on function public.lb_pending(text) to anon;
grant execute on function public.lb_moderate(text, uuid, boolean) to anon;
grant execute on function public.lb_town_seconds(text) to anon;
