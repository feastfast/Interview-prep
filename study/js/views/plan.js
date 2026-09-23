import * as store from "../store.js";
import { esc, plural, $, $$ } from "../util.js";
import { nextProblem, dayNum } from "../srs.js";
import * as P from "../plan.js";
import { icon, ring, hue, confetti } from "../ui.js";

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOT_LABEL = { resolve: "Re-solve", main: "Main topic", secondary: "Second topic", carry: "Carried over" };
const todayISO = () => P.iso(new Date());
let justTicked = null;

export function render(el, r, ctx) {
  if (r.parts[1] === "setup") return setup(el, ctx);
  if (r.parts[1] === "stash") return stashView(el, ctx);
  if (r.parts[1] === "review") return reviewView(el, ctx);
  if (r.parts[1] === "topic") { location.replace("#/topics/" + r.parts[2] + "/problems"); return; }
  return overview(el, ctx);
}

/* ------------------------------------------------------------------ persistence helpers */
function ensureWeek(pc, state) {
  const key = pc.monday;
  const existing = state.weeks[key];
  if (existing && existing.days) return existing;
  const prev = state.weeks[P.addDays(key, -7)];
  const week = P.genWeek({ weekKey: key, weekIdx: pc.weekIdx, plan: pc.plan, cfg: pc.cfg, pools: pc.pools, probs: state.probs, today: dayNum(), prevWeek: prev ? prev.days : null, review: pc.review });
  store.commit(s => { s.weeks[key] = { t: Date.now(), days: week }; });
  return store.get().weeks[key];
}

/* Fetches (or generates, once) the schedule for the cursor's current slot. The record is keyed by the
   cursor date and persists as-is until it's complete -- that persistence IS the "unfinished day shifts
   forward" behaviour, since nothing regenerates it just because the calendar moved on. */
function ensureDay(pc, week, state, force = false) {
  const cursor = pc.cursor;
  const existing = state.days[cursor];
  if (existing && !force) return existing;
  const wd = P.weekday(cursor);
  const topics = week.days[wd] || week.days[Math.max(...Object.keys(week.days).map(Number))] || [];
  const skipped = existing ? existing.skipped || [] : [];
  const gen = P.genDay({ date: todayISO(), topics, cfg: pc.cfg, pools: pc.pools, probs: state.probs, skipped, excludeIds: pc.cfg.stash || [] });
  const rec = { t: Date.now(), topics, skipped, items: gen.items.map(i => ({ id: i.id, slot: i.slot, mins: i.mins, topic: i.topic })) };
  store.commit(s => { s.days[cursor] = rec; });
  return store.get().days[cursor];
}

/* Moves the cursor forward past every already-complete slot (and any non-study weekday), without
   generating anything new. Finishing today's list steps it forward by one; finishing tomorrow's too,
   in the same sitting, steps it forward again -- the "shift in reverse" is just this loop running twice. */
function advanceCursor(pc, state) {
  let cursor = pc.cursor, moved = false;
  const today = todayISO();
  for (let guard = 0; guard < 60; guard++) {
    if (!(pc.cfg.days || []).includes(P.weekday(cursor))) { cursor = P.addDays(cursor, 1); moved = true; continue; }
    const rec = state.days[cursor];
    if (rec && P.dayComplete(rec, state.probs, P.listSince(cursor, today))) { cursor = P.addDays(cursor, 1); moved = true; continue; }
    break;
  }
  if (moved) store.commit(s => { s.plan.cursor = cursor; s.plan.t = Date.now(); });
  return cursor;
}

const isDone = (state, id, date) => P.doneOn(state.probs[id], date);

/* Mark a problem solved / struggled. The previous record is kept so that "Undo" can restore it exactly. */
export function record(id, outcome) {
  store.commit(s => {
    const old = s.probs[id];
    const before = old ? Object.assign({}, old) : null;
    if (before) delete before.prev;
    s.probs[id] = Object.assign(nextProblem(old, outcome), { note: (old || {}).note || "", code: (old || {}).code || "", notes: (old || {}).notes || "", tries: ((old || {}).tries || 0) + 1, prev: before });
  });
  store.bump("probs");
}

/* Popup shown right after marking a problem done/struggled: paste the LeetCode solution and jot notes
   (what clicked, what tripped you up) for a quick revision pass before the interview. Both are optional. */
