import * as store from "../store.js";
import { esc, md, plural, $, $$ } from "../util.js";
import { cardState, dayNum } from "../srs.js";
import * as P from "../plan.js";
import { record, undo, openLogModal } from "./plan.js";

const inline = s => md(s).replace(/^<p>|<\/p>$/g, "");
const todayISO = () => P.iso(new Date());
const TABS = [["cards", "Cards"], ["quiz", "Quizzes"], ["problems", "Problems"]];

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
  if (!sub) { el.innerHTML = '<div class="empty"><b>Unknown topic</b><a class="btn" href="#/topics">All topics</a></div>'; return; }
  return topicPage(el, sub, r.parts[2], ctx);
}

/* ------------------------------------------------------------------ all topics */
function overview(el, ctx) {
  const { D } = ctx;
  const row = sub => {
    const c = cardStats(D, sub.id), q = quizStats(D, sub.id), p = sub.plan ? problemStats(D, sub.id) : null;
    const bits = [];
    bits.push(c.total ? plural(c.total, "card") + (c.known ? " (" + c.known + " known)" : "") : "no cards yet");
    bits.push(q.n ? plural(q.n, "question") : "no quiz yet");
    if (p) bits.push(p.solved + "/" + p.total + " problems");
    const empty = !c.total && !q.n;
    return '<li><a class="li" href="#/topics/' + sub.id + '" style="' + (empty ? "opacity:.6" : "") + '"><div class="t"><b>' + esc(sub.label) + "</b><small>" + bits.join(" &middot; ") + '</small></div><div class="r">' +
      "&rsaquo;</div></a></li>";
  };
  const all = subjects(D);
  let h = '<h2>Topics</h2><p class="muted small">Open a topic to study its flashcards, take its quiz, or work through its problems. Nothing is mixed between topics.</p>';
  h += '<h2>Interview topics</h2><ul class="list">' + all.filter(s => s.plan).map(row).join("") + "</ul>";
  const other = all.filter(s => !s.plan);
  if (other.length) h += "<h2>Other subjects</h2><ul class=\"list\">" + other.map(row).join("") + "</ul>";
  el.innerHTML = h;
}

/* ------------------------------------------------------------------ one topic */
function topicPage(el, sub, tabParam, ctx) {
  const { D } = ctx;
  const c = cardStats(D, sub.id), q = quizStats(D, sub.id), p = sub.plan ? problemStats(D, sub.id) : null;
  const avail = TABS.filter(([k]) => k !== "problems" || sub.plan);
  const counts = { cards: c.total, quiz: q.n, problems: p ? p.total : 0 };
  let tab = avail.some(([k]) => k === tabParam) ? tabParam : (c.total ? "cards" : q.n ? "quiz" : sub.plan ? "problems" : "cards");
  let h = '<a class="btn ghost sm" href="#/topics" style="margin-left:-8px">&larr; All topics</a><h2 style="margin-top:6px">' + esc(sub.label) + "</h2>" +
    (sub.blurb ? '<p class="muted small" style="margin-top:-6px">' + esc(sub.blurb) + "</p>" : "");
  h += '<div class="seg">' + avail.map(([k, label]) => '<a href="#/topics/' + sub.id + "/" + k + '" class="' + (k === tab ? "on" : "") + '">' + label + ' <small>' + counts[k] + "</small></a>").join("") + "</div>";
  el.innerHTML = h + '<div id="tab"></div>';
  const body = $("#tab", el);
  if (tab === "cards") cardsTab(body, D, sub, c);
  else if (tab === "quiz") quizTab(body, D, sub, q);
  else problemsTab(body, D, sub, ctx);
}

const emptyBox = what => '<div class="empty"><b>No ' + what + ' for this topic yet</b>They will appear here once the study material for it is made.</div>';

