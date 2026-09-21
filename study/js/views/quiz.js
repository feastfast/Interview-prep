import * as store from "../store.js";
import { esc, md, shuffle, plural, $, $$ } from "../util.js";

let sess = null;

export function render(el, r, ctx) {
  if (r.parts[1] === "session") return session(el, r, ctx);
  return picker(el, ctx);
}

function stats(D, deckId) {
  const s = store.get();
  let n = 0, seen = 0, right = 0, wrong = 0;
  for (const q of D.quiz.questions) {
    if (deckId !== "all" && q.d !== deckId) continue;
    n++;
    const x = s.quiz[q.id];
    if (x) { seen++; right += x.c; wrong += x.w; }
  }
  return { n, seen, acc: right + wrong ? Math.round(100 * right / (right + wrong)) : null };
}

function picker(el, ctx) {
  const { D } = ctx;
  const s = store.get();
  const mistakes = D.quiz.questions.filter(q => s.quiz[q.id] && s.quiz[q.id].last === 0).length;
  let h = "<h2>Quiz</h2><p class=\"muted small\">Questions are drawn from everything in the guides. Unseen and previously-missed questions come first; topics are mixed so you have to recognise the pattern rather than just recall a chapter.</p>";
  h += '<div class="card"><b>Pick topics</b><div class="chips" id="decks" style="margin-top:8px">' +
    D.quiz.decks.map(d => '<span class="chip on" data-d="' + d.id + '">' + esc(d.label) + "</span>").join("") + "</div>" +
    '<div style="margin-top:14px"><b>How many?</b></div><div class="chips" id="count" style="margin-top:8px">' +
    [10, 20, 30].map(n => '<span class="chip' + (n === 10 ? " on" : "") + '" data-n="' + n + '">' + n + "</span>").join("") + "</div>" +
    '<div class="row" style="margin-top:16px"><button class="btn primary" id="go">Start quiz</button>' +
    '<a class="btn" href="#/quiz/session?n=10&mode=mistakes"' + (mistakes ? "" : ' style="opacity:.5;pointer-events:none"') + ">Review mistakes" + (mistakes ? " (" + mistakes + ")" : "") + "</a></div></div>";
  h += "<h2>By topic</h2><ul class=\"list\">" + D.quiz.decks.map(d => {
    const st = stats(D, d.id);
    return '<li><a class="li" href="#/quiz/session?n=10&decks=' + d.id + '"><div class="t"><b>' + esc(d.label) + "</b><small>" + st.n + " questions &middot; " + st.seen + ' attempted</small></div><div class="r">' + (st.acc == null ? "&mdash;" : st.acc + "%") + "</div></a></li>";
  }).join("") + "</ul>";
  el.innerHTML = h;
  const selDecks = new Set(D.quiz.decks.map(d => d.id));
  let n = 10;
  $$("#decks .chip", el).forEach(c => c.onclick = () => {
    const id = c.dataset.d;
    if (selDecks.has(id)) { if (selDecks.size > 1) { selDecks.delete(id); c.classList.remove("on"); } } else { selDecks.add(id); c.classList.add("on"); }
  });
  $$("#count .chip", el).forEach(c => c.onclick = () => { n = +c.dataset.n; $$("#count .chip", el).forEach(x => x.classList.toggle("on", x === c)); });
  $("#go", el).onclick = () => { location.hash = "#/quiz/session?n=" + n + "&decks=" + Array.from(selDecks).join(","); };
}

function pick(D, r) {
  const s = store.get();
  const n = Math.min(40, +r.q.get("n") || 10);
  const mode = r.q.get("mode");
  const decksParam = r.q.get("decks");
  const decks = !decksParam || decksParam === "all" ? null : decksParam.split(",");
  let pool = D.quiz.questions.filter(q => !decks || decks.includes(q.d));
  if (mode === "mistakes") pool = pool.filter(q => s.quiz[q.id] && s.quiz[q.id].last === 0);
  // priority: wrong last time > never seen > oldest attempt, then interleave decks
  const score = q => { const x = s.quiz[q.id]; return !x ? 1.5 : x.last === 0 ? 2 : 0.5 + Math.min(0.9, (Date.now() - x.t) / (30 * 864e5)); };
  const ranked = shuffle(pool).sort((a, b) => score(b) - score(a)).slice(0, n);
  return shuffle(ranked);
}

