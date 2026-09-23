import * as store from "../store.js";
import { esc, plural, $, $$ } from "../util.js";
import { nextProblem, dayNum } from "../srs.js";
import * as P from "../plan.js";

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOT_LABEL = { resolve: "Re-solve", main: "Main topic", secondary: "Second topic", carry: "Carried over" };
const todayISO = () => P.iso(new Date());

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
  for (let guard = 0; guard < 60; guard++) {
    if (!(pc.cfg.days || []).includes(P.weekday(cursor))) { cursor = P.addDays(cursor, 1); moved = true; continue; }
    const rec = state.days[cursor];
    if (rec && P.dayComplete(rec, state.probs)) { cursor = P.addDays(cursor, 1); moved = true; continue; }
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
  bg.innerHTML = '<div class="modal"><h3 style="margin-top:0">Save your solution</h3>' +
    '<p class="small muted" style="margin-top:-6px">' + esc(title || id) + '</p>' +
    '<label class="small muted">Code</label><textarea id="logcode" class="mono" rows="8" placeholder="Paste your solution from LeetCode...">' + esc(p.code || "") + '</textarea>' +
    '<label class="small muted" style="margin-top:10px;display:block">Notes &mdash; understanding, mistakes made</label>' +
    '<textarea id="lognotes" rows="4" placeholder="What was the key insight? What tripped you up?">' + esc(p.notes || "") + '</textarea>' +
    '<div class="row" style="margin-top:14px"><button class="btn primary" id="logsave">Save</button><button class="btn ghost" id="logskip">Add later</button></div></div>';
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", e => { if (e.target === bg) close(); });
  $("#logskip", bg).onclick = close;
  $("#logsave", bg).onclick = () => {
    const code = $("#logcode", bg).value, notes = $("#lognotes", bg).value;
    store.commit(s => { if (s.probs[id]) Object.assign(s.probs[id], { code, notes, t: Date.now() }); });
    close();
    ctx.toast("Saved.");
  };
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

/* ------------------------------------------------------------------ overview */
function overview(el, ctx) {
  const { D } = ctx;
  const date = todayISO();
  let state = store.get();
  let pc = P.contextFor(D, state, date);
  if (!pc.configured) {
    el.innerHTML = '<h2>Weekly plan</h2><div class="card"><p>Your LeetCode practice, rotated for you. Tap a problem to open it on LeetCode, then tick it off here. Tell the planner when your interview is and how you feel about each topic, and it builds a fresh weekly schedule &mdash; two topics a day, mixed every week, plus a spaced re-solve of older problems.</p>' +
      '<ul class="small muted"><li>Weekdays, ~90 minutes per day (adjustable)</li><li>Problems come from the curated lists <b>and</b> the problems in your study guides</li><li>New topics unlock week by week; the last two weeks switch to review mode</li></ul>' +
      '<a class="btn primary block" href="#/plan/setup">Set up my plan</a></div>';
    return;
  }
  ensureWeek(pc, state);
  // settle the cursor on whatever slot is actually current before drawing anything
  advanceCursor(pc, state);
  state = store.get();
  pc = P.contextFor(D, state, date);
  const week = ensureWeek(pc, state);
  const cursor = pc.cursor;
  const cfg = pc.cfg;
  const daysLeft = cfg.interview ? P.diffDays(date, cfg.interview) : null;
  const totalWeeks = cfg.interview ? Math.max(1, Math.ceil(P.diffDays(cfg.start, cfg.interview) / 7)) : null;
  const behind = P.diffDays(cursor, date);                     // >0: catching up, <0: ahead of schedule

  let h = '<h2>Weekly plan</h2><div class="card soft"><div class="row between"><div><b>Week ' + (pc.weekIdx + 1) + (totalWeeks ? " of " + totalWeeks : "") + "</b>" +
    (pc.review ? ' <span class="tag bad">review mode</span>' : "") + '<div class="small muted">' + (daysLeft != null ? (daysLeft >= 0 ? plural(daysLeft, "day") + " to your interview" : "interview date has passed") : "no interview date set") + "</div></div>" +
    '<a class="btn sm" href="#/plan/setup">Settings</a></div></div>';
  h += '<div class="row between small" style="margin:-4px 0 4px"><a href="#/plan/stash">Stash' + ((cfg.stash || []).length ? " (" + cfg.stash.length + ")" : "") + '</a><a href="#/plan/review">Review my solutions</a></div>';

  /* ---- today (the cursor's slot, whichever real day it's shown on) */
  h += "<h2>Today&rsquo;s list &middot; " + DAY_NAMES[P.weekday(cursor)] + " " + cursor.slice(5) + "</h2>";
  if (behind > 0) h += '<p class="small muted" style="margin-top:-6px">Catching up &mdash; this was scheduled ' + plural(behind, "day") + " ago. Finish it and the rest of the queue moves up.</p>";
  else if (behind < 0) h += '<p class="small muted" style="margin-top:-6px">You&rsquo;re ' + plural(-behind, "day") + " ahead of schedule.</p>";
  const rec = ensureDay(pc, week, state);
  state = store.get();
  if (rec) {
    const items = rec.items.map(i => Object.assign({}, pc.byId[i.id] || { id: i.id, title: i.id, diff: "medium", kind: "lc", url: "https://leetcode.com/problemset/?search=" + encodeURIComponent(i.id) }, { slot: i.slot, mins: i.mins }));
    const doneCount = items.filter(i => isDone(state, i.id, cursor)).length;
    const totalMin = items.reduce((a, b) => a + b.mins, 0);
    h += '<div class="row between small muted" style="margin-bottom:8px"><span>' + doneCount + " of " + items.length + " done &middot; about " + totalMin + " min</span><span>topics: " +
      rec.topics.map(t => esc((D.plan.topics.find(x => x.id === t) || { label: t }).label)).join(" + ") + "</span></div>";
    h += '<div class="bar" style="margin-bottom:12px"><i style="width:' + (items.length ? Math.round(100 * doneCount / items.length) : 0) + '%"></i></div>';
    h += items.map(i => itemHTML(i, isDone(state, i.id, cursor), state.probs[i.id])).join("");
    h += '<div class="row" style="margin:8px 0 4px"><button class="btn sm" id="regen">Rebuild this list</button>' +
      '<span class="small muted">Finish it all and the next slot shifts up automatically.</span></div>';
  }

  /* ---- week grid */
  h += "<h2>This week</h2><div class=\"week\">";
  for (const d of [1, 2, 3, 4, 5, 6, 7]) {
    const dd = P.addDays(pc.monday, d - 1);
    const on = (cfg.days || []).includes(d);
    const topics = on ? week.days[d] || [] : [];
    const log = state.log[dd];
    const worked = log && log.probs > 0;
    h += '<div class="wd' + (dd === cursor ? " now" : "") + (on ? "" : " off") + '"><b>' + DAY_NAMES[d] + (worked ? " &#10003;" : "") + "</b>" +
      (on ? topics.map(t => '<a href="#/topics/' + t + '/problems">' + esc(shortLabel(D.plan.topics.find(x => x.id === t))) + "</a>").join("") : "<span>rest</span>") + "</div>";
  }
  h += "</div>";

  /* ---- coverage */
  h += "<h2>Topic coverage</h2>";
  const now = dayNum();
  for (const t of D.plan.topics) {
    const s = P.topicStats(pc.pools[t.id], state.probs, now);
    const locked = pc.weekIdx < t.unlock && !(cfg.levels[t.id] > 0);
    h += '<a class="li" href="#/topics/' + t.id + '/problems" style="' + (locked ? "opacity:.55" : "") + '"><div class="t"><b>' + esc(t.label) + '</b><small>' + s.solved + " of " + s.total + " solved" + (s.due ? " &middot; " + s.due + " due" : "") + (locked ? " &middot; unlocks in week " + (t.unlock + 1) : "") + '</small></div><div style="width:90px"><div class="bar"><i style="width:' + Math.round(100 * s.solved / Math.max(1, s.total)) + '%"></i></div></div></a>';
  }
  el.innerHTML = h;
  bindItems(el, ctx, cursor, pc.byId);
  const regen = $("#regen", el);
  if (regen) regen.onclick = () => { if (confirm("Rebuild this list? Items you already finished stay done.")) { ensureDay(pc, week, store.get(), true); ctx.rerender(); } };
}

function shortLabel(t) { return t ? (t.short || t.label) : "?"; }

function itemHTML(i, done, st) {
  const tag = '<span class="tag ' + i.diff + '">' + i.diff + "</span>";
  const meta = (i.lc ? esc(i.lc) + " &middot; " : "") + esc(SLOT_LABEL[i.slot] || "") + " &middot; ~" + i.mins + " min" + (i.premium ? " &middot; LeetCode Premium" : "");
  let h = '<div class="pitem' + (done ? " done" : "") + '" data-id="' + esc(i.id) + '">' +
    '<div class="prow"><button class="tick' + (done ? " on" : "") + '" data-act="' + (done ? "undo" : "clean") + '" aria-label="' + (done ? "Mark as not done" : "Mark as done") + '" title="' + (done ? "Undo" : "Mark done") + '">' + (done ? "&#10003;" : "") + "</button>" +
    '<a class="ptitle" href="' + esc(i.url) + '" target="_blank" rel="noopener"><b>' + esc(i.title) + ' <span class="ext">&#8599;</span></b><span class="small muted">' + meta + "</span></a>" + tag + "</div>";
  if (done) h += '<div class="small pdone">&#10003; Done' + (st && st.st === "revisit" ? " &middot; marked to revisit tomorrow" : st && st.d ? " &middot; comes back in " + Math.max(0, st.d - dayNum()) + " days" : "") + "</div>";
  else h += '<div class="row pact"><button class="btn sm ghost" data-act="hard">Struggled</button><button class="btn sm ghost" data-act="skip">Skip</button><button class="btn sm ghost" data-act="stash">Stash</button></div>';
  return h + "</div>";
}

function bindItems(el, ctx, cursor, byId) {
  $$(".pitem [data-act]", el).forEach(b => b.onclick = () => {
    const box = b.closest(".pitem"), id = box.dataset.id, act = b.dataset.act;
    const title = (byId[id] || {}).title || id;
    if (act === "clean" || act === "hard") {
      record(id, act === "clean" ? "solved" : "struggled");
      ctx.toast(act === "clean" ? "Marked done. It will come back for a re-solve." : "Marked to revisit tomorrow.");
      openLogModal(id, title, ctx);
      ctx.rerender();
    }
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
  const date = todayISO();
  const pc = P.contextFor(D, state, date);
  const ids = pc.cfg.stash || [];
  let h = '<a class="btn ghost sm" href="#/plan" style="margin-left:-8px">&larr; Plan</a><h2 style="margin-top:6px">Stash</h2>' +
    '<p class="small muted">Problems you set aside on purpose so they don&rsquo;t block or get carried into a day&rsquo;s schedule. Solve them whenever you have spare time.</p>';
  if (!ids.length) { h += '<div class="empty"><b>Your stash is empty</b>Tap &ldquo;Stash&rdquo; on a problem in today&rsquo;s list to save it here for later.</div>'; el.innerHTML = h; return; }
  h += '<ul class="list">' + ids.map(id => {
    const p = pc.byId[id];
    const title = p ? p.title : id, url = p ? p.url : "https://leetcode.com/problemset/?search=" + encodeURIComponent(id), diff = p ? p.diff : "medium", lc = p ? p.lc : "";
    return '<li class="trow" style="flex-wrap:wrap"><a class="ptitle" href="' + esc(url) + '" target="_blank" rel="noopener"><b>' + esc(title) + ' <span class="ext">&#8599;</span></b><span class="small muted">' + (lc ? esc(lc) : "") + '</span></a>' +
      '<span class="tag ' + diff + '">' + diff + '</span><button class="btn sm" data-done="' + esc(id) + '">Done</button><button class="btn sm ghost" data-return="' + esc(id) + '">Return to schedule</button></li>';
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
  const date = todayISO();
  const pc = P.contextFor(D, state, date);
  let h = '<a class="btn ghost sm" href="#/plan" style="margin-left:-8px">&larr; Plan</a><h2 style="margin-top:6px">Review your solutions</h2>' +
    '<p class="small muted">Code and notes you saved when marking problems done &mdash; handy for a last pass before the interview.</p>';
  const rows = [];
  for (const tid of Object.keys(pc.pools)) for (const p of pc.pools[tid]) {
    const pr = state.probs[p.id];
    if (pr && pr.st !== "todo" && ((pr.code || "").trim() || (pr.notes || "").trim())) rows.push({ p, pr, tid });
  }
  if (!rows.length) { h += '<div class="empty"><b>Nothing saved yet</b>When you mark a problem done, you can paste your code and jot notes &mdash; they&rsquo;ll show up here.</div>'; el.innerHTML = h; return; }
  const byTopic = new Map();
  for (const r of rows) {
    const label = (D.plan.topics.find(x => x.id === r.tid) || {}).label || r.tid;
    if (!byTopic.has(label)) byTopic.set(label, []);
    byTopic.get(label).push(r);
  }
  for (const [label, list] of byTopic) {
    h += '<div class="igroup"><div class="ghead"><b>' + esc(label) + " <span class=\"muted\">(" + list.length + ")</span></b></div>";
    for (const { p, pr } of list) {
      h += '<details class="irow"><summary><span class="stext">' + esc(p.title) + '</span><span class="tag ' + p.diff + '">' + p.diff + "</span></summary><div class=\"ibody\">" +
        (pr.notes && pr.notes.trim() ? "<p><b>Notes:</b> " + esc(pr.notes).replace(/\n/g, "<br>") + "</p>" : "") +
        (pr.code && pr.code.trim() ? "<pre><code>" + esc(pr.code) + "</code></pre>" : '<p class="muted small">No code saved.</p>') +
        '<a class="small" href="' + esc(p.url) + '" target="_blank" rel="noopener">Open on LeetCode &#8599;</a></div></details>';
    }
    h += "</div>";
  }
  el.innerHTML = h;
}

/* ------------------------------------------------------------------ setup */
function setup(el, ctx) {
  const { D } = ctx;
  const state = store.get();
  const date = todayISO();
  const cfg = Object.assign(P.defaultPlan(date), state.plan && state.plan.t ? state.plan : {}, { levels: Object.assign({}, state.plan && state.plan.levels) });
  const draw = () => {
    let h = '<a class="btn ghost sm" href="#/plan" style="margin-left:-8px">&larr; Plan</a><h2 style="margin-top:6px">Plan settings</h2>';
    h += '<div class="card"><label class="small muted">Interview date</label><input type="date" id="iv" value="' + esc(cfg.interview || "") + '" style="display:block;width:100%;margin:6px 0 14px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--surface)">' +
      '<label class="small muted">Time per study day: <b id="minv">' + cfg.minutes + '</b> min</label><input type="range" id="mins" min="45" max="180" step="15" value="' + cfg.minutes + '" style="width:100%;margin:6px 0 14px">' +
      '<div class="small muted">Study days</div><div class="chips" id="days" style="margin-top:6px">' + [1, 2, 3, 4, 5, 6, 7].map(d => '<span class="chip' + (cfg.days.includes(d) ? " on" : "") + '" data-d="' + d + '">' + DAY_NAMES[d] + "</span>").join("") + "</div></div>";
    h += '<div class="card"><b>How comfortable are you with each topic?</b><p class="small muted" style="margin:4px 0 10px">&ldquo;Learning&rdquo; unlocks a topic now and gives it extra time. &ldquo;Not started&rdquo; topics unlock week by week. &ldquo;Comfortable&rdquo; topics get less time.</p>';
    for (const t of D.plan.topics) {
      const lv = cfg.levels[t.id] || 0;
      h += '<div style="margin-bottom:10px"><div class="small"><b>' + esc(t.label) + '</b> <span class="muted">(unlocks week ' + (t.unlock + 1) + ')</span></div><div class="chips" data-topic="' + t.id + '" style="margin-top:4px">' +
        P.LEVELS.map((l, i) => '<span class="chip' + (lv === i ? " on" : "") + '" data-l="' + i + '">' + l + "</span>").join("") + "</div></div>";
    }
    h += "</div>";
    h += '<div class="row"><button class="btn primary" id="save">' + (state.plan && state.plan.t ? "Save changes" : "Start my plan") + '</button>' +
      (state.plan && state.plan.t ? '<button class="btn" id="newweek">Rebuild this week</button>' : "") + "</div>";
    el.innerHTML = h;
    $("#iv", el).onchange = e => { cfg.interview = e.target.value; };
    $("#mins", el).oninput = e => { cfg.minutes = +e.target.value; $("#minv", el).textContent = cfg.minutes; };
    $$("#days .chip", el).forEach(c => c.onclick = () => { const d = +c.dataset.d; cfg.days = cfg.days.includes(d) ? cfg.days.filter(x => x !== d) : cfg.days.concat(d).sort(); c.classList.toggle("on"); });
    $$("[data-topic] .chip", el).forEach(c => c.onclick = () => { cfg.levels[c.parentElement.dataset.topic] = +c.dataset.l; draw(); });
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
