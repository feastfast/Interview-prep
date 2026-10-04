/* Pure merge of two progress states (used for cloud sync). Newer timestamp wins per entry, so
   reviews done on the phone and on the laptop both survive. */

export function emptyState() {
  return { v: 1, cards: {}, quiz: {}, probs: {}, reads: {}, log: {}, settings: { newPerDay: 15, t: 0 }, daily: { date: "", newSeen: 0 }, plan: { t: 0 }, weeks: {}, days: {} };
}

function mergeTimed(a = {}, b = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k];
    out[k] = !x ? y : !y ? x : ((y.t || 0) > (x.t || 0) ? y : x);
  }
  return out;
}

/* Saved solutions: a problem record carries `versions`, each { id, c: created, t: last edit, label, time, space, code, notes,
   del? }. Records from before versions existed hold a single code/notes pair, which counts as version "v0". */
export function rawVersions(p) {
  if (!p) return [];
  if (Array.isArray(p.versions)) return p.versions;
  return (p.code || p.notes) ? [{ id: "v0", c: p.t || 0, t: p.t || 0, label: "", time: "", space: "", code: p.code || "", notes: p.notes || "" }] : [];
}
function unionVersions(a, b) {
  const byId = new Map();
  for (const v of [...a, ...b]) { const o = byId.get(v.id); if (!o || (v.t || 0) > (o.t || 0)) byId.set(v.id, v); }
  return [...byId.values()];
}
/* The newer problem record wins as before, but solution versions from both devices are kept (a deletion is a version with del). */
function mergeProbs(a = {}, b = {}) {
  const out = mergeTimed(a, b);
  for (const k of Object.keys(out)) {
    const va = rawVersions(a[k]), vb = rawVersions(b[k]);
    if (va.length || vb.length) out[k] = Object.assign({}, out[k], { versions: unionVersions(va, vb) });
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
    probs: mergeProbs(a.probs, b.probs),
    reads: mergeTimed(a.reads, b.reads),
    log,
    settings: (sb.t || 0) > (sa.t || 0) ? sb : sa,
    daily,
    plan: ((b.plan && b.plan.t) || 0) > ((a.plan && a.plan.t) || 0) ? b.plan : (a.plan || { t: 0 }),
    weeks: mergeTimed(a.weeks, b.weeks),
    days: mergeTimed(a.days, b.days),
  };
}

export function sameState(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
