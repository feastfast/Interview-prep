import * as store from "../store.js";
import { esc, md, plural, $, $$ } from "../util.js";
import { nextProblem, dayNum, isoDay } from "../srs.js";

/* ============================================================ runtimes */
let worker = null, jobId = 0;

function startWorker() {
  worker = new Worker("js/py-worker.js");
  return worker;
}
export function runPython(code, spec, onState) {
  return new Promise(resolve => {
    if (!worker) startWorker();
    const id = ++jobId;
    let timer = null;
    const arm = ms => { clearTimeout(timer); timer = setTimeout(() => { worker.terminate(); worker = null; resolve({ timeout: true, results: [], stdout: "", error: "" }); }, ms); };
    arm(120000);                                       // first run downloads the interpreter
    worker.onmessage = e => {
      if (e.data.id !== id) return;
      if (e.data.status === "loading") { onState && onState("loading"); }
      else if (e.data.status === "running") { onState && onState("running"); arm(8000); }
      else { clearTimeout(timer); resolve(e.data.result); }
    };
    worker.onerror = err => { clearTimeout(timer); resolve({ results: [], stdout: "", error: String(err.message || "worker error") }); };
    worker.postMessage({ id, code, spec });
  });
}

let sqlLib = null;
async function loadSql() {
  if (sqlLib) return sqlLib;
  const base = "https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/";
  await new Promise((res, rej) => { const s = document.createElement("script"); s.src = base + "sql-wasm.js"; s.onload = res; s.onerror = () => rej(new Error("Could not load the SQL engine (offline?)")); document.head.appendChild(s); });
  sqlLib = await window.initSqlJs({ locateFile: f => base + f });
  return sqlLib;
}
function execSql(SQL, dataset, sql) {
  const db = new SQL.Database();
  try {
    db.run(dataset);
    const res = db.exec(sql);
    return res.length ? res[res.length - 1] : { columns: [], values: [] };
  } finally { db.close(); }
}
const normCell = v => v === null || v === undefined ? "NULL" : typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : String(v);
function sameResult(a, b, ordered) {
  if (a.columns.length !== b.columns.length) return "Expected " + b.columns.length + " column(s) but your query returns " + a.columns.length + ".";
  if (a.values.length !== b.values.length) return "Expected " + b.values.length + " row(s) but your query returns " + a.values.length + ".";
  const rowKey = r => r.map(normCell).join("");
  const ka = a.values.map(rowKey), kb = b.values.map(rowKey);
  const A = ordered ? ka : ka.slice().sort(), B = ordered ? kb : kb.slice().sort();
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return ordered ? "The rows differ (this problem checks the ORDER too)." : "The rows are not the same as the expected result.";
  return "";
}
function table(res, max = 30) {
  if (!res.columns.length) return '<p class="small muted">(no result set)</p>';
  return '<div class="scroll"><table class="rs"><thead><tr>' + res.columns.map(c => "<th>" + esc(c) + "</th>").join("") + "</tr></thead><tbody>" +
    res.values.slice(0, max).map(r => "<tr>" + r.map(v => "<td>" + (v === null ? "<i>NULL</i>" : esc(v)) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>" +
    (res.values.length > max ? '<p class="small muted">' + (res.values.length - max) + " more rows not shown</p>" : "") +
    '<p class="small muted">' + plural(res.values.length, "row") + "</p>";
}

/* ============================================================ list */
const TOPIC_LABEL = t => t;

function statusOf(id) {
  const p = store.get().probs[id];
  if (!p || p.st === "todo") return null;
  return p;
}

function list(el, r, ctx) {
  const { D } = ctx;
  const kind = r.q.get("k") || "all", topic = r.q.get("t") || "all", status = r.q.get("s") || "all";
  const all = D.py.problems.map(p => Object.assign({ kind: "py" }, p)).concat(D.sql.problems.map(p => Object.assign({ kind: "sql" }, p)));
  const topics = Array.from(new Set(all.map(p => p.topicLabel || p.topic)));
  const t = dayNum();
  const rows = all.filter(p =>
    (kind === "all" || p.kind === kind) && (topic === "all" || (p.topicLabel || p.topic) === topic) &&
    (status === "all" || (status === "todo" && !statusOf(p.id)) || (status === "solved" && statusOf(p.id)) || (status === "due" && statusOf(p.id) && statusOf(p.id).d <= t)));
  const solved = all.filter(p => statusOf(p.id)).length;
  const qs = (k, tt, s) => "#/practice?k=" + k + "&t=" + encodeURIComponent(tt) + "&s=" + s;
  const chip = (label, on, href) => '<a class="chip' + (on ? " on" : "") + '" href="' + href + '" style="text-decoration:none">' + esc(label) + "</a>";
  let h = "<h2>Practice</h2><p class=\"muted small\">Write real Python and SQL in your browser. Python runs in your browser via Pyodide; SQL runs on SQLite. Solved problems come back for a re-solve after 1, 3, 7, 14, 30 and 60 days.</p>";
  h += '<div class="card soft"><div class="row between"><b>' + solved + " / " + all.length + " solved</b><span class=\"small muted\">" + plural(D.py.problems.length, "Python problem") + " &middot; " + plural(D.sql.problems.length, "SQL problem") + "</span></div>" +
    '<div class="bar" style="margin-top:8px"><i style="width:' + Math.round(100 * solved / all.length) + '%"></i></div></div>';
  h += '<div class="chips" style="margin:12px 0 6px">' + [["all", "All"], ["py", "Python"], ["sql", "SQL"]].map(([k, l]) => chip(l, kind === k, qs(k, topic, status))).join("") + "</div>";
  h += '<div class="chips" style="margin:6px 0">' + [["all", "Any status"], ["todo", "Not solved"], ["solved", "Solved"], ["due", "Due for re-solve"]].map(([k, l]) => chip(l, status === k, qs(kind, topic, k))).join("") + "</div>";
  h += '<div class="chips" style="margin:6px 0 10px">' + chip("All topics", topic === "all", qs(kind, "all", status)) + topics.map(tp => chip(TOPIC_LABEL(tp), topic === tp, qs(kind, tp, status))).join("") + "</div>";
  if (!rows.length) h += '<p class="empty">Nothing matches these filters.</p>';
  else h += '<ul class="list">' + rows.map(p => {
    const st = statusOf(p.id);
    const badge = st ? (st.d <= t ? '<span class="tag bad">due</span>' : '<span class="tag ok">solved &times;' + st.n + "</span>") : "";
    return '<li><a class="li" href="#/practice/' + p.kind + "/" + p.id + '"><div class="t"><b>' + esc(p.title) + "</b><small>" + (p.kind === "py" ? "Python" : "SQL") + " &middot; " + esc(p.topicLabel || p.topic) + " &middot; " + esc(p.pattern || "") + '</small></div><div class="r"><span class="tag ' + p.diff + '">' + p.diff + "</span> " + badge + "</div></a></li>";
  }).join("") + "</ul>";
  el.innerHTML = h;
}

/* ============================================================ problem pages */
export function render(el, r, ctx) {
  const kind = r.parts[1], id = r.parts[2];
  if (!kind) return list(el, r, ctx);
  const { D } = ctx;
  const prob = kind === "py" ? D.py.problems.find(p => p.id === id) : D.sql.problems.find(p => p.id === id);
  if (!prob) { el.innerHTML = '<div class="empty"><b>Problem not found</b><a class="btn" href="#/practice">Back to problems</a></div>'; return; }
  return kind === "py" ? pyPage(el, prob, ctx) : sqlPage(el, prob, ctx);
}

function head(prob, kind) {
  return '<a class="btn ghost sm" href="#/practice" style="margin-left:-8px">&larr; All problems</a>' +
    '<h2 style="margin-top:6px">' + esc(prob.title) + '</h2><div class="chips" style="margin-bottom:12px"><span class="tag acc">' + (kind === "py" ? "Python" : "SQL") + '</span><span class="tag ' + prob.diff + '">' + prob.diff + '</span><span class="tag">' + esc(prob.topicLabel || prob.topic) + '</span>' + (prob.pattern ? '<span class="tag">' + esc(prob.pattern) + "</span>" : "") + (prob.lc ? '<span class="tag">' + esc(prob.lc) + "</span>" : "") + "</div>";
}

function tracker(prob) {
  const p = store.get().probs[prob.id];
  const next = p && p.st !== "todo" ? "Next re-solve: <b>" + (p.d <= dayNum() ? "today" : "in " + plural(p.d - dayNum(), "day")) + "</b> &middot; solved " + p.n + "&times;" : "Not solved yet.";
  return '<div class="card soft" id="trk"><div class="small">' + next + '</div>' +
    '<div class="small muted" style="margin:8px 0 4px">Error log &mdash; what tripped you up? (saved automatically)</div>' +
    '<textarea class="note" id="note" placeholder="e.g. forgot the sentinel; used < instead of <=">' + esc(p ? p.note || "" : "") + "</textarea></div>";
}
function bindTracker(el, prob, ctx) {
  const note = $("#note", el);
  if (note) note.onchange = () => store.commit(s => { const p = s.probs[prob.id] || { st: "todo", n: 0, d: dayNum(), t: 0, tries: 0, note: "" }; p.note = note.value; p.t = Date.now(); s.probs[prob.id] = p; });
}
function solvedBar(el, prob, ctx) {
  const box = $("#solvedbox", el);
  box.innerHTML = '<div class="explain" style="border-color:var(--good);background:var(--good-wash)"><b>All tests passed.</b> How did it feel?<div class="row" style="margin-top:8px"><button class="btn primary sm" id="clean">Solved cleanly</button><button class="btn sm" id="hard">Needed help / struggled</button></div></div>';
  const done = outcome => { store.commit(s => { s.probs[prob.id] = Object.assign(nextProblem(s.probs[prob.id], outcome), { note: (s.probs[prob.id] || {}).note || "", tries: ((s.probs[prob.id] || {}).tries || 0) + 1 }); }); store.bump("probs"); ctx.toast("Saved. It will come back for a re-solve."); ctx.rerender(); };
  $("#clean", box).onclick = () => done("solved");
  $("#hard", box).onclick = () => done("struggled");
}

/* ------------------------------------------------ Python */
function pyPage(el, prob, ctx) {
  const saved = localStorage.getItem("prep-code-" + prob.id);
  let h = head(prob, "py") + '<div class="card">' + md(prob.statement) +
    (prob.examples || []).map(e => '<pre><code>' + esc("Input:  " + e.in + "\nOutput: " + e.out) + "</code></pre>").join("") + "</div>";
  h += '<textarea class="editor" id="code" spellcheck="false" autocapitalize="off" autocomplete="off">' + esc(saved != null ? saved : prob.starter) + "</textarea>";
  h += '<div class="row" style="margin-top:10px"><button class="btn primary" id="submit">Run tests</button><button class="btn sm" id="hint">Hint</button><button class="btn sm" id="sol">Solution</button><button class="btn sm ghost" id="reset">Reset code</button></div>';
  h += '<div id="hintbox"></div><div class="result" id="out"></div><div id="solvedbox"></div><div id="solbox"></div><h3>Your notes</h3>' + tracker(prob);
  el.innerHTML = h;
  bindTracker(el, prob, ctx);
  const ta = $("#code", el);
  ta.addEventListener("keydown", e => {
    if (e.key === "Tab") { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText("    ", s, ta.selectionEnd, "end"); }
  });
  ta.addEventListener("input", () => localStorage.setItem("prep-code-" + prob.id, ta.value));
  $("#reset", el).onclick = () => { if (confirm("Reset to the starter code?")) { ta.value = prob.starter; localStorage.removeItem("prep-code-" + prob.id); } };
  $("#hint", el).onclick = () => { $("#hintbox", el).innerHTML = '<div class="explain">' + md(prob.hint || "Think about what you need from the data at each step, and which structure makes exactly that operation cheap.") + "</div>"; };
  $("#sol", el).onclick = () => {
    const box = $("#solbox", el);
    if (box.innerHTML) { box.innerHTML = ""; return; }
    box.innerHTML = '<h3>Reference solution</h3><p class="small muted">Read it only after a real attempt &mdash; then close it and rewrite it from memory tomorrow.</p><pre><code>' + esc(prob.solution) + "</code></pre>" + (prob.explain ? '<div class="explain">' + md(prob.explain) + "</div>" : "");
  };
  $("#submit", el).onclick = async () => {
    const out = $("#out", el), btn = $("#submit", el);
    btn.disabled = true; $("#solvedbox", el).innerHTML = "";
    out.innerHTML = '<p class="small muted"><span class="spinner"></span><span id="st">Starting Python…</span></p>';
    const res = await runPython(ta.value, prob.tests, s => { const st = $("#st", el); if (st) st.textContent = s === "loading" ? "Loading the Python runtime (first time only, ~10 MB)…" : "Running your code…"; });
    btn.disabled = false;
    if (res.timeout) { out.innerHTML = '<div class="tres no"><span>&#9203;</span><span>Time limit exceeded (8 s). Look for an infinite loop or an approach that is too slow.</span></div>'; return; }
    if (res.error) { out.innerHTML = '<div class="tres no"><span>&#10060;</span><span><b>Error</b><pre style="margin:6px 0 0"><code>' + esc(res.error) + "</code></pre></span></div>"; return; }
    const pass = res.results.filter(x => x.ok).length, total = res.results.length;
    let o = '<div class="row between" style="margin-bottom:8px"><b>' + pass + " / " + total + " tests passed</b>" + (pass === total ? '<span class="tag ok">all passed</span>' : '<span class="tag bad">not yet</span>') + "</div>";
    let shownFail = 0;
    res.results.forEach((x, i) => {
      if (x.ok) { o += '<div class="tres ok"><span>&#10003;</span><span class="m">Test ' + (i + 1) + "</span></div>"; return; }
      if (shownFail++ >= 3) { o += '<div class="tres no"><span>&#10007;</span><span class="m">Test ' + (i + 1) + "</span></div>"; return; }
      o += '<div class="tres no"><span>&#10007;</span><span class="m"><b>Test ' + (i + 1) + "</b><br>input: " + esc(x.label) + "<br>expected: " + esc(JSON.stringify(x.expected)) + "<br>" + (x.err ? "error: " + esc(x.err) : "got: " + esc(typeof x.got === "string" ? x.got : JSON.stringify(x.got))) + "</span></div>";
    });
    if (res.stdout) o += '<h3>Printed output</h3><pre><code>' + esc(res.stdout) + "</code></pre>";
    out.innerHTML = o;
    if (pass === total) solvedBar(el, prob, ctx);
  };
}

/* ------------------------------------------------ SQL */
function sqlPage(el, prob, ctx) {
  const { D } = ctx;
  const dataset = D.sql.datasets[prob.dataset];
  const saved = localStorage.getItem("prep-code-" + prob.id);
  let h = head(prob, "sql") + '<div class="card">' + md(prob.statement) +
    (prob.note ? '<div class="explain">' + md(prob.note) + "</div>" : "") +
    '<details><summary class="small muted" style="cursor:pointer">Tables in this problem</summary><div id="schema"><p class="small muted">Loading…</p></div></details></div>';
  h += '<textarea class="editor" id="code" spellcheck="false" autocapitalize="off" autocomplete="off" style="min-height:170px">' + esc(saved != null ? saved : "-- write your SQLite query here\n") + "</textarea>";
  h += '<div class="row" style="margin-top:10px"><button class="btn" id="run">Run</button><button class="btn primary" id="check">Check answer</button><button class="btn sm" id="hint">Hint</button><button class="btn sm" id="sol">Solution</button></div>';
  h += '<div id="hintbox"></div><div class="result" id="out"></div><div id="solvedbox"></div><div id="solbox"></div><h3>Your notes</h3>' + tracker(prob);
  el.innerHTML = h;
  bindTracker(el, prob, ctx);
  const ta = $("#code", el);
  ta.addEventListener("keydown", e => { if (e.key === "Tab") { e.preventDefault(); ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end"); } });
  ta.addEventListener("input", () => localStorage.setItem("prep-code-" + prob.id, ta.value));
  loadSql().then(SQL => {
    try {
      const db = new SQL.Database(); db.run(dataset);
      const tabs = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0];
      let s = "";
      for (const [name] of (tabs ? tabs.values : [])) {
        const rs = db.exec("SELECT * FROM " + name + " LIMIT 6")[0];
        const cnt = db.exec("SELECT COUNT(*) FROM " + name)[0].values[0][0];
        s += "<p class=\"small\"><b>" + esc(name) + "</b> <span class=\"muted\">(" + cnt + " rows)</span></p>" + (rs ? table(rs, 6) : "");
      }
      db.close(); $("#schema", el).innerHTML = s;
    } catch (e) { $("#schema", el).innerHTML = '<p class="small">' + esc(e.message) + "</p>"; }
  }).catch(e => { $("#schema", el).innerHTML = '<p class="small">' + esc(e.message) + "</p>"; });
  $("#hint", el).onclick = () => { $("#hintbox", el).innerHTML = '<div class="explain">' + md(prob.hint || "Start from the tables you need, then filter, group, and finally order.") + "</div>"; };
  $("#sol", el).onclick = () => {
    const box = $("#solbox", el);
    if (box.innerHTML) { box.innerHTML = ""; return; }
    box.innerHTML = '<h3>Reference solution (SQLite)</h3><pre><code>' + esc(prob.solution) + "</code></pre>" + (prob.oracle ? '<h3>The Oracle way</h3><pre><code>' + esc(prob.oracle) + "</code></pre>" : "") + (prob.explain ? '<div class="explain">' + md(prob.explain) + "</div>" : "");
  };
  const exec = async check => {
    const out = $("#out", el);
    out.innerHTML = '<p class="small muted"><span class="spinner"></span>Running…</p>';
    let SQL;
    try { SQL = await loadSql(); } catch (e) { out.innerHTML = '<div class="tres no"><span>&#10060;</span><span>' + esc(e.message) + "</span></div>"; return; }
    let mine;
    try { mine = execSql(SQL, dataset, ta.value); }
    catch (e) { out.innerHTML = '<div class="tres no"><span>&#10060;</span><span class="m">' + esc(e.message) + "</span></div>"; return; }
    if (!check) { out.innerHTML = "<b>Result</b>" + table(mine); return; }
    const expected = execSql(SQL, dataset, prob.solution);
    const why = sameResult(mine, expected, !!prob.ordered);
    if (!why) {
      out.innerHTML = '<div class="tres ok"><span>&#10003;</span><span><b>Correct.</b> Your result matches the expected rows.</span></div>' + table(mine, 12);
      solvedBar(el, prob, ctx);
    } else {
      out.innerHTML = '<div class="tres no"><span>&#10007;</span><span><b>Not quite.</b> ' + esc(why) + "</span></div><b>Your result</b>" + table(mine, 10) + "<details><summary class=\"small muted\" style=\"cursor:pointer\">Show the expected result</summary>" + table(expected, 10) + "</details>";
    }
  };
  $("#run", el).onclick = () => exec(false);
  $("#check", el).onclick = () => exec(true);
}
