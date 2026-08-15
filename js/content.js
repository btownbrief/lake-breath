// Lake Breath — words. Kind-note presets, science plaques, field notes.
// All content lives here so tone edits never touch logic.

// The kind-notes wall: tap to send one of these to the town. Curated on
// purpose — freeform text and photos arrive once the approve-to-reveal
// queue exists (see README). Ids are stable; the SQL validates against
// this count, so APPEND ONLY — never renumber or delete.
export const NOTE_PRESETS = [
  { id: 1, text: 'Sending good vibes across the lake', emoji: '🌊' },
  { id: 2, text: 'Beautiful day out there — hope you get outside', emoji: '☀️' },
  { id: 3, text: 'Proud of you for showing up today', emoji: '🌱' },
  { id: 4, text: 'Deep breath, neighbor. We’ve got this', emoji: '🫶' },
  { id: 5, text: 'The lake says hi', emoji: '👋' },
  { id: 6, text: 'Hope your evening is quiet and kind', emoji: '🌙' },
  { id: 7, text: 'You made space for yourself today. Nice', emoji: '🧡' },
  { id: 8, text: 'Somebody in Burlington is rooting for you', emoji: '📣' },
  { id: 9, text: 'May your week be gentle', emoji: '🍂' },
  { id: 10, text: 'Catch the sunset tonight if you can', emoji: '🌅' },
  { id: 11, text: 'Peace from the Old North End', emoji: '🕊️' },
  { id: 12, text: 'Peace from the South End', emoji: '🕊️' },
  { id: 13, text: 'Peace from Downtown', emoji: '🕊️' },
  { id: 14, text: 'Peace from the New North End', emoji: '🕊️' },
  { id: 15, text: 'One breath at a time', emoji: '🌬️' },
  { id: 16, text: 'Take the long way home today', emoji: '🚲' },
];

export function presetById(id) {
  return NOTE_PRESETS.find((p) => p.id === id) || null;
}

// Science plaques: one honest sentence under the session-end state. They
// rotate in order, then stop auto-showing (the Bench stays browsable).
export const PLAQUES = [
  'Heart rate often slows during exhalation — a comfortable longer exhale can make slow breathing feel settling. Effects vary.',
  'Five minutes a day is the dose with real trial evidence behind it. The benefits build over weeks, not minutes.',
  'Slow breathing reliably calms the body’s acute stress spike — heart rate, felt anxiety, stress enzymes. It’s a dimmer, not an off switch.',
  'In a 400-person trial, a fake breathing technique worked nearly as well as the “right” one. The ritual carries real weight. That’s not a flaw — expectation is part of how calm works.',
  'The famous “vagus nerve activation” is more slogan than mechanism. What’s solid: slow breathing changes your heart rhythm and blood pressure while you do it.',
  'Feeling lightheaded means too much air, not too little. Go smaller and slower — never force it.',
  'Honest effect sizes here are modest. What makes practice matter is showing up on more days, which is exactly what your maple is counting.',
  'People who anchor practice to an existing routine — after coffee, after brushing teeth — keep it far longer than people who rely on willpower.',
  'Breathing in unison with other people measurably increases feelings of connection. That part of tonight’s 8:02 is not a placebo.',
  'For some people, focusing on the breath backfires — that’s common and real. The Front Porch practice is here for exactly that.',
];

// Field Notes: the teaching page. Short, calibrated, no hype.
export const FIELD_NOTES = [
  {
    title: 'What this practice actually does',
    body: 'Slow, exhale-weighted breathing at about six breaths a minute reliably blunts the body’s acute stress response — heart rate, self-reported anxiety, and stress-linked enzymes stay closer to baseline when something hard is happening. That result comes from randomized trials, including one where students breathed like this before a mock job interview. What it doesn’t do is transform your baseline after one session. Trial evidence says benefits accumulate over about four weeks of short daily practice.',
  },
  {
    title: 'Why the exhale is the star',
    body: 'Your heart genuinely speeds up a little on each inhale and slows on each exhale — that’s a real, measurable rhythm called respiratory sinus arrhythmia. Weighting the exhale (four seconds in, six out) means more of each minute is spent in the slowing half. Studies comparing ratios found longer exhales feel more relaxing, though the biggest factor is simply the slow overall pace.',
  },
  {
    title: 'The vagus nerve, honestly',
    body: 'You’ll hear that slow breathing “activates the vagus nerve.” The truth is messier: the evidence mostly shows breathing changes heart-rate variability while you practice, and that measure is heavily shaped by the breathing itself — so citing it as proof of deep nervous-system change is partly circular. Neurophysiologists have pushed back on the slogan. What survives scrutiny: the calm is real, the blood-pressure effects during practice are real, and the grand unified vagus story is oversold.',
  },
  {
    title: 'The placebo finding we love',
    body: 'The largest placebo-controlled breathwork trial to date gave 400 people either coherent breathing at the “magic” slow rate or a convincing fake at a normal rate. Both groups improved; neither beat the other. Some would hide that finding. We think it’s the most useful one on this page: ritual, expectation, and taking five deliberate minutes are active ingredients. Interestingly, research on “open-label placebos” shows that knowing this doesn’t break the effect. So now you know — and it should still work.',
  },
  {
    title: 'If breathing exercises feel bad',
    body: 'Somewhere between one in ten and one in four people find breath-focus uncomfortable — lightheadedness, air hunger, or anxiety about the breath itself. That’s not a personal failing; it’s common enough to have its own research literature. Two fixes: breathe smaller (lightheadedness = too much air, not too little), or switch to the Front Porch practice, which anchors attention outside the body — sounds, sights, the feeling of the ground. If you have a history of panic attacks or trauma, eyes-open external practices are a recommended starting point.',
  },
  {
    title: 'Why the 8:02 exists',
    body: 'Doing things in unison — singing, rowing, moving, breathing — measurably increases feelings of closeness and cooperation between people. It’s one of the most replicated findings in social psychology. The effects of a small shared ritual fade after about a week, which is why the 8:02 happens every evening, not once a month. Six minutes, six breaths a minute, the whole town on the same inhale.',
  },
  {
    title: 'Why the maple, not a streak',
    body: 'Streak counters work until they break — then the research shows people don’t just miss a day, they quit entirely. Habit science says a missed day has no measurable effect on habit formation, so a counter that punishes one is lying to you. Your maple only grows. It reaches full canopy around day 66 of practice because that’s the honest median time for a new habit to become automatic — not the 21 days the internet promises.',
  },
  {
    title: 'What we’ll never add',
    body: 'No ranked leaderboard (turning self-care into competition measurably backfires, hardest on anxious people). No guilt notifications. No streak flames. No “your free trial is ending.” No binaural beats sold as science. This is a tool Stephen built for himself and shares with the town. If a mechanic would make a stressed person feel worse at 11pm, it doesn’t ship.',
  },
];

// Grounding steps live in engine.js TECHNIQUES.porch; this is the intro.
export const PORCH_INTRO =
  'Eyes open. No breath counting. This one anchors you to the world instead — best on a porch, a stoop, a bench, or by a window.';

export const SAFETY_LINE =
  'Keep the breath easy — never force it. If you feel lightheaded, panicky, or uncomfortable, stop and breathe normally. This is a relaxation practice, not medical treatment.';
