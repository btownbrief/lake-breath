// Lake Breath: words. Kind-note presets, science plaques, field notes,
// the mantra, the first-run guide. All content lives here so tone edits
// never touch logic. House style: no em dashes in any of the copy below.
// Periods, commas and colons do the work.

// The kind-notes wall. People write their own notes now (see
// NOTE_EXAMPLES below); these presets stay for the notes already on the
// wall from the preset era, which still render by id. Ids are stable; the
// SQL validates against this count, so APPEND ONLY, never renumber or
// delete.
export const NOTE_PRESETS = [
  { id: 1, text: 'Sending good vibes across the lake', emoji: '🌊' },
  { id: 2, text: 'Beautiful day out there. Hope you get outside', emoji: '☀️' },
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

// The note box's placeholder, one a day. These are examples of the
// register, not options: nobody can send one by tapping it. A neighbor
// reads every note before the wall does.
export const NOTE_EXAMPLES = [
  'Beautiful day out there, hope you get outside',
  'Proud of whoever needed to hear it today',
  'The lake says hi',
  'May your week be gentle',
];

// The three phrases. One a day, chosen by the Burlington date, so the whole
// town gets the same one. No attribution, no explaining them on the home
// screen; they either land or they don't.
export const MANTRAS = ['Listen.', 'Choose again.', 'Devote.'];

// First run only, and re-openable from Field Notes. Short lines, in order:
// what the lake is, when the town gathers, what the practices are, what
// grows, what happens after. Then the three phrases.
export const GUIDE_STEPS = [
  'A living Lake Champlain. It follows Burlington’s real sky, season, and clock.',
  'Breathe anytime. At 8:02 each evening the whole town breathes together, and you can see how many neighbors are on the water with you.',
  'Six practices. Try Paddle: tap the water in your own slow rhythm, like strokes across the lake, and let your thoughts drift while your hands keep time. Or breathe, hold the phone steady, or just sit. Like a walk in the park: do the simple thing, and let your best thinking arrive. Keep voice memos nearby for the ideas that surface.',
  'Your maple grows on the shore with every day you show up. It never shrinks.',
  'After a sit, send a kind note to the town, and read what neighbors left for you.',
];
export const GUIDE_TITLE = 'Welcome to the lake';
export const GUIDE_BUTTON = 'Step onto the shore';

// Science plaques: one honest sentence under the session-end state. They
// rotate in order, then stop auto-showing (the Bench stays browsable).
export const PLAQUES = [
  'Heart rate often slows during exhalation, so a comfortable longer exhale can make slow breathing feel settling. Effects vary.',
  'Five minutes a day is the dose with real trial evidence behind it. The benefits build over weeks, not minutes.',
  'In a 400-person trial, a fake breathing technique worked nearly as well as the “right” one. The ritual carries real weight; expectation is part of how calm works.',
  'Feeling lightheaded means too much air, not too little. Go smaller and slower, and never force it.',
  'Breathing in unison with other people measurably increases feelings of connection. That part of tonight’s 8:02 is not a placebo.',
  'For some people, focusing on the breath backfires. That is common and real, and the Front Porch practice is here for exactly that.',
];

// Field Notes: the teaching page. Four notes, short and calibrated. The
// long version lived here for a while and nobody read it.
export const FIELD_NOTES = [
  {
    // the home screen's mantra line links straight here
    id: 'note-three-phrases',
    title: 'The three phrases',
    body: 'One of these sits under the greeting each day: Listen. Choose again. Devote. They are the three things this app keeps coming back to, because they are the three things worth coming back to. Listen: before anything else, notice what is actually here. The sound behind the sound, the thought behind the thought, the person in front of you. Most of what goes wrong starts with not listening. Choose again: you already chose once; that is how you got here. The gift is that you get to choose again, every breath, without needing the last choice to have been right. Begin again, but on purpose. Devote: attention, given steadily, becomes devotion. Whatever you give your minutes to is what your life is quietly becoming. Choose what deserves you, then keep showing up for it. They work in order. Listen first. Then choose again. Then devote yourself to the choice.',
  },
  {
    title: 'What this practice actually does',
    body: 'Slow, exhale-weighted breathing at about six breaths a minute reliably blunts the body’s acute stress response. Heart rate, self-reported anxiety, and stress-linked enzymes all stay closer to baseline while something hard is happening, and that comes from randomized trials. What it does not do is change your baseline in one sitting. The honest effect sizes are modest, and the benefits accumulate over about four weeks of short daily practice.',
  },
  {
    title: 'Why the exhale is the star',
    body: 'Your heart genuinely speeds up a little on each inhale and slows on each exhale, a real measurable rhythm. Weighting the exhale, four seconds in and six out, spends more of every minute in the slowing half. Studies comparing ratios found longer exhales feel more relaxing, though the slow overall pace matters most.',
  },
  {
    title: 'If breathing exercises feel bad',
    body: 'Somewhere between one in ten and one in four people find breath focus uncomfortable: lightheadedness, air hunger, or anxiety about the breath itself. That is common enough to have its own research literature, and it is not a personal failing. Two fixes. Breathe smaller, since lightheadedness means too much air rather than too little. Or switch to Front Porch, which anchors attention outside the body, which is also the recommended starting point after panic or trauma.',
  },
  {
    title: 'Why the maple, not a streak',
    body: 'Streak counters work until they break, and then the research shows people do not just miss a day, they quit. Habit science says one missed day has no measurable effect on habit formation, so a counter that punishes it is lying to you. Your maple only grows. It reaches full canopy around day 66, the honest median time for a habit to become automatic, not the 21 days the internet promises.',
  },
];

// Grounding steps live in engine.js TECHNIQUES.porch; this is the intro.
export const PORCH_INTRO =
  'Eyes open. No breath counting. This one anchors you to the world instead. Best on a porch, a stoop, a bench, or by a window.';

export const SAFETY_LINE =
  'Keep the breath easy and never force it. If you feel lightheaded, panicky, or uncomfortable, stop and breathe normally. This is a relaxation practice, not medical treatment.';