export function openLogModal(id, title, ctx) {
  const p = store.get().probs[id] || {};
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = '<div class="modal" role="dialog" aria-label="Save your solution"><div class="modal-h"><span class="modal-ic">' + icon("code", 18) + '</span><div><h3>Save your solution</h3><p class="small muted">' + esc(title || id) + '</p></div><button class="iconbtn" id="logx" aria-label="Close">' + icon("close", 18) + "</button></div>" +
    '<label class="field-l" for="logcode">Code</label><textarea id="logcode" class="mono" rows="9" spellcheck="false" placeholder="Paste your solution from LeetCode…">' + esc(p.code || "") + "</textarea>" +
    '<label class="field-l" for="lognotes">Notes &mdash; understanding, mistakes made</label>' +
    '<textarea id="lognotes" rows="4" placeholder="What was the key insight? What tripped you up?">' + esc(p.notes || "") + "</textarea>" +
    '<div class="modal-f"><span class="small muted">Optional &mdash; you can add it later.</span><div class="row"><button class="btn ghost" id="logskip">Add later</button><button class="btn primary" id="logsave">' + icon("check", 16) + "Save</button></div></div></div>";
  document.body.appendChild(bg);
  const onKey = e => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  };
  const close = () => { document.removeEventListener("keydown", onKey); bg.classList.add("out"); setTimeout(() => bg.remove(), 200); };
  const save = () => {
    const code = $("#logcode", bg).value, notes = $("#lognotes", bg).value;
    store.commit(s => { if (s.probs[id]) Object.assign(s.probs[id], { code, notes, t: Date.now() }); });
    close();
    ctx.toast("Solution saved.");
    ctx.rerender();
  };
  document.addEventListener("keydown", onKey);
  bg.addEventListener("mousedown", e => { if (e.target === bg) close(); });
  $("#logskip", bg).onclick = close;
  $("#logx", bg).onclick = close;
  $("#logsave", bg).onclick = save;
  setTimeout(() => { const t = $("#logcode", bg); if (t && matchMedia("(pointer: fine)").matches) t.focus(); }, 60);
}
export function undo(id) {
  store.commit(s => {
    const p = s.probs[id];
    if (!p) return;
    const now = Date.now(), back = p.prev;
    // a fresh t (not an older one) so the undo also wins when devices sync
    s.probs[id] = back ? Object.assign({}, back, { t: now, c: back.c !== undefined ? back.c : back.t || 0 }) : { st: "todo", n: 0, d: dayNum(), t: now, c: 0, tries: 0, note: "" };
  });
  store.bump("probs", -1);
}

export function rebuildWeek(D, date) {
  const state = store.get();
  const pc = P.contextFor(D, state, date);
  const prev = state.weeks[P.addDays(pc.monday, -7)];
  const week = P.genWeek({ weekKey: pc.monday, weekIdx: pc.weekIdx, plan: D.plan, cfg: pc.cfg, pools: pc.pools, probs: state.probs, today: dayNum(), prevWeek: prev ? prev.days : null, review: pc.review });
  // a fresh timestamp (not a delete) so the rebuilt week also wins when devices sync
  store.commit(s => { s.weeks[pc.monday] = { t: Date.now(), days: week }; });
}

const topicLabel = (D, t) => (D.plan.topics.find(x => x.id === t) || { label: t }).label;
const tchip = (D, t, href) => '<' + (href ? 'a href="' + href + '"' : "span") + ' class="tchip hued" style="--h:' + hue(t) + '">' + esc(shortLabel(D.plan.topics.find(x => x.id === t)) || t) + "</" + (href ? "a" : "span") + ">";
function shortLabel(t) { return t ? (t.short || t.label) : ""; }

