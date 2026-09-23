import * as store from "../store.js";
import { esc, plural } from "../util.js";
import { dayNum, isoDay } from "../srs.js";
import * as P from "../plan.js";
import { icon, ring, hue } from "../ui.js";
import { subjects, topicTile } from "./topics.js";

export function render(el, r, ctx) {
  const { D } = ctx;
  const s = store.get();
  const log = s.log[isoDay()] || {};
  const now = new Date(), hr = now.getHours();
  const greet = hr < 5 ? "Still up" : hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const info = planInfo(D, s);

  let h = '<section class="hero rise"><div class="hero-main"><div class="eyebrow">' + esc(now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })) + "</div>" +
    "<h1>" + greet + '.</h1><p class="lead">' + info.lead + '</p><div class="row">' + info.cta + "</div></div>" +
    '<div class="hero-ring">' + ring(info.pct, { size: 148, stroke: 13, label: info.label, sub: info.sub }) + "</div></section>";

  h += '<div class="stats stagger">' + stat("flame", store.streak(), "day streak", "hot") + stat("cards", log.cards || 0, "cards today") +
    stat("quiz", log.quiz || 0, "quiz answers today") + stat("check", log.probs || 0, "problems today") + "</div>";

  const due = Object.entries(s.probs).filter(([id, p]) => D.known.has(id) && p.st !== "todo" && p.d <= dayNum()).sort((a, b) => a[1].d - b[1].d);
  h += '<div class="sec-h"><h2>Re-solve today</h2>' + (due.length ? '<span class="tag acc">' + due.length + " due</span>" : "") + "</div>";
  if (!due.length) h += '<div class="note">' + icon("sparkle", 16) + "<span>Nothing due for a re-solve. Problems you tick off come back after 1, 3, 7, 14, 30 and 60 days.</span></div>";
  else h += '<ul class="list stagger">' + due.slice(0, 6).map(([id, p]) => {
    const m = findProblem(D, id);
    if (!m) return "";
    return '<li><a class="li" href="' + esc(m.url) + '" target="_blank" rel="noopener"><span class="lidot hued" style="--h:' + m.hue + '"></span><div class="t"><b>' + esc(m.title) + "</b><small>" + esc(m.topicLabel || m.topic) + " · " +
      (p.st === "revisit" ? "struggled last time" : "solved " + p.n + "×") + '</small></div><div class="r">' + icon("ext", 15) + "</div></a></li>";
  }).join("") + "</ul>";

  const first = info.topics || [];
  const subs = subjects(D);
  const hasMaterial = x => D.cards.cards.some(c => c.d === x.id) || D.quiz.questions.some(q => q.d === x.id);
  const order = [...first.map(id => subs.find(x => x.id === id)).filter(Boolean), ...subs.filter(x => !first.includes(x.id))].filter(hasMaterial).slice(0, 6);
  h += '<div class="sec-h"><h2>Pick up a topic</h2><a class="link" href="#/topics">All topics ' + icon("arrow", 14) + "</a></div>";
  h += '<div class="tgrid stagger">' + order.map(x => topicTile(D, x)).join("") + "</div>";
  h += '<p class="tip">' + icon("bolt", 15) + "<span>Recall first, look second &mdash; struggling to remember is what builds the memory. Press <kbd>" + (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl") + " K</kbd> to jump anywhere.</span></p>";
  el.innerHTML = h;
}

function stat(ic, n, label, cls = "") {
  return '<div class="stat ' + cls + '"><span class="stat-ic">' + icon(ic, 16) + '</span><b><span data-count="' + n + '">' + n + "</span></b><span>" + label + "</span></div>";
}

function planInfo(D, s) {
  const date = P.iso(new Date());
  const pc = P.contextFor(D, s, date);
  const second = '<a class="btn lg" href="#/topics">Study a topic</a>';
  if (!pc.configured) return { pct: 0, label: "—", sub: "no plan yet", lead: "Build a rotating LeetCode schedule around your interview date, then work through it one day at a time.", cta: '<a class="btn primary lg" href="#/plan/setup">Set up my plan ' + icon("arrow", 16) + "</a>" + second };
  const rec = s.days[pc.cursor];
  if (!rec) return { pct: 0, label: "0", sub: "done", lead: "Today’s LeetCode list is ready to be built.", cta: '<a class="btn primary lg" href="#/plan">Open today’s plan ' + icon("arrow", 16) + "</a>" + second };
  const since = P.listSince(pc.cursor, date);
  const n = rec.items.length, done = rec.items.filter(i => P.doneOn(s.probs[i.id], since)).length, left = n - done;
  const labels = rec.topics.map(t => esc((D.plan.topics.find(x => x.id === t) || { label: t }).label)).join(" + ");
  return {
    topics: rec.topics, pct: n ? done / n : 0, label: done + "/" + n, sub: "problems",
    lead: left ? "<b>" + plural(left, "problem") + "</b> left on today’s list &middot; " + labels + "." : "Today’s list is done. The next slot is ready whenever you are.",
    cta: '<a class="btn primary lg" href="#/plan">' + (left ? "Continue plan" : "See what’s next") + " " + icon("arrow", 16) + "</a>" + second,
  };
}

export function findProblem(D, id) {
  const pools = P.buildPools(D.plan, D.problems.problems);
  for (const tid of Object.keys(pools)) {
    const p = pools[tid].find(x => x.id === id);
    if (p) return { title: p.title, topic: tid, hue: hue(tid), topicLabel: (D.plan.topics.find(t => t.id === tid) || {}).label, url: p.url };
  }
  return null;
}
