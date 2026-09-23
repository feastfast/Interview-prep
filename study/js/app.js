import * as store from "./store.js";
import * as sync from "./sync.js";
import { $, $$, esc, fetchJSON } from "./util.js";
import { dayNum } from "./srs.js";
import * as today from "./views/today.js";
import * as cards from "./views/cards.js";
import * as quiz from "./views/quiz.js";
import * as topics from "./views/topics.js";
import * as progress from "./views/progress.js";
import * as plan from "./views/plan.js";
import * as P from "./plan.js";
import { icon, hue, getTheme, setTheme, cycleTheme, syncThemeColor, countUps, reduced } from "./ui.js";

export const D = { cards: null, quiz: null, problems: null, plan: null, known: new Set() };

const TABS = [["today", "Today"], ["plan", "Plan"], ["topics", "Topics"], ["progress", "Progress"]];
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? "⌘" : "Ctrl";

export function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, query] = h.split("?");
  return { parts: path.split("/").filter(Boolean), q: new URLSearchParams(query || "") };
}
export function go(hash) { location.hash = hash; }

export function toast(msg, ms = 2400) {
  const root = $("#toasts");
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = icon(/fail|could not|error/i.test(msg) ? "alert" : "check", 16) + "<span></span>";
  t.lastChild.textContent = msg;
  root.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 260); }, ms);
}

/* Problems whose spaced re-solve is due (drives the Plan badge). */
export function counts() {
  const s = store.get(), t = dayNum();
  let probsDue = 0;
  for (const [id, p] of Object.entries(s.probs || {})) if (D.known.has(id) && p.st !== "todo" && p.d <= t) probsDue++;
  return { probsDue };
}

/* ------------------------------------------------------------------ chrome: sidebar, top bar, dock */
function syncPill(compact) {
  const st = sync.status;
  const cls = st.user ? (st.error ? "err" : "on") : "";
  const label = st.user ? (st.syncing ? "Syncing" : st.error ? "Sync issue" : "Synced") : "Local only";
  return '<a class="sync ' + cls + (compact ? " compact" : "") + '" href="#/progress/settings" title="' + esc(st.error || label) + '"><span class="dot"></span>' + (compact ? "" : "<span>" + label + "</span>") + "</a>";
}
function themeBtn() {
  const t = getTheme();
  return '<button class="iconbtn" type="button" data-theme-cycle title="Theme: ' + t + '" aria-label="Change theme (now ' + t + ')">' + icon(t === "light" ? "sun" : t === "dark" ? "moon" : "system", 17) + "</button>";
}

const tabOf = (tab, views) => tab === "cards" || tab === "quiz" ? "topics" : views[tab] ? tab : "today";

function drawChrome(active, r) {
  const c = D.cards ? counts() : { probsDue: 0 };
  const badge = k => (k === "plan" && c.probsDue > 0 ? "<em>" + c.probsDue + "</em>" : "");
  const cur = r.parts[0] === "topics" ? r.parts[1] : (r.parts[0] === "cards" || r.parts[0] === "quiz") ? (r.q.get("decks") || "").split(",")[0] : null;

  let s = '<a class="brand" href="#/today"><span class="logo">' + icon("sparkle", 18) + '</span><span><b>Study</b><small>Interview prep</small></span></a>' +
    '<button class="search" type="button" data-palette>' + icon("search", 15) + "<span>Search or jump to…</span><kbd>" + modKey + " K</kbd></button>" +
    '<nav class="snav">' + TABS.map(([k, label]) => '<a href="#/' + k + '"' + (k === active ? ' class="on" aria-current="page"' : "") + ">" + (k === active ? '<span class="snav-ind"></span>' : "") + icon(k, 18) + "<span>" + label + "</span>" + badge(k) + "</a>").join("") + "</nav>";
  if (D.cards) {
    s += '<div class="side-h">Subjects</div><div class="subs">' + topics.subjects(D).map(sub => {
      const st = topics.cardStats(D, sub.id);
      const pct = st.total ? Math.round(100 * st.known / st.total) : null;
      return '<a class="sub hued' + (sub.id === cur ? " on" : "") + '" href="#/topics/' + sub.id + '" style="--h:' + hue(sub.id) + '"><i></i><span>' + esc(sub.label) + "</span>" + (pct != null ? "<small>" + pct + "%</small>" : "") + "</a>";
    }).join("") + "</div>";
  }
  s += '<div class="side-foot"><div class="streak">' + icon("flame", 16) + "<span><b>" + store.streak() + "</b> day streak</span></div>" +
    '<div class="row between">' + syncPill(false) + '<div class="row" style="gap:2px">' + themeBtn() + '<a class="iconbtn" href="../" title="Library" aria-label="Library">' + icon("book", 17) + "</a></div></div></div>";
  $("#side").innerHTML = s;

  $("#top").innerHTML = '<a class="brand sm" href="#/today"><span class="logo">' + icon("sparkle", 15) + "</span><b>Study</b></a>" +
    '<div class="row" style="gap:2px">' + syncPill(true) + '<button class="iconbtn" type="button" data-palette aria-label="Search">' + icon("search", 18) + "</button>" + themeBtn() + "</div>";

  $("#nav").innerHTML = TABS.map(([k, label]) => '<a href="#/' + k + '"' + (k === active ? ' class="on" aria-current="page"' : "") + ">" + (k === active ? '<span class="dock-ind"></span>' : "") + icon(k, 20) + "<span>" + label + "</span>" + badge(k) + "</a>").join("");
}
function refreshChrome() { const r = route(); drawChrome(tabOf(r.parts[0] || "today", { today: 1, plan: 1, topics: 1, progress: 1 }), r); }

