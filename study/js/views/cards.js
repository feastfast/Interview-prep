import * as store from "../store.js";
import { esc, md, shuffle, plural, $, $$ } from "../util.js";
import { cardState } from "../srs.js";
import { icon, ring, settle, confetti, reduced } from "../ui.js";

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
  sess = { queue: buildQueue(D, r), done: 0, total: 0, missed: new Set(), shown: false, back: home + "/cards", home, el, ctx, prev: 0, enter: false, busy: false };
  sess.total = sess.queue.length;
  if (!sess.total) {
    el.innerHTML = '<div class="empty">' + icon("trophy", 30) + '<b>Nothing to study here</b>Every card in this selection is already marked as known.<p style="margin-top:16px"><a class="btn" href="' + sess.back + '">Back to topic</a></p></div>';
    return;
  }
  draw();
  cleanup();
  const onKey = e => {
    if (!sess || !document.getElementById("fc")) return;
    if (/TEXTAREA|INPUT/.test(e.target.tagName) || e.metaKey || e.ctrlKey) return;
    if (!sess.shown && (e.code === "Space" || e.code === "Enter")) { e.preventDefault(); reveal(); }
    else if (sess.shown && (e.key === "1" || e.key === "ArrowLeft")) rate(false);
    else if (sess.shown && (e.key === "2" || e.key === "ArrowRight")) rate(true);
  };
  document.addEventListener("keydown", onKey);
  offKey = () => document.removeEventListener("keydown", onKey);
  window.addEventListener("hashchange", cleanup, { once: true });
}
function cleanup() { if (offKey) { offKey(); offKey = null; } }

function head(back, from, to, label) {
  return '<div class="sess-h"><a class="iconbtn" href="' + back + '" aria-label="Exit session">' + icon("close", 18) + '</a><div class="bar"><i style="width:' + from + '%" data-to="' + to + '%"></i></div><span class="sess-n">' + label + "</span></div>";
}

function actions() {
  if (!sess.shown) return '<button class="btn primary block lg" id="show">Show answer <kbd>space</kbd></button><p class="hintline">Recall it first &mdash; say it out loud or jot it down.</p>';
  return '<div class="rate two"><button class="again" data-k="0">' + icon("close", 18) + "Didn’t know<kbd>1</kbd></button><button class=\"good\" data-k=\"1\">" + icon("check", 18) + "Knew it<kbd>2</kbd></button></div>" +
    '<p class="hintline">Or swipe the card &mdash; left if you didn’t know it, right if you did.</p>';
}

function draw() {
  const { el } = sess;
  if (!sess.queue.length) return finish();
  const card = sess.queue[0];
  const st = cardState(store.get().cards[card.id]);
  const pctNow = Math.round(100 * sess.done / sess.total);
  const left = sess.queue.length;
  const tag = st === "new" ? '<span class="tag acc">new</span>' : st === "learning" ? '<span class="tag bad">still learning</span>' : '<span class="tag ok">known</span>';
  let h = head(sess.back, sess.prev, pctNow, sess.done + " / " + sess.total);
  h += '<div class="deck">' + (left > 2 ? '<div class="deck-shadow two"></div>' : "") + (left > 1 ? '<div class="deck-shadow"></div>' : "") +
    '<div class="fc' + (sess.enter ? " enter" : "") + '" id="fc"><div class="fc-in' + (sess.shown ? " flipped" : "") + '">' +
    '<div class="face front"><div class="fc-side"><span>' + esc(card.t) + "</span>" + tag + '</div><div class="q">' + md(card.f) + '</div><div class="hint">' + icon("sparkle", 14) + "Tap the card or press space to flip</div></div>" +
    '<div class="face back"><div class="fc-side"><span>Answer</span></div><div class="q q-sm">' + md(card.f) + '</div><div class="a">' + md(card.b) + "</div></div>" +
    '</div><div class="swipe-tint"><span class="st-l">' + icon("close", 22) + '</span><span class="st-r">' + icon("check", 22) + "</span></div></div></div>";
  h += '<div class="fc-act" id="fcact">' + actions() + "</div>";
  el.innerHTML = h;
  sess.prev = pctNow; sess.enter = false;
  settle(el);
  bindActs();
  const fc = $("#fc", el);
  fc.addEventListener("click", () => { if (!sess.shown && !sess.dragged) reveal(); });
  bindSwipe(fc);
}

