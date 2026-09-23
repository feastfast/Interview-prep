import * as store from "../store.js";
import { esc, md, plural, $, $$ } from "../util.js";
import { cardState, dayNum } from "../srs.js";
import * as P from "../plan.js";
import { record, undo, openLogModal } from "./plan.js";
import { icon, ring, hue } from "../ui.js";

const inline = s => md(s).replace(/^<p>|<\/p>$/g, "");
const todayISO = () => P.iso(new Date());
const TABS = [["cards", "Cards", "cards"], ["quiz", "Quizzes", "quiz"], ["problems", "Problems", "code"]];
let justTicked = null;

/* A subject is a plan topic (Heap, Stack, ...) or any other deck that has cards / quizzes (SQL, later OS, DBMS...).
   Cards and quiz questions belong to a subject through their deck id, which equals the plan topic id. */
export function subjects(D) {
  const list = D.plan.topics.map(t => ({ id: t.id, label: t.label, blurb: t.blurb, plan: true }));
  const seen = new Set(list.map(x => x.id));
  for (const d of [].concat(D.cards.decks || [], D.quiz.decks || [])) if (!seen.has(d.id)) { seen.add(d.id); list.push({ id: d.id, label: d.label, blurb: "", plan: false }); }
  return list;
}
const cardsOf = (D, id) => D.cards.cards.filter(c => c.d === id);
const questionsOf = (D, id) => D.quiz.questions.filter(q => q.d === id);

export function cardStats(D, id) {
  const s = store.get();
  const st = { total: 0, fresh: 0, known: 0, learning: 0 };
  for (const c of cardsOf(D, id)) {
    st.total++;
    const k = cardState(s.cards[c.id]);
    if (k === "new") st.fresh++; else if (k === "known") st.known++; else st.learning++;
  }
  return st;
}
function quizStats(D, id) {
  const s = store.get();
  let n = 0, seen = 0, right = 0, wrong = 0, mistakes = 0;
  for (const q of questionsOf(D, id)) {
    n++; const x = s.quiz[q.id];
    if (x) { seen++; right += x.c; wrong += x.w; if (x.last === 0) mistakes++; }
  }
  return { n, seen, mistakes, acc: right + wrong ? Math.round(100 * right / (right + wrong)) : null };
}
function problemStats(D, id) {
  const pools = P.buildPools(D.plan, D.problems.problems);
  return P.topicStats(pools[id] || [], store.get().probs, dayNum());
}

export function render(el, r, ctx) {
  const id = r.parts[1];
  if (!id) return overview(el, ctx);
  const sub = subjects(ctx.D).find(x => x.id === id);
  if (!sub) { el.innerHTML = '<div class="empty">' + icon("alert", 28) + '<b>Unknown topic</b><a class="btn" href="#/topics">All topics</a></div>'; return; }
  return topicPage(el, sub, r.parts[2], ctx);
}

/* ------------------------------------------------------------------ tiles */
const pct = (a, b) => (b ? Math.round(100 * a / b) : 0);
export function topicTile(D, sub) {
  const c = cardStats(D, sub.id), q = quizStats(D, sub.id), p = sub.plan ? problemStats(D, sub.id) : null;
  const empty = !c.total && !q.n;
  const meta = [c.total ? plural(c.total, "card") : null, q.n ? plural(q.n, "question") : null, p ? p.total + " problems" : null].filter(Boolean).join(" · ");
  const bar = (label, a, b) => '<div><span>' + label + '</span><div class="bar tint"><i style="width:' + pct(a, b) + '%"></i></div><em>' + pct(a, b) + "%</em></div>";
  return '<a class="ttile hued' + (empty ? " dim" : "") + '" href="#/topics/' + sub.id + '" style="--h:' + hue(sub.id) + '">' +
    '<div class="ttile-t"><span class="tdot"></span><b>' + esc(sub.label) + '</b><span class="go">' + icon("arrow", 16) + "</span></div>" +
    '<div class="ttile-m">' + (meta || "Material coming soon") + "</div>" +
    '<div class="ttile-bars">' + (c.total ? bar("Cards", c.known, c.total) : "") + (p && p.total ? bar("Problems", p.solved, p.total) : "") + (!c.total && q.n ? bar("Quiz", q.acc || 0, 100) : "") + "</div></a>";
}

