import * as store from "../store.js";
import { esc, md, shuffle, interleave, plural, $, $$ } from "../util.js";
import { schedule, intervalLabel, isNew, isDue, isMature, dayNum, RATINGS } from "../srs.js";

let sess = null;
let offKey = null;

export function render(el, r, ctx) {
  if (r.parts[1] === "session") return session(el, r, ctx);
  return picker(el, ctx);
}

/* ------------------------------------------------------------------ deck picker */
function deckStats(D, deckId) {
  const s = store.get(), t = dayNum();
  const st = { total: 0, new: 0, due: 0, young: 0, mature: 0, topics: {} };
  for (const c of D.cards.cards) {
    if (c.d !== deckId) continue;
    const x = s.cards[c.id];
    const tp = st.topics[c.t] || (st.topics[c.t] = { total: 0, new: 0, due: 0 });
    st.total++; tp.total++;
    if (isNew(x)) { st.new++; tp.new++; }
    else { if (isDue(x, t)) { st.due++; tp.due++; } isMature(x) ? st.mature++ : st.young++; }
  }
  return st;
}

function picker(el, ctx) {
  const { D, counts } = ctx;
  const c = counts();
  let h = '<h2>Flashcards</h2>' +
    '<div class="card"><div class="row between"><div><b>' + c.due + '</b> due &middot; <b>' + c.newLeft + '</b> new today</div>' +
    '<a class="btn primary" href="#/cards/session?mode=today">Review all decks</a></div></div>';
  h += "<h2>Decks</h2>";
  for (const deck of D.cards.decks) {
    const st = deckStats(D, deck.id);
    const learned = st.total ? Math.round(100 * (st.total - st.new) / st.total) : 0;
    h += '<div class="card"><div class="row between"><div><b>' + esc(deck.label) + '</b><div class="small muted">' + plural(st.total, "card") + " &middot; " + st.due + " due &middot; " + st.new + " new</div></div>" +
      '<a class="btn sm" href="#/cards/session?mode=today&decks=' + deck.id + '">Study</a></div>' +
      '<div class="bar" style="margin-top:10px"><i style="width:' + learned + '%"></i></div>' +
      '<details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">Topics</summary><ul class="list">' +
      Object.entries(st.topics).map(([tp, v]) =>
        '<li><a class="li" href="#/cards/session?mode=all&decks=' + deck.id + "&topics=" + encodeURIComponent(tp) + '"><div class="t"><b>' + esc(tp) + '</b><small>' + v.total + " cards</small></div><div class=\"r\">" + (v.due ? v.due + " due" : "") + (v.due && v.new ? " &middot; " : "") + (v.new ? v.new + " new" : "") + "</div></a></li>").join("") +
      "</ul></details></div>";
  }
  h += '<p class="small muted">Tapping a topic studies every card in it (great for a focused pass before an interview). The daily review only shows what is due plus a limited number of new cards.</p>';
  el.innerHTML = h;
}

/* ------------------------------------------------------------------ session */
function buildQueue(D, r) {
  const s = store.get(), t = dayNum();
  const mode = r.q.get("mode") || "today";
  const decks = (r.q.get("decks") || "").split(",").filter(Boolean);
  const topics = (r.q.get("topics") || "").split("|").filter(Boolean);
  let pool = D.cards.cards.filter(c => (!decks.length || decks.includes(c.d)) && (!topics.length || topics.includes(c.t)));
  const byTopic = list => { const m = {}; list.forEach(c => (m[c.t + "/" + c.d] = m[c.t + "/" + c.d] || []).push(c)); return Object.values(m).map(shuffle); };
  if (mode === "all") return shuffle(pool);
  const due = pool.filter(c => isDue(s.cards[c.id], t));
  const fresh = pool.filter(c => isNew(s.cards[c.id]));
  if (mode === "ahead") {
    const later = pool.filter(c => !isNew(s.cards[c.id]) && !isDue(s.cards[c.id], t)).sort((a, b) => s.cards[a.id].d - s.cards[b.id].d);
    return interleave(byTopic(later.slice(0, 15).concat(fresh.slice(0, 5)))).slice(0, 15);
  }
  const limit = Math.max(0, (s.settings.newPerDay || 15) - store.newSeenToday());
  return interleave(byTopic(due)).concat(interleave(byTopic(fresh)).slice(0, limit));
}

