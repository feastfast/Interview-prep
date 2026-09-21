import { emptyState, mergeStates, sameState } from "./merge.js";
import { dayNum, isoDay } from "./srs.js";

const KEY = "prep-study-v1";
let state = emptyState();
const subs = new Set();
let saveTimer = null;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = mergeStates(emptyState(), JSON.parse(raw));
  } catch (e) { /* private mode: run in memory */ }
  return state;
}
export const get = () => state;
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

/* Every change goes through here so it is saved locally and can be synced. */
export function commit(mutator, { silent = false } = {}) {
  mutator(state);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 150);
  subs.forEach(fn => fn(silent ? "silent" : "change"));
}
export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}
export function replace(next, why = "remote") {
  if (sameState(next, state)) return false;
  state = next;
  persist();
  subs.forEach(fn => fn(why));
  return true;
}
export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.cards) throw new Error("Not a study backup file");
  replace(mergeStates(state, parsed), "import");
}
export function exportJSON() { return JSON.stringify(state, null, 1); }
export function resetAll() { state = emptyState(); persist(); subs.forEach(fn => fn("reset")); }

/* Today's counters for streaks and the activity heat-map. */
export function bump(kind) {
  commit(s => {
    const k = isoDay();
    const e = s.log[k] || (s.log[k] = { cards: 0, quiz: 0, probs: 0, new: 0 });
    e[kind] = (e[kind] || 0) + 1;
  });
}
export function newSeenToday() {
  const k = isoDay();
  return state.daily.date === k ? state.daily.newSeen : 0;
}
export function noteNewCard() {
  commit(s => {
    const k = isoDay();
    if (s.daily.date !== k) s.daily = { date: k, newSeen: 0 };
    s.daily.newSeen += 1;
  });
}
export function streak() {
  let n = 0, d = dayNum();
  const active = day => { const e = state.log[isoDay(day)]; return e && (e.cards || e.quiz || e.probs); };
  if (!active(d)) d -= 1;              // today not studied yet: the streak is still alive until midnight
  while (active(d)) { n++; d--; }
  return n;
}