/* ------------------------------------------------------------------ all topics */
function overview(el, ctx) {
  const { D } = ctx;
  const all = subjects(D);
  let h = '<header class="page-h rise"><div><div class="eyebrow">Library</div><h1>Topics</h1><p class="lead" style="margin-bottom:0">Each topic keeps its own flashcards, quiz and problem list &mdash; nothing is mixed.</p></div></header>';
  h += '<div class="sec-h"><h2>Interview topics</h2><span class="tag">' + all.filter(s => s.plan).length + "</span></div>";
  h += '<div class="tgrid stagger">' + all.filter(s => s.plan).map(s => topicTile(D, s)).join("") + "</div>";
  const other = all.filter(s => !s.plan);
  if (other.length) h += '<div class="sec-h"><h2>Other subjects</h2><span class="tag">' + other.length + '</span></div><div class="tgrid stagger">' + other.map(s => topicTile(D, s)).join("") + "</div>";
  el.innerHTML = h;
}

/* ------------------------------------------------------------------ one topic */
const mini = (b, s) => "<div><b>" + b + "</b><span>" + s + "</span></div>";
function topicPage(el, sub, tabParam, ctx) {
  const { D } = ctx;
  const c = cardStats(D, sub.id), q = quizStats(D, sub.id), p = sub.plan ? problemStats(D, sub.id) : null;
  const avail = TABS.filter(([k]) => k !== "problems" || sub.plan);
  const counts = { cards: c.total, quiz: q.n, problems: p ? p.total : 0 };
  const tab = avail.some(([k]) => k === tabParam) ? tabParam : (c.total ? "cards" : q.n ? "quiz" : sub.plan ? "problems" : "cards");
  const h0 = hue(sub.id);
  let h = '<a class="backlink" href="#/topics">' + icon("back", 16) + "All topics</a>";
  h += '<header class="thead hued" style="--h:' + h0 + '"><div class="thead-t"><span class="tdot lg"></span><h1>' + esc(sub.label) + "</h1></div>" +
    (sub.blurb ? "<p>" + esc(sub.blurb) + "</p>" : "") + '<div class="thead-s">' +
    (c.total ? mini(c.known + "<small>/" + c.total + "</small>", "cards known") : "") +
    (q.n ? mini(q.acc == null ? "—" : q.acc + "<small>%</small>", "quiz accuracy") : "") +
    (p ? mini(p.solved + "<small>/" + p.total + "</small>", "problems solved") : "") + "</div></header>";
  h += '<nav class="seg">' + avail.map(([k, label, ic]) => '<a href="#/topics/' + sub.id + "/" + k + '"' + (k === tab ? ' class="on"' : "") + ">" +
    (k === tab ? '<span class="seg-ind"></span>' : "") + icon(ic, 16) + "<span>" + label + "</span><small>" + counts[k] + "</small></a>").join("") + "</nav>";
  el.innerHTML = h + '<div id="tab" class="hued" style="--h:' + h0 + '"></div>';
  const body = $("#tab", el);
  if (tab === "cards") cardsTab(body, D, sub, c);
  else if (tab === "quiz") quizTab(body, D, sub, q);
  else problemsTab(body, D, sub, ctx);
}

const emptyBox = what => '<div class="empty">' + icon("book", 28) + "<b>No " + what + " for this topic yet</b>They will appear here once the study material for it is made.</div>";