/* ------------------------------------------------------------------ overview */
function overview(el, ctx) {
  const { D } = ctx;
  const date = todayISO();
  let state = store.get();
  let pc = P.contextFor(D, state, date);
  if (!pc.configured) {
    el.innerHTML = '<section class="hero rise"><div class="hero-main"><div class="eyebrow">Weekly plan</div><h1>Your LeetCode, rotated for you.</h1>' +
      '<p class="lead">Tell the planner when your interview is and how you feel about each topic. It builds a fresh schedule every week &mdash; two topics a day, plus spaced re-solves of older problems.</p>' +
      '<ul class="checks"><li>' + icon("check", 15) + "Weekdays, ~90 minutes per day (adjustable)</li><li>" + icon("check", 15) + "Curated lists plus the problems from your study guides</li><li>" + icon("check", 15) + "Topics unlock week by week; the last two weeks switch to review mode</li></ul>" +
      '<div class="row"><a class="btn primary lg" href="#/plan/setup">Set up my plan ' + icon("arrow", 16) + "</a></div></div></section>";
    return;
  }
  ensureWeek(pc, state);
  // settle the cursor on whatever slot is actually current before drawing anything
  advanceCursor(pc, state);
  state = store.get();
  pc = P.contextFor(D, state, date);
  const week = ensureWeek(pc, state);
  const cursor = pc.cursor;
  const since = P.listSince(cursor, date);
  const cfg = pc.cfg;
  const daysLeft = cfg.interview ? P.diffDays(date, cfg.interview) : null;
  const totalWeeks = cfg.interview ? Math.max(1, Math.ceil(P.diffDays(cfg.start, cfg.interview) / 7)) : null;
  const behind = P.diffDays(cursor, date);                     // >0: catching up, <0: ahead of schedule
  const stashN = (cfg.stash || []).length;

  let h = '<header class="page-h rise"><div><div class="eyebrow">Week ' + (pc.weekIdx + 1) + (totalWeeks ? " of " + totalWeeks : "") + (pc.review ? " · review mode" : "") + "</div><h1>Plan</h1>" +
    '<p class="muted" style="margin:6px 0 0">' + (daysLeft != null ? (daysLeft >= 0 ? "<b class=\"ink\">" + plural(daysLeft, "day") + "</b> to your interview" : "Your interview date has passed") : "No interview date set") + "</p></div>" +
    '<div class="row" style="gap:6px"><a class="btn sm" href="#/plan/stash">' + icon("archive", 15) + "Stash" + (stashN ? '<span class="count">' + stashN + "</span>" : "") + "</a>" +
    '<a class="btn sm" href="#/plan/review">' + icon("code", 15) + 'Review</a><a class="btn sm" href="#/plan/setup" aria-label="Plan settings" title="Plan settings">' + icon("gear", 15) + "</a></div></header>";

  /* ---- today (the cursor's slot, whichever real day it's shown on) */
  const rec = ensureDay(pc, week, state);
  state = store.get();
  if (rec) {
    const items = rec.items.map(i => Object.assign({}, pc.byId[i.id] || { id: i.id, title: i.id, diff: "medium", kind: "lc", url: "https://leetcode.com/problemset/?search=" + encodeURIComponent(i.id) }, { slot: i.slot, mins: i.mins }));
    const doneCount = items.filter(i => isDone(state, i.id, since)).length;
    const totalMin = items.reduce((a, b) => a + b.mins, 0);
    h += '<section class="today-card rise d1"><div class="today-h">' + ring(items.length ? doneCount / items.length : 0, { size: 68, stroke: 7, label: doneCount + "/" + items.length }) +
      '<div class="today-t"><div class="eyebrow">' + DAY_NAMES[P.weekday(cursor)] + " · " + cursor.slice(5).replace("-", "/") + "</div><h2>Today’s list</h2>" +
      '<div class="row" style="gap:6px;margin-top:6px">' + rec.topics.map(t => tchip(D, t)).join("") + '<span class="small muted">· about ' + totalMin + " min</span></div></div></div>";
    if (behind > 0) h += '<div class="banner warn">' + icon("sync", 15) + "<span>Catching up &mdash; this list was scheduled " + plural(behind, "day") + " ago. Finish it and the rest of the queue moves up.</span></div>";
    else if (behind < 0) h += '<div class="banner good">' + icon("bolt", 15) + "<span>You’re " + plural(-behind, "day") + " ahead of schedule. Nice.</span></div>";
    h += '<div class="plist">' + (items.length ? items.map(i => itemHTML(i, isDone(state, i.id, since), state.probs[i.id])).join("") : '<div class="empty">' + icon("trophy", 28) + "<b>Nothing left to schedule</b>Every problem in these topics is solved.</div>") + "</div>";
    h += '<div class="today-f"><button class="btn sm ghost" id="regen">' + icon("sync", 14) + 'Rebuild list</button><span class="small muted">Finish every item and the next slot moves up automatically.</span></div></section>';
  }

  /* ---- week strip */
  h += '<div class="sec-h"><h2>This week</h2></div><div class="week stagger">';
  for (const d of [1, 2, 3, 4, 5, 6, 7]) {
    const dd = P.addDays(pc.monday, d - 1);
    const on = (cfg.days || []).includes(d);
    const topics = on ? week.days[d] || [] : [];
    const log = state.log[dd];
    const worked = log && log.probs > 0;
    h += '<div class="wd' + (dd === cursor ? " now" : "") + (on ? "" : " off") + '"><div class="wd-h"><b>' + DAY_NAMES[d] + "</b><span>" + (+dd.slice(8)) + (worked ? '<i class="wd-ok">' + icon("check", 11) + "</i>" : "") + "</span></div>" +
      (on ? topics.map(t => tchip(D, t, "#/topics/" + t + "/problems")).join("") : '<span class="rest">rest</span>') + "</div>";
  }
  h += "</div>";

  /* ---- coverage */
  h += '<div class="sec-h"><h2>Topic coverage</h2><span class="small muted">solved / total</span></div><div class="cov stagger">';
  const now = dayNum();
  for (const t of D.plan.topics) {
    const s = P.topicStats(pc.pools[t.id], state.probs, now);
    const locked = pc.weekIdx < t.unlock && !(cfg.levels[t.id] > 0);
    const pct = Math.round(100 * s.solved / Math.max(1, s.total));
    h += '<a class="covi hued' + (locked ? " locked" : "") + '" href="#/topics/' + t.id + '/problems" style="--h:' + hue(t.id) + '"><div class="covi-t"><span class="tdot"></span><span>' + esc(t.label) + "</span><small>" + s.solved + "/" + s.total + "</small></div>" +
      '<div class="bar tint"><i style="width:' + pct + '%"></i></div><div class="covi-m">' + (locked ? icon("lock", 12) + "Unlocks in week " + (t.unlock + 1) : s.due ? s.due + " due for a re-solve" : pct + "% solved") + "</div></a>";
  }
  h += "</div>";
  el.innerHTML = h;
  justTicked = null;
  bindItems(el, ctx, cursor, pc.byId);
  const regen = $("#regen", el);
  if (regen) regen.onclick = () => { if (confirm("Rebuild this list? Items you already finished stay done.")) { ensureDay(pc, week, store.get(), true); ctx.rerender(); } };
}

