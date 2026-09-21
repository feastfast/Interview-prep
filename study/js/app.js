import * as store from "./store.js";
import * as sync from "./sync.js";
import { $, $$, esc, fetchJSON, ago } from "./util.js";
import { dayNum, isDue, isNew } from "./srs.js";
import * as today from "./views/today.js";
import * as cards from "./views/cards.js";
import * as quiz from "./views/quiz.js";
import * as topics from "./views/topics.js";
import * as progress from "./views/progress.js";
import * as plan from "./views/plan.js";
import * as P from "./plan.js";

export const D = { cards: null, quiz: null, problems: null, plan: null, known: new Set() };

const ICON = {
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/></svg>',
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>',
  topics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="15" height="12" rx="2.5"/><path d="M7 7V6a2.5 2.5 0 0 1 2.5-2.5H19A2.5 2.5 0 0 1 21.5 6v8a2.5 2.5 0 0 1-2.5 2.5H18"/></svg>',
  progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
};
const TABS = [["today", "Today"], ["plan", "Plan"], ["topics", "Topics"], ["progress", "Progress"]];

export function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, query] = h.split("?");
  return { parts: path.split("/").filter(Boolean), q: new URLSearchParams(query || "") };
}
export function go(hash) { location.hash = hash; }
export function toast(msg, ms = 2200) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* Counters for the nav badge and the Today screen. */
export function counts() {
  const s = store.get(), t = dayNum();
  let due = 0, unseen = 0;
  for (const c of D.cards ? D.cards.cards : []) {
    const st = s.cards[c.id];
    if (isNew(st)) unseen++; else if (isDue(st, t)) due++;
  }
  const limit = s.settings.newPerDay || 15;
  const newLeft = Math.max(0, Math.min(unseen, limit - store.newSeenToday()));
  let probsDue = 0;
  for (const [id, p] of Object.entries(s.probs || {})) if (D.known.has(id) && p.st !== "todo" && p.d <= t) probsDue++;
  return { due, unseen, newLeft, probsDue };
}

function drawHeader() {
  const st = sync.status;
  let pill;
  if (st.user) pill = '<a class="pill ' + (st.error ? "err" : "on") + '" href="#/progress/settings" title="' + esc(st.error || "Synced") + '"><span class="dot"></span>' + (st.syncing ? "Syncing" : st.error ? "Sync issue" : "Synced") + "</a>";
  else pill = '<a class="pill" href="#/progress/settings"><span class="dot"></span>Local only</a>';
  $("#top").innerHTML = '<div class="brand"><h1>Study</h1><p class="sub">FLASHCARDS · QUIZZES · PLANNER</p></div>' + pill + '<a class="lib" href="../">Library</a>';
}

/* Card and quiz sessions live under a topic, so they highlight the Topics tab. */
const tabOf = (tab, views) => tab === "cards" || tab === "quiz" ? "topics" : views[tab] ? tab : "today";

function drawNav(active) {
  const c = D.cards ? counts() : { due: 0, newLeft: 0, probsDue: 0 };
  $("#nav").innerHTML = TABS.map(([k, label]) => {
    let badge = "";
    if (k === "topics" && c.due > 0) badge = '<span class="badge">' + Math.min(99, c.due) + "</span>";
    if (k === "plan" && c.probsDue > 0) badge = '<span class="badge">' + c.probsDue + "</span>";
    return '<a href="#/' + k + '" class="' + (k === active ? "on" : "") + '">' + ICON[k] + label + badge + "</a>";
  }).join("");
}

let current = null;
export function render() {
  const r = route();
  const tab = r.parts[0] || "today";
  const views = { today, plan, topics, cards, quiz, progress };
  const view = views[tab] || today;
  drawHeader(); drawNav(tabOf(tab, views));
  const main = $("#main");
  main.innerHTML = '<div class="view" id="view"></div>';
  current = view;
  view.render($("#view"), r, { D, go, toast, rerender: render, counts });
  window.scrollTo(0, 0);
  document.title = "Study · Interview Prep";
}

/* Re-draw only the chrome (badges, sync pill) without touching an active session. */
function refreshChrome() { drawHeader(); const r = route(); drawNav(tabOf(r.parts[0] || "today", { today: 1, plan: 1, topics: 1, progress: 1 })); }

async function boot() {
  store.load();
  sync.onStatus(refreshChrome);
  store.subscribe(why => {
    sync.scheduleSync();
    if (why === "change" || why === "silent") refreshChrome();
    else if (why === "remote" || why === "import" || why === "reset") {
      const r = route();
      const live = (r.parts[0] === "cards" && r.parts[1] === "session") || (r.parts[0] === "quiz" && r.parts[1] === "session");
      if (!live) render(); else refreshChrome();
    }
  });
  $("#main").innerHTML = '<div class="view"><p class="empty"><span class="spinner"></span>Loading your decks…</p></div>';
  drawHeader();
  try {
    const [c, q, pr, pl] = await Promise.all([
      fetchJSON("data/cards.json"), fetchJSON("data/quiz.json"), fetchJSON("data/problems.json"), fetchJSON("data/plan.json")]);
    D.cards = c; D.quiz = q; D.problems = pr; D.plan = pl;
    for (const pool of Object.values(P.buildPools(pl, pr.problems))) for (const x of pool) D.known.add(x.id);
  } catch (e) {
    $("#main").innerHTML = '<div class="view"><p class="empty"><b>Could not load the study data</b>' + esc(e.message) + "</p></div>";
    return;
  }
  window.addEventListener("hashchange", render);
  render();
  sync.autoStart();
}
boot();
