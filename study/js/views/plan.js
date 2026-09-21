import * as store from "../store.js";
import { esc, plural, $, $$ } from "../util.js";
import { nextProblem, dayNum } from "../srs.js";
import * as P from "../plan.js";

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOT_LABEL = { resolve: "Re-solve", main: "Main topic", secondary: "Second topic", carry: "Carried over" };
const todayISO = () => P.iso(new Date());
const startOfDayMs = date => P.parse(date).setHours(0, 0, 0, 0);

export function render(el, r, ctx) {
  if (r.parts[1] === "setup") return setup(el, ctx);
  if (r.parts[1] === "topic") return topicPage(el, r.parts[2], ctx);
  return overview(el, ctx);
}

/* ------------------------------------------------------------------ persistence helpers */
function ensureWeek(pc, date, state) {
  const key = pc.monday;
  const existing = state.weeks[key];
  if (existing && existing.days) return existing;
  const prev = state.weeks[P.addDays(key, -7)];
  const week = P.genWeek({ weekKey: key, weekIdx: pc.weekIdx, plan: pc.plan, cfg: pc.cfg, pools: pc.pools, probs: state.probs, today: dayNum(), prevWeek: prev ? prev.days : null, review: pc.review });
  store.commit(s => { s.weeks[key] = { t: Date.now(), days: week }; });
  return store.get().weeks[key];
}

function ensureDay(pc, date, week, state, force = false) {
  const existing = state.days[date];
  if (existing && !force) return existing;
  const wd = P.weekday(date);
  const topics = week.days[wd] || week.days[Math.max(...Object.keys(week.days).map(Number))] || [];
  // carry over the last unfinished items from the most recent earlier day
  let carry = [];
  for (let back = 1; back <= 3 && !carry.length; back++) {
    const prev = state.days[P.addDays(date, -back)];
    if (prev) carry = prev.items.filter(i => i.slot !== "resolve" && !isDone(state, i.id, P.addDays(date, -back))).map(i => i.id);
  }
  const skipped = existing ? existing.skipped || [] : [];
  const gen = P.genDay({ date, topics, cfg: pc.cfg, pools: pc.pools, probs: state.probs, carry, skipped });
  const rec = { t: Date.now(), topics, skipped, items: gen.items.map(i => ({ id: i.id, slot: i.slot, mins: i.mins, topic: i.topic })) };
  store.commit(s => { s.days[date] = rec; });
  return rec;
}

const isDone = (state, id, date) => { const p = state.probs[id]; return !!p && p.st !== "todo" && (p.t || 0) >= startOfDayMs(date); };