function itemHTML(i, done, st) {
  const meta = [i.lc ? esc(i.lc) : "", esc(SLOT_LABEL[i.slot] || ""), "~" + i.mins + " min", i.premium ? "Premium" : ""].filter(Boolean).join(" · ");
  const saved = st && ((st.code || "").trim() || (st.notes || "").trim());
  let h = '<div class="pitem' + (done ? " done" : "") + '" data-id="' + esc(i.id) + '"><div class="prow">' +
    '<button class="tick' + (done ? " on" : "") + (i.id === justTicked ? " pop" : "") + '" data-act="' + (done ? "undo" : "clean") + '" aria-label="' + (done ? "Mark as not done" : "Mark as done") + '" title="' + (done ? "Undo" : "Mark done") + '">' + icon("check", 15) + "</button>" +
    '<a class="ptitle" href="' + esc(i.url) + '" target="_blank" rel="noopener"><b>' + esc(i.title) + '<span class="ext">' + icon("ext", 13) + '</span></b><span class="small muted">' + meta + "</span></a>" +
    '<span class="tag ' + i.diff + '">' + i.diff + "</span></div>";
  if (done) {
    const when = st && st.st === "revisit" ? "Back tomorrow to revisit" : st && st.d ? "Comes back in " + plural(Math.max(0, st.d - dayNum()), "day") : "Done";
    h += '<div class="pdone">' + icon("check", 13) + "<span>" + when + "</span>" + (saved ? '<span class="dotsep"></span><button class="linkbtn" data-act="log">' + icon("code", 12) + "Solution saved</button>" : '<span class="dotsep"></span><button class="linkbtn" data-act="log">Add solution</button>') + "</div>";
  } else {
    h += '<div class="pact"><button class="btn sm ghost" data-act="hard">' + icon("alert", 14) + 'Struggled</button><button class="btn sm ghost" data-act="skip">' + icon("skip", 14) + 'Skip</button><button class="btn sm ghost" data-act="stash">' + icon("archive", 14) + "Stash</button></div>";
  }
  return h + "</div>";
}