function session(el, r, ctx) {
  const { D } = ctx;
  const qs = pick(D, r).map(q => {
    const order = shuffle(q.o.map((_, i) => i));
    return { q, order, correct: order.indexOf(q.a) };
  });
  if (!qs.length) { el.innerHTML = '<div class="empty"><b>No questions to show</b>Nothing matches this selection yet.<p style="margin-top:14px"><a class="btn" href="#/quiz">Back</a></p></div>'; return; }
  sess = { list: qs, i: 0, right: 0, wrong: [], answered: -1, t0: Date.now() };
  draw(el, ctx);
  const onKey = e => {
    if (!sess || !document.getElementById("qz")) return;
    const k = "abcdefgh".indexOf(e.key.toLowerCase());
    if (sess.answered < 0 && k >= 0 && k < sess.list[sess.i].order.length) answer(k, el, ctx);
    else if (sess.answered >= 0 && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(el, ctx); }
  };
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", () => document.removeEventListener("keydown", onKey), { once: true });
}

function draw(el, ctx) {
  if (sess.i >= sess.list.length) return finish(el, ctx);
  const cur = sess.list[sess.i];
  const q = cur.q;
  const pct = Math.round(100 * sess.i / sess.list.length);
  let h = '<div class="session-head"><a class="btn ghost sm" href="#/quiz">&larr; Exit</a><div class="bar"><i style="width:' + pct + '%"></i></div><span class="small muted mono">' + (sess.i + 1) + "/" + sess.list.length + "</span></div>";
  h += '<div id="qz"><div class="row" style="margin-bottom:8px"><span class="tag acc">' + esc(q.t) + "</span></div><div style=\"font-size:17.5px;font-weight:500;margin-bottom:14px\">" + md(q.q) + "</div>";
  cur.order.forEach((oi, k) => {
    let cls = "opt";
    if (sess.answered >= 0) { cls += " locked"; if (k === cur.correct) cls += " right"; else if (k === sess.answered) cls += " wrong"; }
    h += '<button class="' + cls + '" data-k="' + k + '"><span class="k">' + "ABCDEFGH"[k] + "</span><span>" + md(q.o[oi]).replace(/^<p>|<\/p>$/g, "") + "</span></button>";
  });
  if (sess.answered >= 0) {
    const ok = sess.answered === cur.correct;
    h += '<div class="explain"><b>' + (ok ? "Correct" : "Not quite") + ".</b> " + md(q.x) + "</div>" +
      '<button class="btn primary block" id="next">' + (sess.i + 1 === sess.list.length ? "See results" : "Next question") + "</button>";
  }
  h += "</div>";
  el.innerHTML = h;
  $$(".opt", el).forEach(b => b.onclick = () => { if (sess.answered < 0) answer(+b.dataset.k, el, ctx); });
  const nx = $("#next", el); if (nx) nx.onclick = () => next(el, ctx);
}

function answer(k, el, ctx) {
  const cur = sess.list[sess.i];
  sess.answered = k;
  const ok = k === cur.correct;
  if (ok) sess.right++; else sess.wrong.push(cur.q);
  store.commit(s => {
    const x = s.quiz[cur.q.id] || { c: 0, w: 0, t: 0, last: 1 };
    s.quiz[cur.q.id] = { c: x.c + (ok ? 1 : 0), w: x.w + (ok ? 0 : 1), t: Date.now(), last: ok ? 1 : 0 };
  });
  store.bump("quiz");
  draw(el, ctx);
}
function next(el, ctx) { sess.i++; sess.answered = -1; draw(el, ctx); if (sess.i < sess.list.length) window.scrollTo(0, 0); }

function finish(el) {
  const n = sess.list.length, pct = Math.round(100 * sess.right / n);
  const secs = Math.round((Date.now() - sess.t0) / 1000);
  let h = '<div class="card" style="text-align:center;padding:24px 16px"><div style="font-size:40px">' + (pct >= 80 ? "&#127942;" : pct >= 50 ? "&#128077;" : "&#128170;") + '</div><h2 style="margin:6px 0">' + sess.right + " / " + n + " correct</h2>" +
    '<p class="muted">' + pct + "% &middot; " + Math.floor(secs / 60) + "m " + (secs % 60) + "s</p></div>";
  if (sess.wrong.length) {
    h += "<h2>Review what you missed</h2>";
    for (const q of sess.wrong) {
      h += '<div class="card"><span class="tag">' + esc(q.t) + "</span><div style=\"margin:6px 0;font-weight:500\">" + md(q.q) + '</div><div class="small"><b>Answer:</b> ' + md(q.o[q.a]).replace(/^<p>|<\/p>$/g, "") + '</div><div class="explain" style="margin-bottom:0">' + md(q.x) + "</div></div>";
    }
    h += '<p class="small muted">These are now in your <b>Review mistakes</b> set and will come up first next time.</p>';
  }
  h += '<div class="row"><a class="btn primary" href="#/quiz/session?n=10&mode=' + (sess.wrong.length ? "mistakes" : "x") + '">' + (sess.wrong.length ? "Retry mistakes" : "Another quiz") + '</a><a class="btn" href="#/quiz">Back</a></div>';
  el.innerHTML = h;
  sess = null;
}