function record(pcProb, outcome) {
  store.commit(s => {
    const old = s.probs[pcProb];
    s.probs[pcProb] = Object.assign(nextProblem(old, outcome), { note: (old || {}).note || "", tries: ((old || {}).tries || 0) + 1 });
  });
  store.bump("probs");
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
  const state = store.get();
  const date = todayISO();
  const pc = P.contextFor(D, state, date);
  if (!pc.configured) {
    el.innerHTML = '<h2>Weekly plan</h2><div class="card"><p>Your LeetCode practice, rotated for you. Tell the planner when your interview is and how you feel about each topic, and it builds a fresh weekly schedule &mdash; two topics a day, mixed every week, plus a spaced re-solve of older problems.</p>' +
      '<ul class="small muted"><li>Weekdays, ~90 minutes per day (adjustable)</li><li>Problems come from the curated lists <b>and</b> your in-app practice problems</li><li>New topics unlock week by week; the last two weeks switch to review mode</li></ul>' +
      '<a class="btn primary block" href="#/plan/setup">Set up my plan</a></div>';
    return;
  }
  const cfg = pc.cfg;
  const daysLeft = cfg.interview ? P.diffDays(date, cfg.interview) : null;
  const totalWeeks = cfg.interview ? Math.max(1, Math.ceil(P.diffDays(cfg.start, cfg.interview) / 7)) : null;
  const week = ensureWeek(pc, date, state);
  const studyDay = (cfg.days || []).includes(P.weekday(date));

  let h = '<h2>Weekly plan</h2><div class="card soft"><div class="row between"><div><b>Week ' + (pc.weekIdx + 1) + (totalWeeks ? " of " + totalWeeks : "") + "</b>" +
    (pc.review ? ' <span class="tag bad">review mode</span>' : "") + '<div class="small muted">' + (daysLeft != null ? (daysLeft >= 0 ? plural(daysLeft, "day") + " to your interview" : "interview date has passed") : "no interview date set") + "</div></div>" +
    '<a class="btn sm" href="#/plan/setup">Settings</a></div></div>';

  /* ---- today */
  h += "<h2>" + (studyDay ? "Today" : "Rest day") + " &middot; " + DAY_NAMES[P.weekday(date)] + " " + date.slice(5) + "</h2>";
  if (!studyDay) {
    h += '<div class="card"><p class="muted">Today is not one of your study days. A short flashcard review is plenty. Feeling energetic?</p><button class="btn" id="bonus">Plan a bonus session</button></div>';
  }
  const rec = studyDay || state.days[date] ? ensureDay(pc, date, week, state) : null;
  if (rec) {
    const st = store.get();
    const items = rec.items.map(i => Object.assign({}, pc.byId[i.id] || { id: i.id, title: i.id, diff: "medium", kind: "lc" }, { slot: i.slot, mins: i.mins }));
    const doneCount = items.filter(i => isDone(st, i.id, date)).length;
    const totalMin = items.reduce((a, b) => a + b.mins, 0);
    h += '<div class="row between small muted" style="margin-bottom:8px"><span>' + doneCount + " of " + items.length + " done &middot; about " + totalMin + " min</span><span>topics: " +
      rec.topics.map(t => esc((D.plan.topics.find(x => x.id === t) || { label: t }).label)).join(" + ") + "</span></div>";
    h += '<div class="bar" style="margin-bottom:12px"><i style="width:' + (items.length ? Math.round(100 * doneCount / items.length) : 0) + '%"></i></div>';
    h += items.map(i => itemHTML(i, isDone(st, i.id, date), st.probs[i.id])).join("");
    h += '<div class="row" style="margin:8px 0 4px"><button class="btn sm" id="regen">Rebuild today&rsquo;s list</button>' +
      '<span class="small muted">Unfinished items carry over to your next study day.</span></div>';
  }

  /* ---- week grid */
  h += "<h2>This week</h2><div class=\"week\">";
  for (const d of [1, 2, 3, 4, 5, 6, 7]) {
    const dd = P.addDays(pc.monday, d - 1);
    const on = (cfg.days || []).includes(d);
    const topics = on ? week.days[d] || [] : [];
    const log = state.log[dd];
    const worked = log && log.probs > 0;
    h += '<div class="wd' + (dd === date ? " now" : "") + (on ? "" : " off") + '"><b>' + DAY_NAMES[d] + (worked ? " &#10003;" : "") + "</b>" +
      (on ? topics.map(t => '<a href="#/plan/topic/' + t + '">' + esc(shortLabel(D.plan.topics.find(x => x.id === t))) + "</a>").join("") : "<span>rest</span>") + "</div>";
  }
  h += "</div>";

  /* ---- coverage */
  h += "<h2>Topic coverage</h2>";
  const now = dayNum();
  for (const t of D.plan.topics) {
    const s = P.topicStats(pc.pools[t.id], state.probs, now);
    const locked = pc.weekIdx < t.unlock && !(cfg.levels[t.id] > 0);
    h += '<a class="li" href="#/plan/topic/' + t.id + '" style="' + (locked ? "opacity:.55" : "") + '"><div class="t"><b>' + esc(t.label) + '</b><small>' + s.solved + " of " + s.total + " solved" + (s.due ? " &middot; " + s.due + " due" : "") + (locked ? " &middot; unlocks in week " + (t.unlock + 1) : "") + '</small></div><div style="width:90px"><div class="bar"><i style="width:' + Math.round(100 * s.solved / Math.max(1, s.total)) + '%"></i></div></div></a>';
  }
  el.innerHTML = h;
  bindItems(el, ctx, date);
  const regen = $("#regen", el);
  if (regen) regen.onclick = () => { if (confirm("Rebuild today's list? Items you already finished stay done.")) { ensureDay(pc, date, week, store.get(), true); ctx.rerender(); } };
  const bonus = $("#bonus", el);
  if (bonus) bonus.onclick = () => {
    const keys = Object.keys(week.days).map(Number), last = week.days[Math.max(...keys)] || [];
    const gen = P.genDay({ date, topics: last, cfg: pc.cfg, pools: pc.pools, probs: store.get().probs });
    store.commit(s => { s.days[date] = { t: Date.now(), topics: last, skipped: [], items: gen.items.map(i => ({ id: i.id, slot: i.slot, mins: i.mins, topic: i.topic })) }; });
    ctx.rerender();
  };
}

function shortLabel(t) { return t ? (t.short || t.label) : "?"; }