/* ------------------------------------------------------------------ rendering with page transitions */
let lastHash = null, painted = false;
export function render() {
  const fresh = location.hash !== lastHash;
  lastHash = location.hash;
  const r = route();
  if (fresh && painted && document.startViewTransition && !reduced() && !document.hidden) {
    // a skipped transition (e.g. the tab is hidden) still runs the update; it just rejects these promises
    const vt = document.startViewTransition(() => paint(r, true));
    vt.ready.catch(() => {}); vt.finished.catch(() => {});
  } else paint(r, fresh);
}
function paint(r, fresh) {
  const tab = r.parts[0] || "today";
  const views = { today, plan, topics, cards, quiz, progress };
  const view = views[tab] || today;
  drawChrome(tabOf(tab, views), r);
  const main = $("#main");
  const y = window.scrollY;
  main.innerHTML = '<div class="view" id="view"' + (fresh ? " data-enter" : "") + "></div>";
  const v = $("#view");
  view.render(v, r, { D, go, toast, rerender: render, counts, refreshChrome });
  document.title = "Study · Interview Prep";
  if (fresh) {
    window.scrollTo(0, 0);
    countUps(v);
    setTimeout(() => v.removeAttribute("data-enter"), 1400);
  } else window.scrollTo(0, y);                // a re-render after an action keeps your place
  painted = true;
}

/* ------------------------------------------------------------------ command palette (Ctrl/Cmd + K) */
function paletteItems() {
  const items = [];
  const page = (label, hash, ic) => items.push({ g: "Pages", label, ic, run: () => go(hash) });
  page("Today", "#/today", "today"); page("Plan", "#/plan", "plan"); page("Topics", "#/topics", "topics"); page("Progress", "#/progress", "progress");
  page("Stash", "#/plan/stash", "archive"); page("Review my solutions", "#/plan/review", "code");
  page("Plan settings", "#/plan/setup", "gear"); page("Settings & sync", "#/progress/settings", "gear");
  const subs = topics.subjects(D);
  for (const sub of subs) items.push({ g: "Topics", label: sub.label, dot: hue(sub.id), run: () => go("#/topics/" + sub.id) });
  for (const sub of subs) {
    if (D.cards.cards.some(c => c.d === sub.id)) items.push({ g: "Study", label: "Flashcards · " + sub.label, ic: "cards", run: () => go("#/cards/session?mode=all&decks=" + sub.id) });
    if (D.quiz.questions.some(q => q.d === sub.id)) items.push({ g: "Study", label: "Quick quiz · " + sub.label, ic: "quiz", run: () => go("#/quiz/session?n=10&decks=" + sub.id + "&r=" + Date.now()) });
  }
  for (const [t, label, ic] of [["light", "Light", "sun"], ["dark", "Dark", "moon"], ["system", "System", "system"]])
    items.push({ g: "Theme", label: "Theme: " + label, ic, run: () => { setTheme(t); setTimeout(refreshChrome, 20); } });
  const pools = P.buildPools(D.plan, D.problems.problems), seen = new Set();
  for (const tid of Object.keys(pools)) for (const p of pools[tid]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    items.push({ g: "Problems", label: p.title, hint: p.lc, ic: "ext", deep: true, run: () => window.open(p.url, "_blank", "noopener") });
  }
  return items;
}

