// Lake Breath — network layer: presence, the kind-notes wall, and the
// town's monthly minutes. Same Supabase project + anon key as the whole
// arcade; every call degrades to null/[] so the app works fully offline
// or before the SQL file is installed (the rooms 'not_ready' philosophy).
//
// The leaderboard client (js/leaderboard.js, vendored fleet file) handles
// score submission separately; here we only add what's new.

import { presenceId } from './engine.js';

const SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co/';
const SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';
const APP = 'lake-breath';

async function rpc(fn, args) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  };
  // Match leaderboard.js: legacy JWT keys need the Bearer header, the new
  // sb_publishable_ keys must not send one.
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  const res = await fetch(`${SUPABASE_URL}rest/v1/rpc/${fn}`, {
    method: 'POST', headers, body: JSON.stringify(args),
  });
  if (!res.ok) {
    const err = new Error(`rpc ${fn} ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// not_ready (404) means the SQL isn't installed yet; remember and go quiet
// for the rest of the visit instead of hammering.
let ready = true;
function offline(e) {
  if (e && e.status === 404) ready = false;
  return null;
}

// ---- presence ---------------------------------------------------------

// When storage is blocked, every visitor must NOT collapse onto one shared
// id (they'd collide for presence and note rate limits) — fall back to a
// random per-page identity instead.
const EPHEMERAL = (() => {
  try { return crypto.randomUUID(); } catch { return `e${Math.random().toString(36).slice(2)}`; }
})();

function pid() {
  try {
    const player = localStorage.getItem('btown-player-id') || EPHEMERAL;
    return presenceId(player, Date.now());
  } catch {
    return presenceId(EPHEMERAL, Date.now());
  }
}

// One call does everything: registers/refreshes our heartbeat and returns
// how many OTHERS are live. Call every ~30s while a session runs.
export async function beat() {
  if (!ready || !navigator.onLine) return null;
  try {
    const n = await rpc('lb_beat', { p_app: APP, p_pid: pid() });
    return typeof n === 'number' ? n : null;
  } catch (e) { return offline(e); }
}

// A read-only look (front door): count without registering as present.
export async function lookAround() {
  if (!ready || !navigator.onLine) return null;
  try {
    const n = await rpc('lb_look', { p_app: APP });
    return typeof n === 'number' ? n : null;
  } catch (e) { return offline(e); }
}

export function leave() {
  if (!ready) return;
  try {
    const body = JSON.stringify({ p_app: APP, p_pid: pid() });
    navigator.sendBeacon?.(
      `${SUPABASE_URL}rest/v1/rpc/lb_leave?apikey=${SUPABASE_ANON_KEY}`,
      new Blob([body], { type: 'application/json' }),
    );
  } catch { /* fine */ }
}

// ---- the kind-notes wall ---------------------------------------------

// Recent approved notes, newest first: [{ preset, text, at }]
export async function fetchWall() {
  if (!ready || !navigator.onLine) return [];
  try {
    const rows = await rpc('lb_wall', { p_app: APP });
    return Array.isArray(rows) ? rows : [];
  } catch (e) { offline(e); return []; }
}

// Send a preset kind note. Server validates the preset id and rate-limits
// one note per neighbor per two hours. Returns true on success.
export async function sendNote(presetId) {
  if (!ready || !navigator.onLine) return false;
  try {
    await rpc('lb_send_note', { p_app: APP, p_pid: pid(), p_preset: presetId });
    return true;
  } catch (e) { offline(e); return false; }
}

// Send a note somebody wrote. The server trims, checks 3..280 characters,
// strips control characters, rate-limits one per neighbor per two hours,
// and stores it unapproved: a person reads it before the wall does.
export async function sendText(text) {
  if (!ready || !navigator.onLine) return false;
  const body = String(text || '').trim();
  if (body.length < 3 || body.length > 280) return false;
  try {
    await rpc('lb_send_text', { p_app: APP, p_pid: pid(), p_text: body });
    return true;
  } catch (e) { offline(e); return false; }
}

// After a note is sent, ask the note-check edge function to read it right
// away. Server-side it holds the Anthropic key and either approves the
// note onto the wall, leaves it for the human queue, or drops clear abuse.
// Returns 'approved' when the note is already live; anything else means
// "a neighbor will read it soon" stays true. Fails soft in every way: if
// the function isn't deployed yet, times out, or errors, the note simply
// waits for a person like before.
export async function checkNote() {
  if (!navigator.onLine) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${SUPABASE_URL}functions/v1/note-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: APP, pid: pid() }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const out = await res.json();
    return out && typeof out.status === 'string' ? out.status : null;
  } catch { return null; } finally { clearTimeout(t); }
}

// ---- moderation (mod.html only) ---------------------------------------

// The queue, for whoever holds the secret. Returns [] on any failure,
// including a wrong secret — mod.html says so in its own words.
export async function fetchPending(secret) {
  try {
    const rows = await rpc('lb_pending', { p_secret: String(secret || '') });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

// approve = true puts it on the wall; false deletes it outright.
export async function moderate(secret, id, approve) {
  try {
    await rpc('lb_moderate', { p_secret: String(secret || ''), p_id: id, p_approve: !!approve });
    return true;
  } catch { return false; }
}

// ---- score submission -------------------------------------------------

// The Community Exhale rides the existing leaderboard: each device submits
// its cumulative completed seconds this NY month. Monotonic, so the
// backend's best-per-month greatest() stores it correctly. We call the
// RPC directly rather than leaderboard.submitScore() because that helper
// requires an arcade display name — meditation shouldn't make you pick a
// gamer tag. If the browser already has an arcade name we pass it through;
// otherwise the row is quietly 'neighbor' (never displayed anywhere).
function storedId(key, make) {
  let v = localStorage.getItem(key);
  if (!v) { v = make(); localStorage.setItem(key, v); }
  return v;
}

export async function submitMonthSeconds(monthSec) {
  if (!navigator.onLine || !(monthSec > 0)) return false;
  try {
    const player = storedId('btown-player-id', () => crypto.randomUUID());
    const token = storedId('btown-player-token', () =>
      [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''));
    const name = localStorage.getItem('btown-player-name') || 'neighbor';
    await rpc('submit_score', {
      p_game: APP, p_player: player, p_token: token,
      p_name: name, p_score: Math.floor(monthSec),
    });
    return true;
  } catch { return false; }
}

// ---- the town's month ------------------------------------------------

// Total completed minutes across all of Burlington this NY month.
// Server-side it sums the lake-breath leaderboard scores (cumulative
// seconds per player, capped per player against pranksters) — so this
// needs no new writes, just a read.
export async function townMinutes() {
  if (!ready || !navigator.onLine) return null;
  try {
    const sec = await rpc('lb_town_seconds', { p_game: APP });
    return typeof sec === 'number' ? Math.round(sec / 60) : null;
  } catch (e) { return offline(e); }
}
