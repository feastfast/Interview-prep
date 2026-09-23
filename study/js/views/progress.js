import * as store from "../store.js";
import * as sync from "../sync.js";
import { esc, plural, ago, $, $$ } from "../util.js";
import { dayNum, isoDay, cardState } from "../srs.js";
import { icon, ring, hue, getTheme, setTheme } from "../ui.js";

export function render(el, r, ctx) {
  if (r.parts[1] === "settings") return settings(el, ctx);
  return overview(el, ctx);
}

function stat(ic, n, label, cls = "", suffix = "") {
  const num = typeof n === "number" ? '<span data-count="' + n + '">' + n + "</span>" : n;
  return '<div class="stat ' + cls + '"><span class="stat-ic">' + icon(ic, 16) + "</span><b>" + num + (suffix ? "<small>" + suffix + "</small>" : "") + "</b><span>" + label + "</span></div>";
}

function overview(el, ctx) {
  const { D } = ctx;
  const s = store.get();
  const known = D.cards.cards.filter(c => cardState(s.cards[c.id]) === "known").length;
  const qAtt = Object.values(s.quiz);
  const right = qAtt.reduce((a, x) => a + x.c, 0), wrong = qAtt.reduce((a, x) => a + x.w, 0);
  const solved = Object.entries(s.probs).filter(([id, p]) => D.known.has(id) && p.st !== "todo").length;
  const reviews = Object.values(s.log).reduce((a, e) => a + (e.cards || 0), 0);

  let h = '<header class="page-h rise"><div><div class="eyebrow">Your study</div><h1>Progress</h1></div><a class="btn sm" href="#/progress/settings">' + icon("gear", 15) + "Settings &amp; sync</a></header>";
  h += '<div class="stats six stagger">' +
    stat("flame", store.streak(), "day streak", "hot") +
    stat("cards", known, "cards known", "", "/" + D.cards.cards.length) +
    stat("target", right + wrong ? Math.round(100 * right / (right + wrong)) : "—", "quiz accuracy", "", right + wrong ? "%" : "") +
    stat("check", solved, "problems solved", "", "/" + D.known.size) +
    stat("quiz", qAtt.length, "questions tried") +
    stat("sync", reviews, "card reviews") + "</div>";

  /* heat-map: last 18 weeks, aligned so each column is a Monday..Sunday week */
  const today = dayNum();
  const dow = (new Date().getDay() + 6) % 7;
  const start = today - dow - 17 * 7;
  let cells = "";
  for (let d = start; d <= today; d++) {
    const e = s.log[isoDay(d)];
    const n = e ? (e.cards || 0) + (e.quiz || 0) + (e.probs || 0) * 5 : 0;
    cells += '<i class="' + (n === 0 ? "" : n < 10 ? "l1" : n < 30 ? "l2" : "l3") + '" title="' + isoDay(d) + ": " + n + ' activity"></i>';
  }
  const active = Object.values(s.log).filter(e => (e.cards || 0) + (e.quiz || 0) + (e.probs || 0) > 0).length;
  h += '<div class="sec-h"><h2>Activity</h2><span class="small muted">' + plural(active, "active day") + "</span></div>";
  h += '<div class="card heat-card"><div class="heat">' + cells + '</div><div class="row between" style="margin-top:12px"><span class="small muted">Consistency beats intensity &mdash; short daily sessions win.</span>' +
    '<div class="legend">Less<i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i>More</div></div></div>';

  h += '<div class="sec-h"><h2>By topic</h2></div><div class="pgrid stagger">';
  for (const deck of D.cards.decks) {
    const cs = D.cards.cards.filter(c => c.d === deck.id);
    const kn = cs.filter(c => cardState(s.cards[c.id]) === "known").length;
    const qs = D.quiz.questions.filter(q => q.d === deck.id);
    let qr = 0, qw = 0;
    qs.forEach(q => { const x = s.quiz[q.id]; if (x) { qr += x.c; qw += x.w; } });
    const acc = qr + qw ? Math.round(100 * qr / (qr + qw)) : null;
    const p = cs.length ? Math.round(100 * kn / cs.length) : 0;
    h += '<a class="pcard hued" style="--h:' + hue(deck.id) + '" href="#/topics/' + deck.id + '">' + ring(cs.length ? kn / cs.length : 0, { size: 58, stroke: 6, label: p + "%" }) +
      '<div class="pcard-b"><b>' + esc(deck.label) + '</b><div class="small muted">' + kn + "/" + cs.length + " cards known</div>" +
      '<div class="bar ' + (acc != null && acc < 60 ? "bad" : "good") + '"><i style="width:' + (acc || 0) + '%"></i></div><div class="small muted">' + (acc == null ? "Quiz not tried yet" : "Quiz accuracy " + acc + "%") + "</div></div></a>";
  }
  h += "</div>";

  /* weakest areas = lowest quiz accuracy among sub-topics with at least 3 attempts */
  const byTopic = {};
  D.quiz.questions.forEach(q => { const x = s.quiz[q.id]; if (!x) return; const k = q.d + "|" + q.t; const b = byTopic[k] || (byTopic[k] = { c: 0, w: 0 }); b.c += x.c; b.w += x.w; });
  const weak = Object.entries(byTopic).filter(([, v]) => v.c + v.w >= 3).map(([k, v]) => [k, v.c / (v.c + v.w)]).sort((a, b) => a[1] - b[1]).slice(0, 5);
  if (weak.length) {
    h += '<div class="sec-h"><h2>Focus here</h2><span class="small muted">lowest quiz accuracy</span></div><ul class="list stagger">' + weak.map(([k, a]) => {
      const [d, t] = k.split("|");
      const deck = (D.cards.decks.find(x => x.id === d) || D.quiz.decks.find(x => x.id === d) || { label: d }).label;
      return '<li><a class="li" href="#/quiz/session?n=all&decks=' + encodeURIComponent(d) + "&topics=" + encodeURIComponent(t) + '"><span class="lidot hued" style="--h:' + hue(d) + '"></span><div class="t"><b>' + esc(t) + "</b><small>" + esc(deck) + '</small></div><div class="r"><div class="bar bad" style="width:70px"><i style="width:' + Math.round(100 * a) + '%"></i></div>' + Math.round(100 * a) + "%" + icon("arrow", 14) + "</div></a></li>";
    }).join("") + "</ul>";
  }
  el.innerHTML = h;
}