let palOpen = false;
function openPalette() {
  if (palOpen || !D.cards) return;
  palOpen = true;
  const all = paletteItems();
  const bg = document.createElement("div");
  bg.className = "pal-bg";
  bg.innerHTML = '<div class="pal" role="dialog" aria-label="Search"><div class="pal-in">' + icon("search", 18) +
    '<input placeholder="Search pages, topics, problems…" autocomplete="off" spellcheck="false" aria-label="Search"><kbd>esc</kbd></div>' +
    '<div class="pal-l" role="listbox"></div><div class="pal-f"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span>Type 2+ letters to search problems</span></div></div>';
  document.body.appendChild(bg);
  const inp = $("input", bg), list = $(".pal-l", bg);
  let shown = [], act = 0;
  const draw = () => {
    const q = inp.value.trim().toLowerCase(), toks = q.split(/\s+/).filter(Boolean);
    let np = 0;
    shown = all.filter(it => (!it.deep || q.length >= 2) && toks.every(t => (it.label + " " + (it.hint || "") + " " + it.g).toLowerCase().includes(t)))
      .filter(it => it.g !== "Problems" || ++np <= 8).slice(0, 60);
    act = Math.min(act, Math.max(0, shown.length - 1));
    if (!shown.length) { list.innerHTML = '<div class="pal-empty">No matches for “' + esc(inp.value) + "”</div>"; return; }
    let h = "", g = null;
    shown.forEach((it, i) => {
      if (it.g !== g) { g = it.g; h += '<div class="pal-g">' + g + "</div>"; }
      const hued = it.dot != null;
      h += '<div class="pal-i' + (i === act ? " on" : "") + (hued ? " hued" : "") + '" role="option" data-i="' + i + '"' + (hued ? ' style="--h:' + it.dot + '"' : "") + ">" +
        (hued ? '<i class="dot"></i>' : icon(it.ic || "arrow", 16)) + "<span>" + esc(it.label) + "</span>" + (it.hint ? "<small>" + esc(it.hint) + "</small>" : "") + "</div>";
    });
    list.innerHTML = h;
  };
  const mark = () => { $$(".pal-i", list).forEach((el, i) => el.classList.toggle("on", i === act)); const el = $(".pal-i.on", list); if (el) el.scrollIntoView({ block: "nearest" }); };
  const close = () => { palOpen = false; bg.classList.add("out"); document.removeEventListener("keydown", onKey, true); setTimeout(() => bg.remove(), 160); };
  const pick = i => { const it = shown[i]; close(); if (it) it.run(); };
  const onKey = e => {
    e.stopPropagation();                         // keep typing here from triggering page shortcuts
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown" && shown.length) { e.preventDefault(); act = (act + 1) % shown.length; mark(); }
    else if (e.key === "ArrowUp" && shown.length) { e.preventDefault(); act = (act - 1 + shown.length) % shown.length; mark(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(act); }
  };
  document.addEventListener("keydown", onKey, true);
  inp.oninput = () => { act = 0; draw(); };
  list.onmousemove = e => { const el = e.target.closest(".pal-i"); if (el && +el.dataset.i !== act) { act = +el.dataset.i; mark(); } };
  list.onclick = e => { const el = e.target.closest(".pal-i"); if (el) pick(+el.dataset.i); };
  bg.onmousedown = e => { if (e.target === bg) close(); };
  draw();
  inp.focus();
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  store.load();
  syncThemeColor();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);
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
  document.addEventListener("click", e => {
    if (e.target.closest("[data-palette]")) openPalette();
    else if (e.target.closest("[data-theme-cycle]")) { cycleTheme(); setTimeout(refreshChrome, 20); }
  });
  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
    else if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !document.querySelector(".modal-bg")) { e.preventDefault(); openPalette(); }
  });
  $("#main").innerHTML = '<div class="view"><div class="loading"><span class="spinner"></span>Loading your decks…</div></div>';
  drawChrome("today", route());
  try {
    const [c, q, pr, pl] = await Promise.all([
      fetchJSON("data/cards.json"), fetchJSON("data/quiz.json"), fetchJSON("data/problems.json"), fetchJSON("data/plan.json")]);
    D.cards = c; D.quiz = q; D.problems = pr; D.plan = pl;
    for (const pool of Object.values(P.buildPools(pl, pr.problems))) for (const x of pool) D.known.add(x.id);
  } catch (e) {
    $("#main").innerHTML = '<div class="view"><div class="empty">' + icon("alert", 28) + "<b>Could not load the study data</b>" + esc(e.message) + "</div></div>";
    return;
  }
  window.addEventListener("hashchange", render);
  render();
  sync.autoStart();
}
boot();