function session(el, r, ctx) {
  const { D } = ctx;
  sess = { queue: buildQueue(D, r), done: 0, total: 0, stats: { again: 0, hard: 0, good: 0, easy: 0 }, shown: false, back: r.q.get("mode") === "all" ? "#/cards" : "#/today" };
  sess.total = sess.queue.length;
  if (!sess.total) {
    el.innerHTML = '<div class="empty"><b>Nothing to study here</b>No cards are due. Try &ldquo;study ahead&rdquo; from the Today tab.<p style="margin-top:14px"><a class="btn" href="#/cards">Back to decks</a></p></div>';
    return;
  }
  draw(el, ctx);
  cleanup();
  const onKey = e => {
    if (!sess || !document.getElementById("fc")) return;
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    if (!sess.shown && (e.code === "Space" || e.code === "Enter")) { e.preventDefault(); reveal(); }
    else if (sess.shown && "1234".includes(e.key)) rate(RATINGS["1234".indexOf(e.key)], el, ctx);
  };
  document.addEventListener("keydown", onKey);
  offKey = () => document.removeEventListener("keydown", onKey);
  window.addEventListener("hashchange", cleanup, { once: true });
}
function cleanup() { if (offKey) { offKey(); offKey = null; } }

function draw(el, ctx) {
  if (!sess.queue.length) return finish(el, ctx);
  const card = sess.queue[0];
  const prev = store.get().cards[card.id];
  const pct = Math.round(100 * sess.done / sess.total);
  let h = '<div class="session-head"><a class="btn ghost sm" href="' + sess.back + '">&larr; Exit</a><div class="bar"><i style="width:' + pct + '%"></i></div><span class="small muted mono">' + sess.done + "/" + sess.total + "</span></div>";
  h += '<div class="fc" id="fc"><div class="side">' + esc(card.t) + (isNew(prev) ? " &middot; new" : "") + '</div><div class="q">' + md(card.f) + "</div>" +
    (sess.shown ? '<div class="a">' + md(card.b) + "</div>" : "") + "</div>";
  if (!sess.shown) {
    h += '<button class="btn primary block" id="show" style="margin-top:14px">Show answer <span class="kbd" style="margin-left:8px;color:inherit;border-color:currentColor">space</span></button>' +
      '<p class="small muted" style="text-align:center;margin-top:10px">Try to recall the answer first &mdash; say it out loud or write it down.</p>';
  } else {
    h += '<div class="rate">' + RATINGS.map((k, i) =>
      '<button class="' + k + '" data-r="' + k + '">' + ["Again", "Hard", "Good", "Easy"][i] + "<small>" + intervalLabel(prev, k) + "</small></button>").join("") + "</div>" +
      '<p class="small muted" style="text-align:center;margin-top:10px">Keys <span class="kbd">1</span> Again &middot; <span class="kbd">2</span> Hard &middot; <span class="kbd">3</span> Good &middot; <span class="kbd">4</span> Easy</p>';
  }
  el.innerHTML = h;
  const showBtn = $("#show", el);
  if (showBtn) showBtn.onclick = () => { reveal(); };
  $$(".rate button", el).forEach(b => b.onclick = () => rate(b.dataset.r, el, ctx));
  const fc = $("#fc", el);
  if (fc && !sess.shown) fc.onclick = () => reveal();
  sess.el = el; sess.ctx = ctx;
}

function reveal() { sess.shown = true; draw(sess.el, sess.ctx); }

function rate(rating, el, ctx) {
  const card = sess.queue.shift();
  const prev = store.get().cards[card.id];
  const wasNew = isNew(prev);
  store.commit(s => { s.cards[card.id] = schedule(prev, rating); });
  if (wasNew) { store.noteNewCard(); store.bump("new"); }
  store.bump("cards");
  sess.stats[rating]++;
  if (rating === "again") sess.queue.splice(Math.min(3, sess.queue.length), 0, card);   // see it again soon in this session
  else sess.done++;
  sess.shown = false;
  draw(el, ctx);
}

function finish(el, ctx) {
  cleanup();
  const st = sess.stats;
  const total = st.again + st.hard + st.good + st.easy;
  el.innerHTML = '<div class="card" style="text-align:center;padding:26px 16px"><div style="font-size:40px">&#127881;</div><h2 style="margin:6px 0">Session complete</h2>' +
    '<p class="muted">' + plural(total, "review") + ' &middot; ' + Math.round(100 * (st.good + st.easy) / Math.max(1, total)) + '% recalled without a lapse</p>' +
    '<div class="grid g3" style="margin:14px 0"><div class="tile"><b>' + st.again + "</b><span>Again</span></div><div class=\"tile\"><b>" + st.hard + "</b><span>Hard</span></div><div class=\"tile\"><b>" + (st.good + st.easy) + "</b><span>Good / Easy</span></div></div>" +
    '<div class="row" style="justify-content:center"><a class="btn primary" href="#/today">Back to Today</a><a class="btn" href="#/quiz">Take a quiz</a></div></div>';
  sess = null;
}
