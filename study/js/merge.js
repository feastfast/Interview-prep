/* Pure merge of two progress states (used for cloud sync). Newer timestamp wins per entry, so
   reviews done on the phone and on the laptop both survive. */

export function emptyState() {
  return { v: 1, cards: {}, quiz: {}, probs: {}, log: {}, settings: { newPerDay: 15, t: 0 }, daily: { date: "", newSeen: 0 }, plan: { t: 0 }, weeks: {}, days: {} };
}

function mergeTimed(a = {}, b = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k];
    out[k] = !x ? y : !y ? x : ((y.t || 0) > (x.t || 0) ? y : x);
  }
  return out;
}

export function mergeStates(a, b) {
  a = a || emptyState(); b = b || emptyState();
  const log = {};
  for (const k of new Set([...Object.keys(a.log || {}), ...Object.keys(b.log || {})])) {
    const x = (a.log || {})[k] || {}, y = (b.log || {})[k] || {};
    log[k] = { cards: Math.max(x.cards || 0, y.cards || 0), quiz: Math.max(x.quiz || 0, y.quiz || 0), probs: Math.max(x.probs || 0, y.probs || 0), new: Math.max(x.new || 0, y.new || 0) };
  }
  const sa = a.settings || {}, sb = b.settings || {};
  const daily = (a.daily && b.daily && a.daily.date === b.daily.date)
    ? { date: a.daily.date, newSeen: Math.max(a.daily.newSeen || 0, b.daily.newSeen || 0) }
    : ((a.daily && a.daily.date || "") >= (b.daily && b.daily.date || "") ? a.daily : b.daily) || { date: "", newSeen: 0 };
  return {
    v: 1,
    cards: mergeTimed(a.cards, b.cards),
    quiz: mergeTimed(a.quiz, b.quiz),
    probs: mergeTimed(a.probs, b.probs),
    log,
    settings: (sb.t || 0) > (sa.t || 0) ? sb : sa,
    daily,
    plan: ((b.plan && b.plan.t) || 0) > ((a.plan && a.plan.t) || 0) ? b.plan : (a.plan || { t: 0 }),
    weeks: mergeTimed(a.weeks, b.weeks),
    days: mergeTimed(a.days, b.days),
  };
}

export function sameState(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