function search(placeholder) {
  return '<label class="findw">' + icon("search", 16) + '<input type="search" class="find" id="find" placeholder="' + placeholder + '" autocomplete="off"></label>';
}
function bindFind(el) {
  const inp = $("#find", el);
  if (!inp) return;
  inp.oninput = () => {
    const term = inp.value.trim().toLowerCase();
    $$(".irow", el).forEach(r => { r.hidden = !!term && !r.textContent.toLowerCase().includes(term); });
    $$(".igroup", el).forEach(g => { g.hidden = !$$(".irow", g).some(r => !r.hidden); });
  };
}
function groupBy(list, key) {
  const m = new Map();
  for (const x of list) { if (!m.has(x[key])) m.set(x[key], []); m.get(x[key]).push(x); }
  return m;
}

function cardsTab(el, D, sub, c) {
  const list = cardsOf(D, sub.id);
  if (!list.length) { el.innerHTML = emptyBox("flashcards"); return; }
  const s = store.get();
  const left = c.total - c.known, p = pct(c.known, c.total);
  let h = '<div class="tsum"><div class="tsum-l">' + ring(c.known / c.total, { size: 78, stroke: 8, label: p + "%", sub: "known" }) +
    "<div><b>" + plural(c.total, "card") + '</b><div class="small muted">' + c.known + " known · " + c.learning + " still learning · " + c.fresh + " new</div></div></div>" +
    '<div class="row"><a class="btn primary" href="#/cards/session?mode=all&decks=' + sub.id + '">' + icon("cards", 16) + "Study all " + c.total + "</a>" +
    (left && left < c.total ? '<a class="btn" href="#/cards/session?mode=todo&decks=' + sub.id + '">Only the ' + left + " I don’t know</a>" : "") + "</div></div>";
  h += search("Search these cards");
  for (const [topic, cards] of groupBy(list, "t")) {
    h += '<div class="igroup"><div class="ghead"><b>' + esc(topic) + '</b><a class="link small" href="#/cards/session?mode=all&decks=' + sub.id + "&topics=" + encodeURIComponent(topic) + '">Study these ' + cards.length + " " + icon("arrow", 13) + "</a></div>";
    for (const card of cards) {
      const k = cardState(s.cards[card.id]);
      const chip = k === "new" ? '<span class="tag">new</span>' : k === "known" ? '<span class="tag ok">' + icon("check", 11) + "known</span>" : '<span class="tag bad">learning</span>';
      h += '<details class="irow"><summary><span class="stext">' + inline(card.f) + "</span>" + chip + '</summary><div class="ibody">' + md(card.b) + "</div></details>";
    }
    h += "</div>";
  }
  el.innerHTML = h;
  bindFind(el);
}

function quizTab(el, D, sub, q) {
  const list = questionsOf(D, sub.id);
  if (!list.length) { el.innerHTML = emptyBox("quiz questions"); return; }
  const s = store.get();
  let h = '<div class="tsum"><div class="tsum-l">' + ring((q.acc || 0) / 100, { size: 78, stroke: 8, label: q.acc == null ? "—" : q.acc + "%", sub: "accuracy" }) +
    "<div><b>" + plural(q.n, "question") + '</b><div class="small muted">' + q.seen + " attempted" + (q.mistakes ? " · " + q.mistakes + " to review" : "") + "</div></div></div>" +
    '<div class="row"><a class="btn primary" href="#/quiz/session?n=10&decks=' + sub.id + '">' + icon("bolt", 16) + "Quick quiz · " + Math.min(10, q.n) + "</a>" +
    '<a class="btn" href="#/quiz/session?n=all&decks=' + sub.id + '">All ' + q.n + "</a>" +
    (q.mistakes ? '<a class="btn" href="#/quiz/session?n=all&mode=mistakes&decks=' + sub.id + '">Mistakes (' + q.mistakes + ")</a>" : "") + "</div></div>";
  h += search("Search these questions");
  for (const [topic, qs] of groupBy(list, "t")) {
    h += '<div class="igroup"><div class="ghead"><b>' + esc(topic) + '</b><a class="link small" href="#/quiz/session?n=all&decks=' + sub.id + "&topics=" + encodeURIComponent(topic) + '">Quiz on these ' + qs.length + " " + icon("arrow", 13) + "</a></div>";
    for (const qu of qs) {
      const x = s.quiz[qu.id];
      const chip = !x ? '<span class="tag">new</span>' : x.last === 0 ? '<span class="tag bad">missed</span>' : '<span class="tag ok">' + icon("check", 11) + "right</span>";
      h += '<details class="irow"><summary><span class="stext">' + inline(qu.q) + "</span>" + chip + '</summary><div class="ibody"><ul class="opts">' +
        qu.o.map((o, i) => '<li class="' + (i === qu.a ? "right" : "") + '">' + (i === qu.a ? icon("check", 13) : "") + "<span>" + inline(o) + "</span></li>").join("") + "</ul>" +
        '<div class="explain" style="margin-bottom:0">' + icon("sparkle", 16) + "<div>" + md(qu.x) + "</div></div></div></details>";
    }
    h += "</div>";
  }
  el.innerHTML = h;
  bindFind(el);
}