function bindActs() {
  const act = $("#fcact", sess.el);
  const showBtn = $("#show", act);
  if (showBtn) showBtn.onclick = () => reveal();
  $$(".rate button", act).forEach(b => b.onclick = () => rate(b.dataset.k === "1"));
}

function reveal() {
  if (!sess || sess.shown) return;
  sess.shown = true;
  const inner = $(".fc-in", sess.el);
  if (inner) inner.classList.add("flipped");
  const act = $("#fcact", sess.el);
  if (act) { act.innerHTML = actions(); act.classList.remove("again-in"); void act.offsetWidth; act.classList.add("again-in"); bindActs(); }
}

/* After the flip, the card can be dragged sideways: past the threshold it counts as an answer. */
function bindSwipe(fc) {
  let x0 = null, dx = 0;
  fc.addEventListener("pointerdown", e => {
    sess.dragged = false;
    if (!sess.shown || e.button || e.target.closest("pre, a")) return;
    x0 = e.clientX; dx = 0;
    fc.setPointerCapture(e.pointerId);
  });
  fc.addEventListener("pointermove", e => {
    if (x0 == null) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > 4) { sess.dragged = true; fc.classList.add("drag"); }
    fc.style.transform = "translateX(" + dx + "px) rotate(" + dx / 22 + "deg)";
    fc.style.setProperty("--tint", Math.min(1, Math.abs(dx) / 130).toFixed(2));
    fc.dataset.dir = dx > 0 ? "r" : "l";
  });
  const end = () => {
    if (x0 == null) return;
    x0 = null;
    fc.classList.remove("drag");
    if (Math.abs(dx) > 110) rate(dx > 0);
    else { fc.style.transform = ""; fc.style.setProperty("--tint", 0); }
  };
  fc.addEventListener("pointerup", end);
  fc.addEventListener("pointercancel", end);
}

function rate(knew) {
  if (!sess || sess.busy) return;
  sess.busy = true;
  const card = sess.queue.shift();
  store.commit(s => {
    const x = s.cards[card.id] || { n: 0, w: 0 };
    s.cards[card.id] = { k: knew ? 1 : 0, n: (x.n || 0) + 1, w: (x.w || 0) + (knew ? 0 : 1), t: Date.now() };
  });
  store.bump("cards");
  if (knew) sess.done++;
  else { sess.missed.add(card.id); sess.queue.splice(Math.min(3, sess.queue.length), 0, card); }   // see it again soon in this session
  sess.shown = false;
  const next = () => { if (!sess) return; sess.busy = false; sess.enter = true; draw(); };
  const fc = $("#fc", sess.el);
  if (fc && !reduced()) {
    const d = knew ? 1 : -1;
    fc.dataset.dir = knew ? "r" : "l";
    fc.style.setProperty("--tint", 1);
    fc.style.transition = "transform .32s cubic-bezier(.5,0,.75,0), opacity .32s ease-in";
    fc.style.transform = "translateX(" + d * 115 + "%) rotate(" + d * 16 + "deg)";
    fc.style.opacity = "0";
    setTimeout(next, 260);
  } else next();
}

function finish() {
  cleanup();
  const { el } = sess;
  const missed = sess.missed.size, first = sess.total - missed;
  el.innerHTML = '<div class="result">' + ring(first / sess.total, { size: 132, stroke: 12, label: Math.round(100 * first / sess.total) + "%", sub: "first try" }) +
    "<h1>Session complete</h1><p class=\"muted\">" + plural(sess.total, "card") + " reviewed</p>" +
    '<div class="stats three">' + tile("cards", sess.total, "cards") + tile("check", first, "knew first time") + tile("sync", missed, "needed another go") + "</div>" +
    '<div class="row" style="justify-content:center"><a class="btn primary lg" href="' + sess.back + '">Back to topic</a>' + (sess.home !== "#/topics" ? '<a class="btn lg" href="' + sess.home + '/quiz">Take its quiz ' + icon("arrow", 16) + "</a>" : "") + "</div></div>";
  if (first / sess.total >= 0.6) confetti();
  sess = null;
}
const tile = (ic, n, label) => '<div class="stat"><span class="stat-ic">' + icon(ic, 16) + "</span><b>" + n + "</b><span>" + label + "</span></div>";
