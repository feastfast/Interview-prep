/* Spaced repetition: an SM-2 style scheduler working in whole days.
   Card state: { e: ease, i: interval (days), r: successful reviews in a row, l: lapses, d: due day number, t: last change (ms) } */

export const DAY_MS = 86400000;
export const dayNum = (ms = Date.now()) => {
  const d = new Date(ms);                                  // local calendar day, not UTC
  return Math.floor((ms - d.getTimezoneOffset() * 60000) / DAY_MS);
};
export const dayToDate = n => new Date(n * DAY_MS + new Date().getTimezoneOffset() * 60000);
export const isoDay = (n = dayNum()) => { const d = dayToDate(n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

export const RATINGS = ["again", "hard", "good", "easy"];

export function fresh() { return { e: 2.5, i: 0, r: 0, l: 0, d: dayNum(), t: 0 }; }

/* Returns the next state for a rating (does not mutate). */
export function schedule(prev, rating, today = dayNum(), now = Date.now()) {
  const s = Object.assign({}, prev || fresh());
  if (rating === "again") {
    s.l += 1; s.r = 0; s.e = Math.max(1.3, s.e - 0.2); s.i = 0; s.d = today;
  } else if (rating === "hard") {
    s.e = Math.max(1.3, s.e - 0.15);
    s.i = Math.max(1, Math.round(Math.max(s.i, 1) * 1.2));
    s.d = today + s.i;
  } else if (rating === "good") {
    s.i = s.r === 0 ? 1 : s.r === 1 ? 3 : Math.round(s.i * s.e);
    s.r += 1; s.d = today + s.i;
  } else {                                                  // easy
    s.i = s.r === 0 ? 4 : Math.round(s.i * s.e * 1.3);
    s.r += 1; s.e += 0.15; s.d = today + s.i;
  }
  s.i = Math.min(s.i, 365);
  if (rating !== "again") s.d = today + s.i;
  s.t = now;
  return s;
}

/* Label for the button, e.g. "1d", "3d", "2w", "3mo". */
export function intervalLabel(prev, rating, today = dayNum()) {
  if (rating === "again") return "<1m";
  const n = schedule(prev, rating, today).i;
  if (n < 14) return n + "d";
  if (n < 60) return Math.round(n / 7) + "w";
  return Math.round(n / 30) + "mo";
}

export const isNew = st => !st || st.t === 0 || (st.r === 0 && st.l === 0 && st.i === 0 && !st.seen);
export const isDue = (st, today = dayNum()) => !!st && st.t > 0 && st.d <= today;
export const isMature = st => !!st && st.i >= 21;

/* Spaced re-solve schedule for problems: 1, 3, 7, 14, 30, 60 days. */
export const PROBLEM_STEPS = [1, 3, 7, 14, 30, 60];
export function nextProblem(prev, outcome, today = dayNum(), now = Date.now()) {
  const p = Object.assign({ st: "todo", n: 0, d: today, t: 0, tries: 0, note: "" }, prev || {});
  if (outcome === "struggled") { p.n = Math.max(0, p.n - 1); p.st = "revisit"; p.d = today + 1; }
  else { p.n = Math.min(PROBLEM_STEPS.length, p.n + 1); p.st = "solved"; p.d = today + PROBLEM_STEPS[p.n - 1]; }
  p.t = now;
  return p;
}
