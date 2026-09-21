import * as store from "../store.js";
import { esc, plural } from "../util.js";
import { dayNum, isoDay } from "../srs.js";
import * as P from "../plan.js";

export function render(el, r, ctx) {
  const { D, counts } = ctx;
  const c = counts();
  const s = store.get();
  const log = s.log[isoDay()] || { cards: 0, quiz: 0, probs: 0 };
  const streak = store.streak();
  const mistakes = D.quiz.questions.filter(q => s.quiz[q.id] && s.quiz[q.id].last === 0).length;
  const total = c.due + c.newLeft;

  let h = "";
  h += '<div class="grid g3">' +
    '<div class="tile hl"><b>' + c.due + "</b><span>cards due</span></div>" +
    '<div class="tile"><b>' + c.newLeft + "</b><span>new today</span></div>" +
    '<div class="tile"><b>' + streak + "</b><span>day streak</span></div></div>";

  h += '<div class="card" style="margin-top:14px">';
  if (total > 0) {
    h += "<h3 style=\"margin-top:0\">Your review is ready</h3><p class=\"muted small\">" + plural(c.due, "card") + " due" + (c.newLeft ? " and " + c.newLeft + " new" : "") +
      ". Cards from different topics are mixed together on purpose &mdash; interleaving is harder now and sticks better later.</p>" +
      '<a class="btn primary block" href="#/cards/session?mode=today">Start review</a>';
  } else {
    h += "<h3 style=\"margin-top:0\">You're all caught up</h3><p class=\"muted small\">Nothing is due. You can still study ahead, or test yourself with a quiz.</p>" +
      '<a class="btn block" href="#/cards/session?mode=ahead">Study 15 cards ahead of schedule</a>';
  }
  h += "</div>";

  h += planCard(D, s);
  h += "<h2>Test yourself</h2><div class=\"grid g2\">" +
    '<a class="btn" href="#/quiz/session?n=10&decks=all">Mixed quiz &middot; 10 questions</a>' +
    '<a class="btn" href="#/quiz/session?n=10&mode=mistakes"' + (mistakes ? "" : ' style="opacity:.5;pointer-events:none"') + ">Review mistakes" + (mistakes ? " (" + mistakes + ")" : "") + "</a></div>";

  const due = Object.entries(s.probs).filter(([, p]) => p.st !== "todo" && p.d <= dayNum()).sort((a, b) => a[1].d - b[1].d);
  h += "<h2>Re-solve today</h2>";
  if (!due.length) h += '<p class="muted small">No problems are scheduled for a re-solve yet. Solve one in Practice and it will come back after 1, 3, 7, 14, 30 and 60 days.</p>';
  else {
    h += '<ul class="list">' + due.slice(0, 6).map(([id, p]) => {
      const meta = findProblem(D, id);
      if (!meta) return "";
      const href = meta.kind === "lc" ? meta.url : "#/practice/" + meta.kind + "/" + id;
      return '<li><a class="li" href="' + esc(href) + '"' + (meta.kind === "lc" ? ' target="_blank" rel="noopener"' : "") + '><div class="t"><b>' + esc(meta.title) + "</b><small>" + esc(meta.topicLabel || meta.topic) + " &middot; " + (p.st === "revisit" ? "struggled last time" : "solved " + p.n + "&times;") + '</small></div><div class="r">open</div></a></li>';
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
  const start = P.parse(date).setHours(0, 0, 0, 0);
  const done = rec.items.filter(i => { const p = s.probs[i.id]; return p && p.st !== "todo" && (p.t || 0) >= start; }).length;
  const mins = rec.items.reduce((a, b) => a + b.mins, 0);
  return '<h2>LeetCode today</h2><div class="card"><div class="row between"><div><b>' + done + " of " + rec.items.length + " problems done</b><div class=\"small muted\">about " + mins + " min &middot; " +
    rec.topics.map(t => esc((D.plan.topics.find(x => x.id === t) || { label: t }).label)).join(" + ") + '</div></div><a class="btn primary sm" href="#/plan">Open</a></div>' +
    '<div class="bar" style="margin-top:10px"><i style="width:' + (rec.items.length ? Math.round(100 * done / rec.items.length) : 0) + '%"></i></div></div>';
}

export function findProblem(D, id) {
  if (id.startsWith("lc-")) {
    const pools = P.buildPools(D.plan, D.py.problems);
    for (const tid of Object.keys(pools)) { const p = pools[tid].find(x => x.id === id); if (p) return { kind: "lc", title: p.title, topic: tid, topicLabel: (D.plan.topics.find(t => t.id === tid) || {}).label, url: p.url }; }
    return null;
  }
  const a = D.py.problems.find(p => p.id === id);
  if (a) return { kind: "py", title: a.title, topic: a.topic, topicLabel: a.topicLabel };
  const b = D.sql.problems.find(p => p.id === id);
  if (b) return { kind: "sql", title: b.title, topic: b.topic, topicLabel: b.topicLabel };
  return null;
}