function bindItems(el, ctx, cursor, byId) {
  $$(".pitem [data-act]", el).forEach(b => b.onclick = e => {
    e.preventDefault();
    const box = b.closest(".pitem"), id = box.dataset.id, act = b.dataset.act;
    const title = (byId[id] || {}).title || id;
    if (act === "clean" || act === "hard") {
      record(id, act === "clean" ? "solved" : "struggled");
      justTicked = id;
      const st = store.get(), rec = st.days[cursor];
      if (rec && P.dayComplete(rec, st.probs, P.listSince(cursor, todayISO()))) {
        const r = b.getBoundingClientRect();
        confetti({ x: r.left + r.width / 2, y: r.top });
        ctx.toast("List complete — the next slot moves up.");
      } else ctx.toast(act === "clean" ? "Marked done. It will come back for a re-solve." : "Marked to revisit tomorrow.");
      openLogModal(id, title, ctx);
      ctx.rerender();
    }
    else if (act === "log") openLogModal(id, title, ctx);
    else if (act === "undo") { undo(id); ctx.rerender(); }
    else if (act === "skip") {
      const state = store.get(), pc = P.contextFor(ctx.D, state, cursor);
      store.commit(s => {
        const rec = s.days[cursor]; if (!rec) return;
        const item = rec.items.find(x => x.id === id);
        rec.skipped = (rec.skipped || []).concat(id);
        const used = rec.items.map(x => x.id).concat(rec.skipped);
        const rep = item && item.slot !== "resolve" ? P.nextFor(pc.pools, s.probs, item.topic, used) : null;
        rec.items = rec.items.filter(x => x.id !== id);
        if (rep) rec.items.push({ id: rep.id, slot: item.slot, mins: P.MINUTES[rep.diff], topic: item.topic });
        rec.t = Date.now();
      });
      ctx.toast("Skipped.");
      ctx.rerender();
    }
    else if (act === "stash") {
      store.commit(s => {
        const rec = s.days[cursor]; if (!rec) return;
        rec.items = rec.items.filter(x => x.id !== id);
        rec.t = Date.now();
        const stash = s.plan.stash || [];
        if (!stash.includes(id)) s.plan.stash = stash.concat(id);
        s.plan.t = Date.now();
      });
      ctx.toast("Stashed — solve it whenever you like.");
      ctx.rerender();
    }
  });
}

/* ------------------------------------------------------------------ stash */
function stashView(el, ctx) {
  const { D } = ctx;
  const state = store.get();
  const pc = P.contextFor(D, state, todayISO());
  const ids = pc.cfg.stash || [];
  let h = '<a class="backlink" href="#/plan">' + icon("back", 16) + 'Plan</a><header class="page-h"><div><h1>Stash</h1><p class="lead" style="margin-bottom:0">Problems you set aside on purpose. They don’t block a day or get carried into one &mdash; solve them whenever you have spare time.</p></div></header>';
  if (!ids.length) { h += '<div class="empty">' + icon("archive", 28) + "<b>Your stash is empty</b>Tap “Stash” on a problem in today’s list to park it here for later.</div>"; el.innerHTML = h; return; }
  h += '<ul class="list stagger">' + ids.map(id => {
    const p = pc.byId[id];
    const title = p ? p.title : id, url = p ? p.url : "https://leetcode.com/problemset/?search=" + encodeURIComponent(id), diff = p ? p.diff : "medium", lc = p ? p.lc : "", topic = p ? p.topic : "";
    return '<li class="trow wrap">' + (topic ? '<span class="lidot hued" style="--h:' + hue(topic) + '"></span>' : "") + '<a class="ptitle" href="' + esc(url) + '" target="_blank" rel="noopener"><b>' + esc(title) + '<span class="ext">' + icon("ext", 13) + '</span></b><span class="small muted">' + [lc, topic ? topicLabel(D, topic) : ""].filter(Boolean).map(esc).join(" · ") + "</span></a>" +
      '<span class="tag ' + diff + '">' + diff + '</span><div class="row" style="gap:6px"><button class="btn sm primary" data-done="' + esc(id) + '">' + icon("check", 14) + 'Done</button><button class="btn sm ghost" data-return="' + esc(id) + '">Return to schedule</button></div></li>';
  }).join("") + "</ul>";
  el.innerHTML = h;
  $$("[data-done]", el).forEach(b => b.onclick = () => {
    const id = b.dataset.done, p = pc.byId[id];
    record(id, "solved");
    store.commit(s => { s.plan.stash = (s.plan.stash || []).filter(x => x !== id); s.plan.t = Date.now(); });
    ctx.toast("Nice — marked done.");
    openLogModal(id, p ? p.title : id, ctx);
    ctx.rerender();
  });
  $$("[data-return]", el).forEach(b => b.onclick = () => {
    const id = b.dataset.return;
    store.commit(s => { s.plan.stash = (s.plan.stash || []).filter(x => x !== id); s.plan.t = Date.now(); });
    ctx.toast("Back in rotation.");
    ctx.rerender();
  });
}

