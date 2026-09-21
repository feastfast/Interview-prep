import * as store from "../store.js";
import { esc, plural } from "../util.js";
import { dayNum, isoDay } from "../srs.js";

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
      return '<li><a class="li" href="#/practice/' + meta.kind + "/" + id + '"><div class="t"><b>' + esc(meta.title) + "</b><small>" + esc(meta.topicLabel || meta.topic) + " &middot; " + (p.st === "revisit" ? "struggled last time" : "solved " + p.n + "&times;") + '</small></div><div class="r">open</div></a></li>';
    }).join("") + "</ul>";
  }

  h += "<h2>Today so far</h2><p class=\"muted small\">" + plural(log.cards || 0, "card") + " reviewed &middot; " + plural(log.quiz || 0, "quiz answer") + " &middot; " + plural(log.probs || 0, "problem") + " solved.</p>";
  h += '<p class="small muted">Tip: recall first, look second. Struggling to remember is what builds the memory &mdash; rating a card <b>Again</b> is a success, not a failure.</p>';
  el.innerHTML = h;
}

export function findProblem(D, id) {
  const a = D.py.problems.find(p => p.id === id);
  if (a) return { kind: "py", title: a.title, topic: a.topic, topicLabel: a.topicLabel };
  const b = D.sql.problems.find(p => p.id === id);
  if (b) return { kind: "sql", title: b.title, topic: b.topic, topicLabel: b.topicLabel };
  return null;
}