function search(placeholder) {
  return '<input type="search" class="find" id="find" placeholder="' + placeholder + '" autocomplete="off">';
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
  const left = c.total - c.known;
  const pct = Math.round(100 * c.known / c.total);
  let h = '<div class="card"><div class="row between"><div><b>' + plural(c.total, "card") + '</b><div class="small muted">' + c.known + " known &middot; " + c.learning + " still learning &middot; " + c.fresh + " new</div></div>" +
    '<div class="small muted">' + pct + '% known</div></div><div class="bar" style="margin:10px 0 12px"><i style="width:' + pct + '%"></i></div>' +
    '<div class="row"><a class="btn primary" href="#/cards/session?mode=all&decks=' + sub.id + '">Study all ' + c.total + "</a>" +
    (left && left < c.total ? '<a class="btn" href="#/cards/session?mode=todo&decks=' + sub.id + '">Only the ' + left + " I don&rsquo;t know yet</a>" : "") + "</div></div>";
  h += search("Search these cards");
  for (const [topic, cards] of groupBy(list, "t")) {
    h += '<div class="igroup"><div class="row between ghead"><b>' + esc(topic) + '</b><a class="small" href="#/cards/session?mode=all&decks=' + sub.id + "&topics=" + encodeURIComponent(topic) + '">Study these ' + cards.length + "</a></div>";
    for (const card of cards) {
      const k = cardState(s.cards[card.id]);
      const chip = k === "new" ? '<span class="tag">new</span>' : k === "known" ? '<span class="tag ok">&#10003; known</span>' : '<span class="tag bad">learning</span>';
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
  let h = '<div class="card"><div class="row between"><div><b>' + plural(q.n, "question") + '</b><div class="small muted">' + q.seen + " attempted" + (q.acc == null ? "" : " &middot; " + q.acc + "% correct") + '</div></div></div>' +
    '<div class="row" style="margin-top:12px">' +
    '<a class="btn primary" href="#/quiz/session?n=10&decks=' + sub.id + '">Quick quiz &middot; ' + Math.min(10, q.n) + "</a>" +
    '<a class="btn" href="#/quiz/session?n=all&decks=' + sub.id + '">All ' + q.n + "</a>" +
    (q.mistakes ? '<a class="btn" href="#/quiz/session?n=all&mode=mistakes&decks=' + sub.id + '">Mistakes (' + q.mistakes + ")</a>" : "") + "</div></div>";
  h += search("Search these questions");
  for (const [topic, qs] of groupBy(list, "t")) {
    h += '<div class="igroup"><div class="row between ghead"><b>' + esc(topic) + '</b><a class="small" href="#/quiz/session?n=all&decks=' + sub.id + "&topics=" + encodeURIComponent(topic) + '">Quiz on these ' + qs.length + "</a></div>";
    for (const qu of qs) {
      const x = s.quiz[qu.id];
      const chip = !x ? '<span class="tag">new</span>' : x.last === 0 ? '<span class="tag bad">missed</span>' : '<span class="tag ok">&#10003;</span>';
      h += '<details class="irow"><summary><span class="stext">' + inline(qu.q) + "</span>" + chip + '</summary><div class="ibody"><ul class="opts">' +
        qu.o.map((o, i) => '<li class="' + (i === qu.a ? "right" : "") + '">' + (i === qu.a ? "&#10003; " : "") + inline(o) + "</li>").join("") + "</ul>" +
        '<div class="explain" style="margin-bottom:0">' + md(qu.x) + "</div></div></details>";
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
  let h = '<div class="card soft"><b>' + s.solved + " / " + s.total + ' solved</b> <span class="small muted">&middot; ' + P.LEVELS[cfg.levels[sub.id] || 0] + '</span><div class="bar" style="margin-top:8px"><i style="width:' + Math.round(100 * s.solved / Math.max(1, s.total)) + '%"></i></div>' +
    '<p class="small muted" style="margin:8px 0 0">Tap a problem to open it on LeetCode, then tick it off here.</p></div><ul class="list">';
  for (const p of pool) {
    const st = state.probs[p.id];
    const solved = st && st.st !== "todo";
    h += '<li class="trow"><button class="tick' + (solved ? " on" : "") + '" data-tick="' + esc(p.id) + '" data-solved="' + (solved ? 1 : 0) + '" aria-label="' + (solved ? "Mark as not solved" : "Mark as solved") + '">' + (solved ? "&#10003;" : "") + "</button>" +
      '<a class="ptitle" href="' + esc(p.url) + '" target="_blank" rel="noopener"><b>' + esc(p.title) + ' <span class="ext">&#8599;</span></b><span class="small muted">' + (p.lc ? esc(p.lc) : "") +
      (solved ? (p.lc ? " &middot; " : "") + (st.st === "revisit" ? "revisit" : "solved " + st.n + "&times;") : "") + (p.premium ? " &middot; Premium" : "") + '</span></a><span class="tag ' + p.diff + '">' + p.diff + "</span></li>";
  }
  el.innerHTML = h + "</ul>";
  $$("[data-tick]", el).forEach(b => b.onclick = () => {
    if (b.dataset.solved === "1") {
      // only a completion recorded today can be undone quietly; an older one would lose its history, so ask first
      const p = store.get().probs[b.dataset.tick];
      if (P.doneOn(p, todayISO())) undo(b.dataset.tick);
      else if (confirm("Clear this problem's solved status and its re-solve schedule?")) store.commit(st => { st.probs[b.dataset.tick] = { st: "todo", n: 0, d: dayNum(), t: Date.now(), c: 0, tries: 0, note: "" }; });
      else return;
    } else {
      record(b.dataset.tick, "solved");
      ctx.toast("Saved.");
      const p = pool.find(x => x.id === b.dataset.tick);
      openLogModal(b.dataset.tick, p ? p.title : b.dataset.tick, ctx);
    }
    ctx.rerender();
  });
}
