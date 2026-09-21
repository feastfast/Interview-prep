import * as store from "../store.js";
import { esc, md, shuffle, plural, $, $$ } from "../util.js";
import { cardState } from "../srs.js";

/* Flashcard session for one topic. There is no schedule: you flip a card, say whether you knew it, and cards you
   missed come back a few cards later. The last result is kept so the topic page can show what is still unknown. */
let sess = null;
let offKey = null;

export function render(el, r, ctx) {
  if (r.parts[1] === "session") return session(el, r, ctx);
  location.replace("#/topics");
}

function buildQueue(D, r) {
  const s = store.get();
  const mode = r.q.get("mode") || "all";
  const decks = (r.q.get("decks") || "").split(",").filter(Boolean);
  const topics = (r.q.get("topics") || "").split("|").filter(Boolean);
  let pool = D.cards.cards.filter(c => (!decks.length || decks.includes(c.d)) && (!topics.length || topics.includes(c.t)));
  if (mode === "todo") pool = pool.filter(c => cardState(s.cards[c.id]) !== "known");
  return shuffle(pool);
}

function session(el, r, ctx) {
  const { D } = ctx;
  const decks = (r.q.get("decks") || "").split(",").filter(Boolean);
  const home = decks.length === 1 ? "#/topics/" + decks[0] : "#/topics";
  sess = { queue: buildQueue(D, r), done: 0, total: 0, missed: new Set(), shown: false, back: home + "/cards", home };
  sess.total = sess.queue.length;
  if (!sess.total) {
    el.innerHTML = '<div class="empty"><b>Nothing to study here</b>Every card in this selection is already marked as known.<p style="margin-top:14px"><a class="btn" href="' + sess.back + '">Back to topic</a></p></div>';
    return;
  }
  draw(el, ctx);
  cleanup();
  const onKey = e => {
    if (!sess || !document.getElementById("fc")) return;
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    if (!sess.shown && (e.code === "Space" || e.code === "Enter")) { e.preventDefault(); reveal(); }
    else if (sess.shown && (e.key === "1" || e.key === "2")) rate(e.key === "2", el, ctx);
  };
  document.addEventListener("keydown", onKey);
  offKey = () => document.removeEventListener("keydown", onKey);
  window.addEventListener("hashchange", cleanup, { once: true });
}
function cleanup() { if (offKey) { offKey(); offKey = null; } }

function draw(el, ctx) {
  if (!sess.queue.length) return finish(el, ctx);
  const card = sess.queue[0];
  const st = cardState(store.get().cards[card.id]);
  const pct = Math.round(100 * sess.done / sess.total);
  let h = '<div class="session-head"><a class="btn ghost sm" href="' + sess.back + '">&larr; Exit</a><div class="bar"><i style="width:' + pct + '%"></i></div><span class="small muted mono">' + sess.done + "/" + sess.total + "</span></div>";
  h += '<div class="fc" id="fc"><div class="side">' + esc(card.t) + (st === "new" ? " &middot; new" : st === "learning" ? " &middot; still learning" : "") + '</div><div class="q">' + md(card.f) + "</div>" +
    (sess.shown ? '<div class="a">' + md(card.b) + "</div>" : "") + "</div>";
  if (!sess.shown) {
    h += '<button class="btn primary block" id="show" style="margin-top:14px">Show answer <span class="kbd" style="margin-left:8px;color:inherit;border-color:currentColor">space</span></button>' +
      '<p class="small muted" style="text-align:center;margin-top:10px">Try to recall the answer first &mdash; say it out loud or write it down.</p>';
  } else {
    h += '<div class="rate two"><button class="again" data-k="0">Didn&rsquo;t know</button><button class="good" data-k="1">Knew it</button></div>' +
      '<p class="small muted" style="text-align:center;margin-top:10px">Keys <span class="kbd">1</span> Didn&rsquo;t know &middot; <span class="kbd">2</span> Knew it</p>';
  }
  el.innerHTML = h;
  const showBtn = $("#show", el);
  if (showBtn) showBtn.onclick = () => reveal();
  $$(".rate button", el).forEach(b => b.onclick = () => rate(b.dataset.k === "1", el, ctx));
  const fc = $("#fc", el);
  if (fc && !sess.shown) fc.onclick = () => reveal();
  sess.el = el; sess.ctx = ctx;
}

function reveal() { sess.shown = true; draw(sess.el, sess.ctx); }

function rate(knew, el, ctx) {
  const card = sess.queue.shift();
  store.commit(s => {
    const x = s.cards[card.id] || { n: 0, w: 0 };
    s.cards[card.id] = { k: knew ? 1 : 0, n: (x.n || 0) + 1, w: (x.w || 0) + (knew ? 0 : 1), t: Date.now() };
  });
  store.bump("cards");
  if (knew) sess.done++;
  else { sess.missed.add(card.id); sess.queue.splice(Math.min(3, sess.queue.length), 0, card); }   // see it again soon in this session
  sess.shown = false;
  draw(el, ctx);
}

function finish(el, ctx) {
  cleanup();
  const missed = sess.missed.size;
  el.innerHTML = '<div class="card" style="text-align:center;padding:26px 16px"><div style="font-size:40px">&#127881;</div><h2 style="margin:6px 0">Session complete</h2>' +
    '<p class="muted">' + plural(sess.total, "card") + ' reviewed</p>' +
    '<div class="grid g3" style="margin:14px 0"><div class="tile"><b>' + sess.total + "</b><span>cards</span></div><div class=\"tile\"><b>" + (sess.total - missed) + "</b><span>knew first time</span></div><div class=\"tile\"><b>" + missed + "</b><span>needed another go</span></div></div>" +
    '<div class="row" style="justify-content:center"><a class="btn primary" href="' + sess.back + '">Back to topic</a>' + (sess.home !== "#/topics" ? '<a class="btn" href="' + sess.home + '/quiz">Take its quiz</a>' : "") + "</div></div>";
  sess = null;
}