/* ------------------------------------------------------------------ review (saved code + notes) */
function reviewView(el, ctx) {
  const { D } = ctx;
  const state = store.get();
  const pc = P.contextFor(D, state, todayISO());
  let h = '<a class="backlink" href="#/plan">' + icon("back", 16) + 'Plan</a><header class="page-h"><div><h1>Review your solutions</h1><p class="lead" style="margin-bottom:0">Code and notes you saved when ticking problems off &mdash; a quick last pass before the interview.</p></div></header>';
  const rows = [], seen = new Set();
  for (const tid of Object.keys(pc.pools)) for (const p of pc.pools[tid]) {
    const pr = state.probs[p.id];
    if (seen.has(p.id)) continue;
    if (pr && pr.st !== "todo" && ((pr.code || "").trim() || (pr.notes || "").trim())) { seen.add(p.id); rows.push({ p, pr, tid }); }
  }
  if (!rows.length) { h += '<div class="empty">' + icon("code", 28) + "<b>Nothing saved yet</b>When you tick a problem off, paste your code and jot notes &mdash; they’ll collect here.</div>"; el.innerHTML = h; return; }
  h += '<label class="findw">' + icon("search", 16) + '<input type="search" class="find" id="find" placeholder="Search your solutions" autocomplete="off"></label>';
  const byTopic = new Map();
  for (const r of rows) { if (!byTopic.has(r.tid)) byTopic.set(r.tid, []); byTopic.get(r.tid).push(r); }
  for (const [tid, list] of byTopic) {
    h += '<div class="igroup hued" style="--h:' + hue(tid) + '"><div class="ghead"><b><span class="tdot"></span>' + esc(topicLabel(D, tid)) + '</b><span class="tag">' + list.length + "</span></div>";
    for (const { p, pr } of list) {
      h += '<details class="irow"><summary><span class="stext">' + esc(p.title) + '</span><span class="tag ' + p.diff + '">' + p.diff + "</span></summary><div class=\"ibody\">" +
        (pr.notes && pr.notes.trim() ? '<div class="explain">' + icon("sparkle", 16) + "<div>" + esc(pr.notes).replace(/\n/g, "<br>") + "</div></div>" : "") +
        (pr.code && pr.code.trim() ? "<pre><code>" + esc(pr.code) + "</code></pre>" : '<p class="muted small">No code saved.</p>') +
        '<div class="row"><a class="link small" href="' + esc(p.url) + '" target="_blank" rel="noopener">Open on LeetCode ' + icon("ext", 13) + '</a><button class="linkbtn" data-edit="' + esc(p.id) + '">Edit</button></div></div></details>';
    }
    h += "</div>";
  }
  el.innerHTML = h;
  const inp = $("#find", el);
  inp.oninput = () => {
    const term = inp.value.trim().toLowerCase();
    $$(".irow", el).forEach(r => { r.hidden = !!term && !r.textContent.toLowerCase().includes(term); });
    $$(".igroup", el).forEach(g => { g.hidden = !$$(".irow", g).some(r => !r.hidden); });
  };
  $$("[data-edit]", el).forEach(b => b.onclick = () => { const p = pc.byId[b.dataset.edit]; openLogModal(b.dataset.edit, p ? p.title : b.dataset.edit, ctx); });
}

