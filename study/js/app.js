import * as store from "./store.js";
import * as sync from "./sync.js";
import { $, $$, esc, fetchJSON, ago } from "./util.js";
import { dayNum, isDue, isNew } from "./srs.js";
import * as today from "./views/today.js";
import * as cards from "./views/cards.js";
import * as quiz from "./views/quiz.js";
import * as practice from "./views/practice.js";
import * as progress from "./views/progress.js";
import * as plan from "./views/plan.js";

export const D = { cards: null, quiz: null, py: null, sql: null, plan: null };

const ICON = {
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/></svg>',
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>',
  cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="15" height="12" rx="2.5"/><path d="M7 7V6a2.5 2.5 0 0 1 2.5-2.5H19A2.5 2.5 0 0 1 21.5 6v8a2.5 2.5 0 0 1-2.5 2.5H18"/></svg>',
  quiz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01"/></svg>',
  practice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/></svg>',
  progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
};
const TABS = [["today", "Today"], ["plan", "Plan"], ["cards", "Cards"], ["quiz", "Quiz"], ["practice", "Practice"], ["progress", "Progress"]];

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
  for (const p of s.probs ? Object.values(s.probs) : []) if (p.st !== "todo" && p.d <= t) probsDue++;
  return { due, unseen, newLeft, probsDue };
}

function drawHeader() {
  const st = sync.status;
  let pill;
  if (st.user) pill = '<a class="pill ' + (st.error ? "err" : "on") + '" href="#/progress/settings" title="' + esc(st.error || "Synced") + '"><span class="dot"></span>' + (st.syncing ? "Syncing" : st.error ? "Sync issue" : "Synced") + "</a>";
  else pill = '<a class="pill" href="#/progress/settings"><span class="dot"></span>Local only</a>';
  $("#top").innerHTML = '<div class="brand"><h1>Study</h1><p class="sub">FLASHCARDS · QUIZZES · PRACTICE</p></div>' + pill + '<a class="lib" href="../">Library</a>';
}

function drawNav(active) {
  const c = D.cards ? counts() : { due: 0, newLeft: 0, probsDue: 0 };
  $("#nav").innerHTML = TABS.map(([k, label]) => {
    let badge = "";
    if (k === "cards" && c.due + c.newLeft > 0) badge = '<span class="badge">' + Math.min(99, c.due + c.newLeft) + "</span>";
    if (k === "practice" && c.probsDue > 0) badge = '<span class="badge">' + c.probsDue + "</span>";
    return '<a href="#/' + k + '" class="' + (k === active ? "on" : "") + '">' + ICON[k] + label + badge + "</a>";
  }).join("");
}

let current = null;
export function render() {
  const r = route();
  const tab = r.parts[0] || "today";
  const views = { today, plan, cards, quiz, practice, progress };
  const view = views[tab] || today;
  drawHeader(); drawNav(views[tab] ? tab : "today");
  document.body.classList.toggle("wide", tab === "practice" && r.parts.length > 1);
  const main = $("#main");
  main.innerHTML = '<div class="view" id="view"></div>';
  current = view;
  view.render($("#view"), r, { D, go, toast, rerender: render, counts });
  window.scrollTo(0, 0);
  document.title = "Study · Interview Prep";
}

/* Re-draw only the chrome (badges, sync pill) without touching an active session. */
function refreshChrome() { drawHeader(); const r = route(); drawNav(r.parts[0] || "today"); }

async function boot() {
  store.load();
  sync.onStatus(refreshChrome);
  store.subscribe(why => {
    sync.scheduleSync();
    if (why === "change" || why === "silent") refreshChrome();
    else if (why === "remote" || why === "import" || why === "reset") {
      const r = route();
      const live = (r.parts[0] === "cards" && r.parts[1] === "session") || (r.parts[0] === "quiz" && r.parts[1] === "session") || (r.parts[0] === "practice" && r.parts.length > 1);
      if (!live) render(); else refreshChrome();
    }
  });
  $("#main").innerHTML = '<div class="view"><p class="empty"><span class="spinner"></span>Loading your decks…</p></div>';
  drawHeader();
  try {
    const [c, q, py, sql, pl] = await Promise.all([
      fetchJSON("data/cards.json"), fetchJSON("data/quiz.json"), fetchJSON("data/problems_py.json"), fetchJSON("data/problems_sql.json"), fetchJSON("data/plan.json")]);
    D.cards = c; D.quiz = q; D.py = py; D.sql = sql; D.plan = pl;
  } catch (e) {
    $("#main").innerHTML = '<div class="view"><p class="empty"><b>Could not load the study data</b>' + esc(e.message) + "</p></div>";
    return;
  }
  window.addEventListener("hashchange", render);
  render();
  sync.autoStart();
}
boot();
