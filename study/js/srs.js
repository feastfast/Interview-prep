/* Day helpers, the flashcard state and the re-solve schedule for problems. */

export const DAY_MS = 86400000;
export const dayNum = (ms = Date.now()) => {
  const d = new Date(ms);                                  // local calendar day, not UTC
  return Math.floor((ms - d.getTimezoneOffset() * 60000) / DAY_MS);
};
export const dayToDate = n => new Date(n * DAY_MS + new Date().getTimezoneOffset() * 60000);
export const isoDay = (n = dayNum()) => { const d = dayToDate(n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

/* Flashcards have no schedule: a card is new, or known / still learning depending on how the last attempt went.
   Card record: { k: 1 = knew it, 0 = did not, n: times seen, w: times missed, t: last change (ms) }.
   Records written by the earlier scheduler have no k; they count as known once they reached a review interval. */
export const cardState = st => !st || !st.t ? "new" : st.k === 1 ? "known" : st.k === 0 ? "learning" : (st.i || 0) >= 1 ? "known" : "learning";

/* Spaced re-solve schedule for problems: 1, 3, 7, 14, 30, 60 days. */
export const PROBLEM_STEPS = [1, 3, 7, 14, 30, 60];
export function nextProblem(prev, outcome, today = dayNum(), now = Date.now()) {
  const p = Object.assign({ st: "todo", n: 0, d: today, t: 0, tries: 0, note: "" }, prev || {});
  if (outcome === "struggled") { p.n = Math.max(0, p.n - 1); p.st = "revisit"; p.d = today + 1; }
  else { p.n = Math.min(PROBLEM_STEPS.length, p.n + 1); p.st = "solved"; p.d = today + PROBLEM_STEPS[p.n - 1]; }
  p.t = now; p.c = now;                                 // t = last change (sync), c = when it was completed
  return p;
}
