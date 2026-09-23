import * as store from "../store.js";
import { esc, md, shuffle, plural, $, $$ } from "../util.js";
import { icon, ring, settle, confetti } from "../ui.js";

let sess = null;
const inline = s => md(s).replace(/^<p>|<\/p>$/g, "");

export function render(el, r, ctx) {
  if (r.parts[1] === "session") return session(el, r, ctx);
  location.replace("#/topics");
}

function pick(D, r) {
  const s = store.get();
  const n = r.q.get("n") === "all" ? Infinity : Math.min(40, +r.q.get("n") || 10);
  const topics = (r.q.get("topics") || "").split("|").filter(Boolean);
  const mode = r.q.get("mode");
  const decksParam = r.q.get("decks");
  const decks = !decksParam || decksParam === "all" ? null : decksParam.split(",");
  let pool = D.quiz.questions.filter(q => (!decks || decks.includes(q.d)) && (!topics.length || topics.includes(q.t)));
  if (mode === "mistakes") pool = pool.filter(q => s.quiz[q.id] && s.quiz[q.id].last === 0);
  // priority: wrong last time > never seen > oldest attempt, then interleave decks
  const score = q => { const x = s.quiz[q.id]; return !x ? 1.5 : x.last === 0 ? 2 : 0.5 + Math.min(0.9, (Date.now() - x.t) / (30 * 864e5)); };
  const ranked = shuffle(pool).sort((a, b) => score(b) - score(a)).slice(0, n);
  return shuffle(ranked);
}

function session(el, r, ctx) {
  const { D } = ctx;
  const decks = (r.q.get("decks") || "").split(",").filter(Boolean);
  const home = decks.length === 1 ? "#/topics/" + decks[0] : "#/topics";
  const qs = pick(D, r).map(q => {
    const order = shuffle(q.o.map((_, i) => i));
    return { q, order, correct: order.indexOf(q.a) };
  });
  if (!qs.length) { el.innerHTML = '<div class="empty">' + icon("quiz", 28) + '<b>No questions to show</b>Nothing matches this selection yet.<p style="margin-top:16px"><a class="btn" href="' + home + '/quiz">Back</a></p></div>'; return; }
  sess = { home, decksParam: r.q.get("decks") || "", list: qs, i: 0, right: 0, wrong: [], answered: -1, t0: Date.now(), prev: 0 };
  draw(el, ctx);
  const onKey = e => {
    if (!sess || !document.getElementById("qz") || e.metaKey || e.ctrlKey) return;
    const k = "abcdefgh".indexOf(e.key.toLowerCase());
    const k2 = "12345678".indexOf(e.key);
    const idx = k >= 0 ? k : k2;
    if (sess.answered < 0 && idx >= 0 && idx < sess.list[sess.i].order.length) answer(idx, el, ctx);
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
  let h = '<div class="sess-h"><a class="iconbtn" href="' + sess.home + '/quiz" aria-label="Exit quiz">' + icon("close", 18) + '</a><div class="bar"><i style="width:' + sess.prev + '%" data-to="' + pct + '%"></i></div><span class="sess-n">' + (sess.i + 1) + " / " + sess.list.length + "</span></div>";
  sess.prev = pct;
  h += '<div class="qz" id="qz"' + (sess.answered < 0 ? ' data-new="1"' : "") + '><div class="row"><span class="tag acc">' + esc(q.t) + '</span><span class="small muted">Question ' + (sess.i + 1) + '</span></div><div class="qz-q">' + md(q.q) + "</div>";
  cur.order.forEach((oi, k) => {
    let cls = "opt";
    if (sess.answered >= 0) { cls += " locked"; if (k === cur.correct) cls += " right"; else if (k === sess.answered) cls += " wrong"; }
    const mark = sess.answered >= 0 && k === cur.correct ? icon("check", 14) : sess.answered === k ? icon("close", 14) : "ABCDEFGH"[k];
    h += '<button class="' + cls + '" data-k="' + k + '"><span class="k">' + mark + "</span><span>" + inline(q.o[oi]) + "</span></button>";
  });
  if (sess.answered >= 0) {
    const ok = sess.answered === cur.correct;
    h += '<div class="explain ' + (ok ? "ok" : "no") + '">' + icon(ok ? "check" : "alert", 18) + "<div><b>" + (ok ? "Correct." : "Not quite.") + "</b> " + md(q.x) + "</div></div>" +
      '<button class="btn primary block lg" id="next">' + (sess.i + 1 === sess.list.length ? "See results" : "Next question") + " <kbd>enter</kbd></button>";
  } else h += '<p class="hintline">Press <kbd>A</kbd>&ndash;<kbd>' + "ABCDEFGH"[cur.order.length - 1] + "</kbd> or <kbd>1</kbd>&ndash;<kbd>" + cur.order.length + "</kbd> to answer.</p>";
  h += "</div>";
  el.innerHTML = h;
  settle(el);
  $$(".opt", el).forEach(b => b.onclick = () => { if (sess.answered < 0) answer(+b.dataset.k, el, ctx); });
  const nx = $("#next", el); if (nx) nx.onclick = () => next(el, ctx);
}

function answer(k, el, ctx) {
  if (!sess) return;
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
function next(el, ctx) { if (!sess) return; sess.i++; sess.answered = -1; draw(el, ctx); window.scrollTo({ top: 0, behavior: "smooth" }); }

function finish(el) {
  const n = sess.list.length, pct = Math.round(100 * sess.right / n);
  const secs = Math.round((Date.now() - sess.t0) / 1000);
  const verdict = pct >= 80 ? "Excellent work" : pct >= 50 ? "Solid progress" : "Good practice";
  let h = '<div class="result">' + ring(sess.right / n, { size: 132, stroke: 12, label: pct + "%", sub: sess.right + " of " + n }) +
    "<h1>" + verdict + '</h1><p class="muted">' + plural(n, "question") + " · " + Math.floor(secs / 60) + "m " + (secs % 60) + "s</p>" +
    '<div class="row" style="justify-content:center;margin-top:18px"><a class="btn primary lg" href="#/quiz/session?n=' + (sess.wrong.length ? "all&mode=mistakes" : "10") + "&decks=" + encodeURIComponent(sess.decksParam) + "&r=" + Date.now() + '">' +
    icon(sess.wrong.length ? "sync" : "bolt", 16) + (sess.wrong.length ? "Retry mistakes" : "Another quiz") + '</a><a class="btn lg" href="' + sess.home + '/quiz">Back to topic</a></div></div>';
  if (sess.wrong.length) {
    h += '<div class="sec-h"><h2>Review what you missed</h2><span class="tag bad">' + sess.wrong.length + "</span></div>";
    for (const q of sess.wrong) {
      h += '<div class="card miss"><span class="tag">' + esc(q.t) + '</span><div class="miss-q">' + md(q.q) + '</div><div class="miss-a">' + icon("check", 14) + "<span>" + inline(q.o[q.a]) + '</span></div><div class="explain" style="margin-bottom:0">' + icon("sparkle", 16) + "<div>" + md(q.x) + "</div></div></div>";
    }
    h += '<p class="small muted">These are now in your mistakes set and come up first next time.</p>';
  }
  el.innerHTML = h;
  if (pct >= 80) confetti();
  sess = null;
}