/* ------------------------------------------------------------------ setup */
function setup(el, ctx) {
  const { D } = ctx;
  const state = store.get();
  const date = todayISO();
  const cfg = Object.assign(P.defaultPlan(date), state.plan && state.plan.t ? state.plan : {}, { levels: Object.assign({}, state.plan && state.plan.levels) });
  const draw = () => {
    let h = '<a class="backlink" href="#/plan">' + icon("back", 16) + 'Plan</a><header class="page-h"><div><h1>Plan settings</h1><p class="lead" style="margin-bottom:0">Tune the schedule to your time and how you feel about each topic.</p></div></header>';
    h += '<div class="card"><div class="card-h">' + icon("target", 18) + '<b>Schedule</b></div>' +
      '<label class="field-l" for="iv">Interview date</label><input class="input" type="date" id="iv" value="' + esc(cfg.interview || "") + '">' +
      '<label class="field-l">Time per study day: <b id="minv">' + cfg.minutes + '</b> min</label><input type="range" id="mins" min="45" max="180" step="15" value="' + cfg.minutes + '">' +
      '<label class="field-l">Study days</label><div class="chips" id="days" style="margin-top:8px">' + [1, 2, 3, 4, 5, 6, 7].map(d => '<button class="chip' + (cfg.days.includes(d) ? " on" : "") + '" data-d="' + d + '">' + DAY_NAMES[d] + "</button>").join("") + "</div></div>";
    h += '<div class="card"><div class="card-h">' + icon("topics", 18) + '<b>How comfortable are you with each topic?</b></div><p class="small muted" style="margin:6px 0 14px">&ldquo;Learning&rdquo; unlocks a topic now and gives it extra time. &ldquo;Not started&rdquo; topics unlock week by week. &ldquo;Comfortable&rdquo; topics get less time.</p><div class="lvls">';
    for (const t of D.plan.topics) {
      const lv = cfg.levels[t.id] || 0;
      h += '<div class="lvl hued" style="--h:' + hue(t.id) + '"><div class="lvl-t"><span class="tdot"></span><b>' + esc(t.label) + '</b><span class="small muted">unlocks week ' + (t.unlock + 1) + '</span></div><div class="chips" data-topic="' + t.id + '">' +
        P.LEVELS.map((l, i) => '<button class="chip' + (lv === i ? " on" : "") + '" data-l="' + i + '">' + l + "</button>").join("") + "</div></div>";
    }
    h += "</div></div>";
    h += '<div class="row sticky-actions"><button class="btn primary lg" id="save">' + icon("check", 16) + (state.plan && state.plan.t ? "Save changes" : "Start my plan") + "</button>" +
      (state.plan && state.plan.t ? '<button class="btn lg" id="newweek">' + icon("sync", 16) + "Rebuild this week</button>" : "") + "</div>";
    el.innerHTML = h;
    $("#iv", el).onchange = e => { cfg.interview = e.target.value; };
    $("#mins", el).oninput = e => { cfg.minutes = +e.target.value; $("#minv", el).textContent = cfg.minutes; };
    $$("#days .chip", el).forEach(c => c.onclick = () => { const d = +c.dataset.d; cfg.days = cfg.days.includes(d) ? cfg.days.filter(x => x !== d) : cfg.days.concat(d).sort(); c.classList.toggle("on"); });
    $$("[data-topic] .chip", el).forEach(c => c.onclick = () => {
      cfg.levels[c.parentElement.dataset.topic] = +c.dataset.l;
      $$(".chip", c.parentElement).forEach(x => x.classList.toggle("on", x === c));
    });
    $("#save", el).onclick = () => {
      if (!cfg.days.length) { ctx.toast("Pick at least one study day."); return; }
      const first = !(state.plan && state.plan.t);
      store.commit(s => { s.plan = Object.assign({}, cfg, { t: Date.now(), start: first ? date : cfg.start }); });
      rebuildWeek(D, date);
      ctx.toast(first ? "Plan created." : "Saved."); location.hash = "#/plan";
    };
    const nw = $("#newweek", el);
    if (nw) nw.onclick = () => { rebuildWeek(D, date); const st = store.get(), pc = P.contextFor(D, st, date), wk = st.weeks[pc.monday]; if (wk) ensureDay(pc, wk, st, true); ctx.toast("This week was rebuilt."); location.hash = "#/plan"; };
  };
  draw();
}