function problemsTab(el, D, sub, ctx) {
  const state = store.get();
  const pool = P.buildPools(D.plan, D.problems.problems)[sub.id] || [];
  if (!pool.length) { el.innerHTML = emptyBox("problems"); return; }
  const s = P.topicStats(pool, state.probs, dayNum());
  const cfg = P.contextFor(D, state, todayISO()).cfg;
  let h = '<div class="tsum"><div class="tsum-l">' + ring(s.solved / s.total, { size: 78, stroke: 8, label: s.solved + "/" + s.total, sub: "solved" }) +
    "<div><b>" + P.LEVELS[cfg.levels[sub.id] || 0] + '</b><div class="small muted">Tap a problem to open it on LeetCode, then tick it off here.' + (s.due ? " " + s.due + " due for a re-solve." : "") + "</div></div></div></div>";
  h += '<ul class="list">';
  for (const p of pool) {
    const st = state.probs[p.id];
    const solved = st && st.st !== "todo";
    h += '<li class="trow"><button class="tick' + (solved ? " on" : "") + (p.id === justTicked ? " pop" : "") + '" data-tick="' + esc(p.id) + '" data-solved="' + (solved ? 1 : 0) + '" aria-label="' + (solved ? "Mark as not solved" : "Mark as solved") + '">' + icon("check", 15) + "</button>" +
      '<a class="ptitle" href="' + esc(p.url) + '" target="_blank" rel="noopener"><b>' + esc(p.title) + '<span class="ext">' + icon("ext", 13) + '</span></b><span class="small muted">' + (p.lc ? esc(p.lc) : "") +
      (solved ? (p.lc ? " · " : "") + (st.st === "revisit" ? "revisit" : "solved " + st.n + "×") : "") + (p.premium ? " · Premium" : "") + '</span></a><span class="tag ' + p.diff + '">' + p.diff + "</span></li>";
  }
  el.innerHTML = h + "</ul>";
  justTicked = null;
  $$("[data-tick]", el).forEach(b => b.onclick = () => {
    const id = b.dataset.tick;
    if (b.dataset.solved === "1") {
      // only a completion recorded today can be undone quietly; an older one would lose its history, so ask first
      const p = store.get().probs[id];
      if (P.doneOn(p, todayISO())) undo(id);
      else if (confirm("Clear this problem's solved status and its re-solve schedule?")) store.commit(st => { st.probs[id] = { st: "todo", n: 0, d: dayNum(), t: Date.now(), c: 0, tries: 0, note: "" }; });
      else return;
    } else {
      record(id, "solved");
      justTicked = id;
      ctx.toast("Saved.");
      const p = pool.find(x => x.id === id);
      openLogModal(id, p ? p.title : id, ctx);
    }
    ctx.rerender();
  });
}
