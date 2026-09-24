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
import * as materials from "./views/materials.js";
import * as P from "./plan.js";
import { icon, hue, getTheme, setTheme, cycleTheme, syncThemeColor, countUps, reduced } from "./ui.js";

export const D = { cards: null, quiz: null, problems: null, plan: null, known: new Set() };

const TABS = [["today", "Today"], ["plan", "Plan"], ["topics", "Topics"], ["progress", "Progress"], ["materials", "Materials"]];
const VIEWS = { today, plan, topics, cards, quiz, progress, materials };
/* data lives next to the code, wherever the page that loads it sits */
const dataUrl = f => new URL("../data/" + f, import.meta.url).href;
const desktop = matchMedia("(min-width: 960px)");
/* phones get a lighter motion path: CSS slides instead of full-page view-transition snapshots */
const lite = () => !desktop.matches;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? "⌘" : "Ctrl";

export function route(hash = location.hash) {
  const h = hash.replace(/^#\/?/, "");
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
  const badge = () => "";                       // re-solves are optional, so no nagging count on the Plan tab
  const cur = r.parts[0] === "topics" ? r.parts[1] : (r.parts[0] === "cards" || r.parts[0] === "quiz") ? (r.q.get("decks") || "").split(",")[0] : null;

  let s = '<a class="brand" href="#/today"><span class="logo">' + icon("sparkle", 18) + '</span><span><b>Interview Prep</b><small>Study · notes · planner</small></span></a>' +
    '<button class="search" type="button" data-palette>' + icon("search", 15) + "<span>Search or jump to…</span><kbd>" + modKey + " K</kbd></button>" +
    '<nav class="snav">' + TABS.map(([k, label]) => '<a href="#/' + k + '"' + (k === active ? ' class="on" aria-current="page"' : "") + ">" + (k === active ? '<span class="snav-ind"></span>' : "") + icon(k, 18) + "<span>" + label + "</span>" + badge(k) + "</a>").join("") + "</nav>";
  if (D.cards && desktop.matches) {             // the sidebar is hidden on phones: skip its per-subject stats
    s += '<div class="side-h">Subjects</div><div class="subs">' + topics.subjects(D).map(sub => {
      const st = topics.cardStats(D, sub.id);
      const pct = st.total ? Math.round(100 * st.known / st.total) : null;
      return '<a class="sub hued' + (sub.id === cur ? " on" : "") + '" href="#/topics/' + sub.id + '" style="--h:' + hue(sub.id) + '"><i></i><span>' + esc(sub.label) + "</span>" + (pct != null ? "<small>" + pct + "%</small>" : "") + "</a>";
    }).join("") + "</div>";
  }
  s += '<div class="side-foot"><div class="streak">' + icon("flame", 16) + "<span><b>" + store.streak() + "</b> day streak</span></div>" +
    '<div class="row between">' + syncPill(false) + '<div class="row" style="gap:2px">' + themeBtn() + '<a class="iconbtn" href="https://github.com/feastfast/Interview-prep" target="_blank" rel="noopener" title="GitHub repository" aria-label="GitHub repository">' + icon("ext", 16) + "</a></div></div></div>";
  $("#side").innerHTML = s;

  $("#top").innerHTML = '<a class="brand sm" href="#/today"><span class="logo">' + icon("sparkle", 15) + "</span><b>Interview Prep</b></a>" +
    '<div class="row" style="gap:2px">' + syncPill(true) + '<button class="iconbtn" type="button" data-palette aria-label="Search">' + icon("search", 18) + "</button>" + themeBtn() + "</div>";

  drawDock(active, 0);
}
/* The dock is built once and only updated, so its pill can glide between tabs with a plain CSS transition. */
function drawDock(active, due) {
  const nav = $("#nav");
  if (!nav.querySelector(".dock-pill")) {
    nav.innerHTML = '<span class="dock-pill"></span>' + TABS.map(([k, label]) => '<a href="#/' + k + '" data-tab="' + k + '">' + icon(k, 20) + "<span>" + label + "</span><em hidden></em></a>").join("");
    // move the pill as soon as a finger lands, not after the next page has rendered
    nav.addEventListener("pointerdown", e => { const a = e.target.closest("a[data-tab]"); if (a) nav.style.setProperty("--i", TABS.findIndex(([k]) => k === a.dataset.tab)); });
  }
  nav.style.setProperty("--i", Math.max(0, TABS.findIndex(([k]) => k === active)));
  for (const a of nav.querySelectorAll("a[data-tab]")) {
    const on = a.dataset.tab === active;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    const em = a.querySelector("em"), show = a.dataset.tab === "plan" && due > 0;
    em.hidden = !show;
    if (show) em.textContent = due;
  }
}
function refreshChrome() { const r = route(); drawChrome(tabOf(r.parts[0] || "today", VIEWS), r); }

/* ------------------------------------------------------------------ rendering with page transitions */
let lastHash = null, painted = false, navToken = 0;
export function render() {
  const first = route().parts[0];
  // the old library home used #/<Subject>/<folder> links; send those to Materials
  if (first && !VIEWS[first]) { location.replace("#/materials/" + location.hash.replace(/^#\/?/, "")); return; }
  const fresh = location.hash !== lastHash;
  const prev = lastHash == null ? null : route(lastHash);
  lastHash = location.hash;
  const r = route();
  // switching between top-level tabs slides sideways in tab order, like a native tab bar
  const tabIdx = h => TABS.findIndex(([k]) => k === tabOf(h || "today", VIEWS));
  const a = prev ? tabIdx(prev.parts[0]) : -1, b = tabIdx(r.parts[0]);
  const dir = a < 0 || a === b ? "" : b > a ? "fwd" : "back";
  if (fresh && painted && lite()) paint(r, true, dir, reduced() ? "" : dir || "up");
  else if (fresh && painted && document.startViewTransition && !reduced() && !document.hidden) {
    const root = document.documentElement, token = ++navToken;
    root.dataset.nav = dir;
    // a skipped transition (e.g. the tab is hidden) still runs the update; it just rejects these promises
    const vt = document.startViewTransition(() => paint(r, true, dir));
    vt.ready.catch(() => {});
    vt.finished.catch(() => {}).finally(() => { if (token === navToken) root.dataset.nav = ""; });
  } else paint(r, fresh);
}
function paint(r, fresh, dir = "", anim = "") {
  const tab = r.parts[0] || "today";
  const view = VIEWS[tab] || today;
  drawChrome(tabOf(tab, VIEWS), r);
  const main = $("#main");
  const y = window.scrollY;
  // a sideways tab slide is motion enough: skip the staggered entrance, keep rings/bars/count-ups
  const enter = !fresh ? "" : dir ? ' data-enter="tab"' : ' data-enter="1"';
  main.innerHTML = '<div class="view" id="view"' + enter + (anim ? ' data-anim="' + anim + '"' : "") + "></div>";
  const v = $("#view");
  view.render(v, r, { D, go, toast, rerender: render, counts, refreshChrome });
  document.title = "Interview Prep";
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
  page("Materials", "#/materials", "materials"); page("Stash", "#/plan/stash", "archive"); page("Review my solutions", "#/plan/review", "code");
  page("Plan settings", "#/plan/setup", "gear"); page("Settings & sync", "#/progress/settings", "gear");
  const subs = topics.subjects(D);
  for (const sub of subs) items.push({ g: "Topics", label: sub.label, dot: hue(sub.id), run: () => go("#/topics/" + sub.id) });
  for (const sub of subs) {
    if (D.cards.cards.some(c => c.d === sub.id)) items.push({ g: "Study", label: "Flashcards · " + sub.label, ic: "cards", run: () => go("#/cards/session?mode=all&decks=" + sub.id) });
    if (D.quiz.questions.some(q => q.d === sub.id)) items.push({ g: "Study", label: "Quick quiz · " + sub.label, ic: "quiz", run: () => go("#/quiz/session?n=10&decks=" + sub.id + "&r=" + Date.now()) });
  }
  for (const [t, label, ic] of [["light", "Light", "sun"], ["dark", "Dark", "moon"], ["system", "System", "system"]])
    items.push({ g: "Theme", label: "Theme: " + label, ic, run: () => { setTheme(t); setTimeout(refreshChrome, 20); } });
  for (const f of materials.materialFiles()) items.push({ g: "Materials", label: f.label, hint: f.trail, ic: "book", deep: true, run: () => window.open(f.href, "_blank", "noopener") });
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
    '<input placeholder="Search pages, topics, notes, problems…" autocomplete="off" spellcheck="false" aria-label="Search"><kbd>esc</kbd></div>' +
    '<div class="pal-l" role="listbox"></div><div class="pal-f"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span>Type 2+ letters to search notes &amp; problems</span></div></div>';
  document.body.appendChild(bg);
  const inp = $("input", bg), list = $(".pal-l", bg);
  let shown = [], act = 0;
  const draw = () => {
    const q = inp.value.trim().toLowerCase(), toks = q.split(/\s+/).filter(Boolean);
    let np = 0;
    shown = all.filter(it => (!it.deep || q.length >= 2) && toks.every(t => (it.label + " " + (it.hint || "") + " " + it.g).toLowerCase().includes(t)))
      .filter(it => !it.deep || ++np <= 12).slice(0, 60);
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
  desktop.addEventListener("change", refreshChrome);
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
      fetchJSON(dataUrl("cards.json")), fetchJSON(dataUrl("quiz.json")), fetchJSON(dataUrl("problems.json")), fetchJSON(dataUrl("plan.json"))]);
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
