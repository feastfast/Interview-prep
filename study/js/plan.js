/* Weekly study planner: pure logic (no DOM) so it can be unit-tested.

   Inputs: plan.json (topics + curated external lists), the in-app Python problems, the learner's plan settings and progress.
   Output: a rotating weekly topic plan (2 topics per study day) and a concrete list of problems for a given day.
   Everything is deterministic for the same inputs, so two devices compute the same plan. */

export const DIFF_RANK = { easy: 0, medium: 1, hard: 2 };
export const MINUTES = { easy: 20, medium: 35, hard: 55 };
export const RESOLVE_FACTOR = 0.6;                       // a re-solve takes ~60% of the first attempt
export const LEVELS = ["Not started", "Learning", "Comfortable"];

/* ---------------------------------------------------------------- dates (local calendar days, ISO strings) */
export const pad = n => String(n).padStart(2, "0");
export const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const weekday = s => { const w = parse(s).getDay(); return w === 0 ? 7 : w; };          // Mon=1 ... Sun=7
export const mondayOf = s => addDays(s, -(weekday(s) - 1));

/* ---------------------------------------------------------------- deterministic randomness */
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seedStr) {                           // mulberry32
  let a = hash(seedStr);
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ---------------------------------------------------------------- problem pools */
export const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ALIASES = { "arrays-hashing": "arrays", "arrays": "arrays", "heap-priority-queue": "heap", "priority-queue": "heap", "dp": "dynamic-programming" };
export const topicIdFor = label => { const s = slug(label); return ALIASES[s] || s; };

export const lcUrl = p => p.url || "https://leetcode.com/problems/" + p.slug + "/";
const lcNum = t => { const m = /(\d+)/.exec(String(t || "")); return m ? +m[1] : 0; };

/* A problem counts as done on `date` when it was completed (c, else last update t) on or after that day's start. */
export const doneOn = (p, dateISO) => !!p && p.st !== "todo" && (p.c !== undefined ? p.c : p.t || 0) >= parse(dateISO).setHours(0, 0, 0, 0);

/* Pool of problems per topic: curated external ones + every problem in problems.json whose topicLabel maps to the topic.
   Sorted easy -> hard, keeping the authored order inside a difficulty (so curated order is the learning order). */
export function buildPools(plan, pyProblems) {
  const byApp = Object.fromEntries(pyProblems.map(p => [p.id, p]));
  const pools = {};
  for (const t of plan.topics) pools[t.id] = [];
  const seen = {};                                        // topic id -> Set of problem ids
  const add = (tid, item) => {
    if (!pools[tid]) return;
    const s = seen[tid] || (seen[tid] = new Set());
    if (s.has(item.id)) return;
    s.add(item.id); pools[tid].push(Object.assign({ idx: pools[tid].length }, item));
  };
  const own = p => ({ id: p.id, kind: "lc", title: p.title, diff: p.diff, lc: p.lc || "", url: lcUrl(p), premium: !!p.premium });
  for (const t of plan.topics) for (const e of plan.lists[t.id] || []) {
    if (e.app) { if (byApp[e.app]) add(t.id, own(byApp[e.app])); }
    else add(t.id, { id: "lc-" + e.lc, kind: "lc", title: e.title, diff: e.diff, lc: "LC " + e.lc, url: lcUrl(e) });
  }
  for (const p of pyProblems) add(topicIdFor(p.topicLabel || p.topic), own(p));
  for (const tid of Object.keys(pools)) {                 // the same LeetCode number listed twice in one topic: keep the own entry
    const nums = new Set(pools[tid].filter(x => !x.id.startsWith("lc-")).map(x => lcNum(x.lc)).filter(Boolean));
    pools[tid] = pools[tid].filter(x => !(x.id.startsWith("lc-") && nums.has(lcNum(x.lc))));
  }
  for (const tid of Object.keys(pools)) pools[tid].sort((a, b) => (DIFF_RANK[a.diff] - DIFF_RANK[b.diff]) || (a.idx - b.idx));
  return pools;
}

/* ---------------------------------------------------------------- topic status and weights */
export function topicStats(pool, probs, today) {
  let solved = 0, revisit = 0, due = 0;
  for (const p of pool) {
    const s = probs[p.id];
    if (s && s.st !== "todo") { solved++; if (s.st === "revisit") revisit++; if (s.d <= today) due++; }
  }
  return { total: pool.length, solved, revisit, due, left: pool.length - solved };
}

export function weeksBetween(startISO, dateISO) { return Math.floor(diffDays(mondayOf(startISO), mondayOf(dateISO)) / 7); }
export function isReviewMode(cfg, dateISO) { return !!cfg.interview && diffDays(dateISO, cfg.interview) <= 14; }

/* Topics that may appear this week: unlocked by schedule (week number) or by the learner's own level. */
export function unlockedTopics(plan, cfg, weekIdx) {
  return plan.topics.filter(t => (cfg.levels[t.id] || 0) > 0 || weekIdx >= t.unlock);
}

export function topicWeight(topic, cfg, stats, review) {
  const level = cfg.levels[topic.id] || 0;
  if (stats.left === 0 && stats.due === 0 && stats.revisit === 0) return 0.05;               // nothing new to do
  const frac = stats.total ? stats.solved / stats.total : 0;
  if (review) return 0.5 + 2 * (1 - frac) + 0.5 * Math.min(3, stats.revisit + stats.due);       // final 2 weeks: weakest first
  const base = (level === 1 ? 1.35 : level === 2 ? 0.7 : 1) * (topic.weight || 1);
  const coverage = Math.max(0.15, 1.4 - 1.5 * frac);                                     // favour breadth: well-covered topics yield time
  const enough = frac >= 0.6 && level !== 1 ? 0.2 : 1;                                    // ~60% of a topic is "good enough" for now
  return base * coverage * enough + 0.4 * Math.min(3, stats.revisit);
}

/* ---------------------------------------------------------------- weekly topic rotation */
/* Returns { "1": [main, secondary], ... } keyed by ISO weekday (1 = Monday) for the study days. */
export function genWeek({ weekKey, weekIdx, plan, cfg, pools, probs, today, prevWeek, review }) {
  const rand = rng((cfg.seed || 1) + "|" + weekKey);
  const topics = unlockedTopics(plan, cfg, weekIdx);
  const w = {};
  for (const t of topics) w[t.id] = topicWeight(t, cfg, topicStats(pools[t.id], probs, today), review);
  const days = (cfg.days && cfg.days.length ? cfg.days : [1, 2, 3, 4, 5]).slice().sort((a, b) => a - b);
  const used = {}, out = {};
  let yesterday = [];
  for (const d of days) {
    const pair = [];
    for (let k = 0; k < 2; k++) {
      const cand = topics.filter(t => !pair.includes(t.id));
      if (!cand.length) break;
      const score = cand.map(t => {
        let s = w[t.id] / (1 + 0.8 * (used[t.id] || 0));                        // spread topics across the week
        if (prevWeek && prevWeek[d] && prevWeek[d].includes(t.id)) s *= 0.2;   // don't repeat last week's weekday slot
        if (yesterday.includes(t.id)) s *= 0.45;                               // avoid the same topic on consecutive days
        return Math.max(0.001, s);
      });
      let r = rand() * score.reduce((a, b) => a + b, 0), pick = cand[cand.length - 1];
      for (let i = 0; i < cand.length; i++) { r -= score[i]; if (r <= 0) { pick = cand[i]; break; } }
      pair.push(pick.id); used[pick.id] = (used[pick.id] || 0) + 1;
    }
    out[d] = pair; yesterday = pair;
  }
  return out;
}

/* ---------------------------------------------------------------- one day's problem list */
const isSolved = (probs, id) => { const s = probs[id]; return !!s && s.st !== "todo"; };

/* items: [{ id, kind: 'lc', topic, title, diff, lc, url, mins, slot: 'resolve'|'main'|'secondary'|'carry' }] */
export function genDay({ date, topics, cfg, pools, probs, carry = [], skipped = [], excludeIds = [] }) {
  const today = diffDays("1970-01-01", date);
  const budget = cfg.minutes || 90;
  const items = [];
  const take = new Set(excludeIds);
  const byId = {};
  for (const tid of Object.keys(pools)) for (const p of pools[tid]) if (!byId[p.id]) byId[p.id] = Object.assign({ topic: tid }, p);
  const mk = (p, slot, mins) => Object.assign({}, p, { slot, mins });
  let spent = 0;
  // 1) carried-over unfinished items
  for (const id of carry.slice(0, 1)) {
    const p = byId[id]; if (!p || isSolved(probs, id) || take.has(id) || skipped.includes(id)) continue;
    items.push(mk(p, "carry", MINUTES[p.diff])); take.add(id); spent += MINUTES[p.diff];
  }
  // 2) spaced re-solves that are due (most overdue first), at most ~30% of the budget and 2 items
  const dueList = Object.entries(probs).filter(([id, s]) => s.st !== "todo" && s.d <= today && byId[id] && !take.has(id))
    .sort((a, b) => a[1].d - b[1].d).map(([id]) => byId[id]);
  let resolveSpent = 0, nRes = 0;
  for (const p of dueList) {
    const m = Math.round(MINUTES[p.diff] * RESOLVE_FACTOR);
    if (nRes >= 2 || (nRes >= 1 && resolveSpent + m > budget * 0.3)) break;
    items.push(mk(p, "resolve", m)); take.add(p.id); resolveSpent += m; nRes++; spent += m;
  }
  // 3) new problems from the day's topics
  const next = tid => (pools[tid] || []).find(p => !isSolved(probs, p.id) && !take.has(p.id) && !skipped.includes(p.id));
  const slots = [["main", topics[0]], ["secondary", topics[1] || topics[0]]];
  const share = [0.55, 0.45];
  for (let s = 0; s < slots.length; s++) {
    const [slot, tid] = slots[s];
    if (!tid) continue;
    const allot = (budget - resolveSpent) * share[s];
    let used = 0, n = 0;
    for (;;) {
      const p = next(tid); if (!p) break;
      const m = MINUTES[p.diff];
      if (n > 0 && used + m > allot + 5) break;
      if (n >= 3) break;
      items.push(mk(Object.assign({}, p, { topic: tid }), slot, m)); take.add(p.id); used += m; n++; spent += m;
      if (used >= allot - 5) break;
    }
  }
  // 4) if the topics ran dry, top up from any unlocked topic with unsolved problems
  if (spent < budget * 0.6) {
    for (const tid of Object.keys(pools)) {
      const p = next(tid); if (!p) continue;
      const m = MINUTES[p.diff]; if (spent + m > budget + 10) continue;
      items.push(mk(Object.assign({}, p, { topic: tid }), "secondary", m)); take.add(p.id); spent += m;
      if (spent >= budget * 0.85) break;
    }
  }
  return { items, minutes: items.reduce((a, b) => a + b.mins, 0) };
}

export const defaultPlan = (todayISO) => ({
  t: 0, start: todayISO, interview: addDays(todayISO, 90), minutes: 90, days: [1, 2, 3, 4, 5], levels: {}, seed: 1 + Math.floor(Math.random() * 100000),
  cursor: todayISO, stash: [],
});

/* ---------------------------------------------------------------- schedule cursor (day-queue shifting) */
/* Completions count toward a list from the earlier of its slot date and today: a catch-up list accepts work
   done since its (past) slot, a pulled-forward list accepts work done today. Using the slot date alone would
   ignore today's work on an ahead-of-schedule list; ignoring dates would count re-solve items (already solved
   once) as done before they were actually re-solved. */
export const listSince = (cursor, todayISO) => (cursor < todayISO ? cursor : todayISO);

/* A day's schedule is "complete" once every item in it is done since `since`, or explicitly skipped --
   stashed items never entered rec.items in the first place, so they don't block completion. */
export function dayComplete(rec, probs, since) {
  if (!rec) return false;
  if (!rec.items.length) return true;
  const skipped = new Set(rec.skipped || []);
  return rec.items.every(i => skipped.has(i.id) || doneOn(probs[i.id], since));
}

/* First unsolved problem of a topic that is not already used (used for "skip / swap"). */
export function nextFor(pools, probs, tid, excluded) {
  return (pools[tid] || []).find(p => !isSolved(probs, p.id) && !excluded.includes(p.id)) || null;
}

/* Everything the UI needs to know about the plan for a date.
   `date` is the real calendar day (drives spaced re-solves and interview countdown); the schedule itself
   -- which topics are up, which week we're in -- follows `cfg.cursor`, a separate date that only advances
   when a day's list is actually finished, so an unfinished day's slot persists until it's done and a
   finished-early day pulls the next slot forward. */
export function contextFor(D, state, date) {
  const cfg = Object.assign(defaultPlan(date), state.plan && state.plan.t ? state.plan : {});
  const cursor = cfg.cursor || date;
  const pools = buildPools(D.plan, D.problems.problems);
  const byId = {};
  for (const tid of Object.keys(pools)) for (const p of pools[tid]) if (!byId[p.id]) byId[p.id] = Object.assign({ topic: tid }, p);
  const monday = mondayOf(cursor);
  return { plan: D.plan, cfg, pools, byId, monday, cursor, weekIdx: Math.max(0, weeksBetween(cfg.start || cursor, cursor)), review: isReviewMode(cfg, date), configured: !!(state.plan && state.plan.t) };
}