function itemHTML(i, done, st) {
  const app = i.kind === "app";
  const tag = '<span class="tag ' + i.diff + '">' + i.diff + "</span>";
  let h = '<div class="pitem' + (done ? " done" : "") + '" data-id="' + esc(i.id) + '" data-kind="' + i.kind + '"><div class="row between"><div style="min-width:0"><b>' + esc(i.title) + '</b><div class="small muted">' +
    (i.lc ? esc(i.lc) + " &middot; " : "") + esc(SLOT_LABEL[i.slot] || "") + " &middot; ~" + i.mins + " min" + (app ? " &middot; in-app" : "") + "</div></div><div>" + tag + "</div></div>";
  if (done) h += '<div class="small" style="color:var(--good);margin-top:6px">&#10003; Done' + (st && st.d ? " &middot; back in " + Math.max(0, st.d - dayNum()) + "d" : "") + "</div>";
  else {
    h += '<div class="row" style="margin-top:8px">';
    if (app) h += '<a class="btn primary sm" href="#/practice/py/' + esc(i.id) + '">Solve in app</a>';
    else h += '<a class="btn primary sm" href="' + esc(i.url) + '" target="_blank" rel="noopener">Open on LeetCode &#8599;</a><button class="btn sm" data-act="clean">Solved</button><button class="btn sm" data-act="hard">Struggled</button>';
    h += '<button class="btn sm ghost" data-act="skip">Skip</button></div>';
  }
  return h + "</div>";
}

function bindItems(el, ctx, date) {
  $$(".pitem [data-act]", el).forEach(b => b.onclick = () => {
    const box = b.closest(".pitem"), id = box.dataset.id, act = b.dataset.act;
    if (act === "clean" || act === "hard") { record(id, act === "clean" ? "solved" : "struggled"); ctx.toast(act === "clean" ? "Nice. It will come back for a re-solve." : "Marked to revisit tomorrow."); ctx.rerender(); }
    else if (act === "skip") {
      const state = store.get(), pc = P.contextFor(ctx.D, state, date);
      store.commit(s => {
        const rec = s.days[date]; if (!rec) return;
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
  });
}

/* ------------------------------------------------------------------ topic page */
function topicPage(el, tid, ctx) {
  const { D } = ctx;
  const topic = D.plan.topics.find(t => t.id === tid);
  if (!topic) { el.innerHTML = '<div class="empty"><b>Unknown topic</b><a class="btn" href="#/plan">Back</a></div>'; return; }
  const state = store.get();
  const pc = P.contextFor(D, state, todayISO());
  const pool = pc.pools[tid];
  const s = P.topicStats(pool, state.probs, dayNum());
  let h = '<a class="btn ghost sm" href="#/plan" style="margin-left:-8px">&larr; Plan</a><h2 style="margin-top:6px">' + esc(topic.label) + '</h2><p class="muted small">' + esc(topic.blurb) + "</p>" +
    '<div class="card soft"><b>' + s.solved + " / " + s.total + ' solved</b> <span class="small muted">&middot; ' + P.LEVELS[pc.cfg.levels[tid] || 0] + '</span><div class="bar" style="margin-top:8px"><i style="width:' + Math.round(100 * s.solved / Math.max(1, s.total)) + '%"></i></div></div><ul class="list">';
  for (const p of pool) {
    const st = state.probs[p.id];
    const solved = st && st.st !== "todo";
    h += '<li><div class="li" style="cursor:default"><div class="t"><b>' + esc(p.title) + '</b><small>' + (p.lc ? esc(p.lc) + " &middot; " : "") + (p.kind === "app" ? "in-app" : "LeetCode") + '</small></div><div class="r"><span class="tag ' + p.diff + '">' + p.diff + "</span> " +
      (solved ? '<span class="tag ' + (st.st === "revisit" ? "bad" : "ok") + '">' + (st.st === "revisit" ? "revisit" : "&#10003; ×" + st.n) + "</span>" : "") + "</div>" +
      (p.kind === "app" ? '<a class="btn sm" href="#/practice/py/' + esc(p.id) + '">Open</a>' : '<a class="btn sm" href="' + esc(p.url) + '" target="_blank" rel="noopener">Open &#8599;</a>' + '<button class="btn sm ghost" data-mark="' + esc(p.id) + '">' + (solved ? "Solved again" : "Mark solved") + "</button>") + "</div></li>";
  }
  el.innerHTML = h + "</ul>";
  $$("[data-mark]", el).forEach(b => b.onclick = () => { record(b.dataset.mark, "solved"); ctx.toast("Saved."); ctx.rerender(); });
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
    if (nw) nw.onclick = () => { rebuildWeek(D, date); const st = store.get(), pc = P.contextFor(D, st, date), wk = st.weeks[pc.monday]; if (wk && (pc.cfg.days || []).includes(P.weekday(date))) ensureDay(pc, date, wk, st, true); ctx.toast("This week was rebuilt."); location.hash = "#/plan"; };
  };
  draw();
}