function settings(el, ctx) {
  const draw = () => {
    const st = sync.status;
    let h = '<a class="backlink" href="#/progress">' + icon("back", 16) + "Progress</a><header class=\"page-h\"><div><h1>Settings &amp; sync</h1></div></header>";
    h += '<div class="card"><div class="card-h">' + icon("sync", 18) + "<b>Cloud sync</b></div>";
    if (st.user) {
      h += '<div class="row" style="margin:12px 0">' + (st.user.photo ? '<img class="avatar" src="' + esc(st.user.photo) + '" referrerpolicy="no-referrer" alt="">' : "") + "<span>Signed in as <b>" + esc(st.user.name) + "</b></span></div>" +
        '<p class="small muted">' + (st.syncing ? "Syncing…" : st.last ? "Last synced " + ago(st.last) : "Not synced yet") + ". Progress merges automatically between your phone and laptop; the most recent change to each item wins.</p>" +
        '<div class="row"><button class="btn primary sm" id="syncnow">' + icon("sync", 14) + 'Sync now</button><button class="btn sm" id="signout">Sign out</button></div>';
    } else {
      h += '<p class="small muted" style="margin:8px 0 14px">Your progress is saved in this browser. Sign in with Google to keep your phone and laptop in sync and back it up in the cloud.</p><button class="btn primary" id="signin">Sign in with Google</button>';
    }
    if (st.error) h += '<p class="small" style="color:var(--bad);margin-top:10px">' + esc(st.error) + "</p>";
    h += "</div>";
    const t = getTheme();
    h += '<div class="card"><div class="card-h">' + icon("sun", 18) + '<b>Appearance</b></div><p class="small muted" style="margin:6px 0 12px">Pick a theme, or follow your system setting.</p><div class="chips" id="themes">' +
      [["system", "System", "system"], ["light", "Light", "sun"], ["dark", "Dark", "moon"]].map(([k, l, ic]) => '<button class="chip' + (t === k ? " on" : "") + '" data-t="' + k + '">' + icon(ic, 14) + l + "</button>").join("") + "</div></div>";
    h += '<div class="card"><div class="card-h">' + icon("archive", 18) + '<b>Backup</b></div><p class="small muted" style="margin:6px 0 12px">Export your progress as a file, or import one. Importing merges with what you have.</p><div class="row"><button class="btn sm" id="exp">Export</button><label class="btn sm" style="cursor:pointer">Import<input type="file" id="imp" accept="application/json" hidden></label></div></div>';
    h += '<div class="card danger"><div class="card-h">' + icon("alert", 18) + '<b>Reset</b></div><p class="small muted" style="margin:6px 0 12px">Erase all progress on this device (and, if you are signed in, the next sync will not restore it unless another device still has it).</p><button class="btn sm" id="reset" style="color:var(--bad)">Reset progress</button></div>';
    el.innerHTML = h;
    const on = (id, fn) => { const x = $("#" + id, el); if (x) x.onclick = fn; };
    on("signin", () => sync.signIn()); on("signout", () => sync.signOut()); on("syncnow", () => sync.syncNow());
    $$("#themes .chip", el).forEach(c => c.onclick = () => { setTheme(c.dataset.t); setTimeout(() => { draw(); ctx.refreshChrome(); }, 20); });
    on("exp", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([store.exportJSON()], { type: "application/json" }));
      a.download = "study-progress-" + isoDay() + ".json"; a.click();
    });
    $("#imp", el).onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { store.importJSON(await f.text()); ctx.toast("Imported and merged."); } catch (err) { ctx.toast("Import failed: " + err.message, 3500); }
    };
    on("reset", () => { if (confirm("Erase ALL study progress on this device?")) { store.resetAll(); ctx.toast("Progress erased."); } });
  };
  draw();
  const off = sync.onStatus(() => { if (document.getElementById("reset")) draw(); else off(); });
}
