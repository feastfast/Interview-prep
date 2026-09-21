import * as store from "../store.js";
import { esc, plural } from "../util.js";
import { dayNum, isoDay } from "../srs.js";
import * as P from "../plan.js";
import * as T from "./topics.js";

export function render(el, r, ctx) {
  const { D, counts } = ctx;
  const c = counts();
  const s = store.get();
  const log = s.log[isoDay()] || { cards: 0, quiz: 0, probs: 0 };
  const streak = store.streak();
  let h = "";
  h += '<div class="grid g3">' +
    '<div class="tile hl"><b>' + c.due + "</b><span>cards due</span></div>" +
    '<div class="tile"><b>' + c.newLeft + "</b><span>new today</span></div>" +
    '<div class="tile"><b>' + streak + "</b><span>day streak</span></div></div>";

  /* cards are reviewed per topic, never mixed: list the topics that have something waiting */
  const waiting = T.subjects(D).map(sub => ({ sub, st: T.cardStats(D, sub.id) })).filter(x => x.st.due > 0);
  h += "<h2>Flashcards waiting</h2>";
  if (waiting.length) h += '<ul class="list">' + waiting.map(({ sub, st }) =>
    '<li><a class="li" href="#/topics/' + sub.id + '/cards"><div class="t"><b>' + esc(sub.label) + "</b><small>" + plural(st.due, "card") + ' due</small></div><div class="r">Review &rsaquo;</div></a></li>').join("") + "</ul>";
  else h += '<p class="muted small">No cards are due. Open a topic from the Topics tab to learn new cards or take its quiz.</p>';

  h += planCard(D, s);
  const due = Object.entries(s.probs).filter(([id, p]) => D.known.has(id) && p.st !== "todo" && p.d <= dayNum()).sort((a, b) => a[1].d - b[1].d);
  h += "<h2>Re-solve today</h2>";
  if (!due.length) h += '<p class="muted small">No problems are scheduled for a re-solve yet. Tick a problem off in your plan and it will come back after 1, 3, 7, 14, 30 and 60 days.</p>';
  else {
    h += '<ul class="list">' + due.slice(0, 6).map(([id, p]) => {
      const meta = findProblem(D, id);
      if (!meta) return "";
      return '<li><a class="li" href="' + esc(meta.url) + '" target="_blank" rel="noopener"><div class="t"><b>' + esc(meta.title) + "</b><small>" + esc(meta.topicLabel || meta.topic) + " &middot; " + (p.st === "revisit" ? "struggled last time" : "solved " + p.n + "&times;") + '</small></div><div class="r">open &#8599;</div></a></li>';
    }).join("") + "</ul>";
  }

  h += "<h2>Today so far</h2><p class=\"muted small\">" + plural(log.cards || 0, "card") + " reviewed &middot; " + plural(log.quiz || 0, "quiz answer") + " &middot; " + plural(log.probs || 0, "problem") + " solved.</p>";
  h += '<p class="small muted">Tip: recall first, look second. Struggling to remember is what builds the memory &mdash; rating a card <b>Again</b> is a success, not a failure.</p>';
  el.innerHTML = h;
}

function planCard(D, s) {
  const date = P.iso(new Date());
  const pc = P.contextFor(D, s, date);
  if (!pc.configured) return '<h2>Weekly plan</h2><div class="card"><p class="small muted" style="margin:0 0 10px">Get a rotating LeetCode schedule built around your interview date.</p><a class="btn primary block" href="#/plan/setup">Set up my plan</a></div>';
  const rec = s.days[date];
  if (!rec) return '<h2>Weekly plan</h2><div class="card"><a class="btn primary block" href="#/plan">Open today&rsquo;s plan</a></div>';
  const done = rec.items.filter(i => P.doneOn(s.probs[i.id], date)).length;
  const mins = rec.items.reduce((a, b) => a + b.mins, 0);
  return '<h2>LeetCode today</h2><div class="card"><div class="row between"><div><b>' + done + " of " + rec.items.length + " problems done</b><div class=\"small muted\">about " + mins + " min &middot; " +
    rec.topics.map(t => esc((D.plan.topics.find(x => x.id === t) || { label: t }).label)).join(" + ") + '</div></div><a class="btn primary sm" href="#/plan">Open</a></div>' +
    '<div class="bar" style="margin-top:10px"><i style="width:' + (rec.items.length ? Math.round(100 * done / rec.items.length) : 0) + '%"></i></div></div>';
}

export function findProblem(D, id) {
  const pools = P.buildPools(D.plan, D.problems.problems);
  for (const tid of Object.keys(pools)) {
    const p = pools[tid].find(x => x.id === id);
    if (p) return { title: p.title, topic: tid, topicLabel: (D.plan.topics.find(t => t.id === tid) || {}).label, url: p.url };
  }
  return null;
}
