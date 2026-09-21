import * as store from "../store.js";
import * as sync from "../sync.js";
import { esc, plural, ago, $, $$ } from "../util.js";
import { dayNum, isoDay, isNew, isMature, isDue } from "../srs.js";

export function render(el, r, ctx) {
  if (r.parts[1] === "settings") return settings(el, ctx);
  return overview(el, ctx);
}

function overview(el, ctx) {
  const { D } = ctx;
  const s = store.get(), t = dayNum();
  let h = "<h2>Progress</h2>";
  const seen = D.cards.cards.filter(c => !isNew(s.cards[c.id])).length;
  const mature = D.cards.cards.filter(c => isMature(s.cards[c.id])).length;
  const qAtt = Object.values(s.quiz);
  const right = qAtt.reduce((a, x) => a + x.c, 0), wrong = qAtt.reduce((a, x) => a + x.w, 0);
  const solved = Object.entries(s.probs).filter(([id, p]) => D.known.has(id) && p.st !== "todo").length;
  const totalProbs = D.known.size;
  h += '<div class="grid g3"><div class="tile hl"><b>' + store.streak() + "</b><span>day streak</span></div>" +
    '<div class="tile"><b>' + seen + "<small class=\"muted\" style=\"font-size:14px\">/" + D.cards.cards.length + "</small></b><span>cards learned</span></div>" +
    '<div class="tile"><b>' + mature + "</b><span>mature (21d+)</span></div></div>";
  h += '<div class="grid g3" style="margin-top:10px"><div class="tile"><b>' + (right + wrong ? Math.round(100 * right / (right + wrong)) + "%" : "&mdash;") + "</b><span>quiz accuracy</span></div>" +
    '<div class="tile"><b>' + solved + "<small class=\"muted\" style=\"font-size:14px\">/" + totalProbs + "</small></b><span>problems solved</span></div>" +
    '<div class="tile"><b>' + Object.values(s.cards).reduce((a, c) => a + (c.l || 0), 0) + "</b><span>lapses (Again)</span></div></div>";

  /* heat-map: last 16 weeks */
  const today = dayNum();
  const start = today - (16 * 7 - 1);
  let cells = "";
  for (let d = start; d <= today; d++) {
    const e = s.log[isoDay(d)]; const n = e ? (e.cards || 0) + (e.quiz || 0) + (e.probs || 0) * 5 : 0;
    cells += '<i class="' + (n === 0 ? "" : n < 10 ? "l1" : n < 30 ? "l2" : "l3") + '" title="' + isoDay(d) + ": " + n + ' activity"></i>';
  }
  h += "<h2>Activity</h2><div class=\"heat\">" + cells + "</div><p class=\"small muted\">Last 16 weeks. Consistency beats intensity: short daily sessions with spaced review beat long cramming days.</p>";

  h += "<h2>By topic</h2>";
  for (const deck of D.cards.decks) {
    const cs = D.cards.cards.filter(c => c.d === deck.id);
    const learned = cs.filter(c => !isNew(s.cards[c.id])).length, mat = cs.filter(c => isMature(s.cards[c.id])).length, due = cs.filter(c => isDue(s.cards[c.id], t)).length;
    const qs = D.quiz.questions.filter(q => q.d === deck.id);
    let qr = 0, qw = 0; qs.forEach(q => { const x = s.quiz[q.id]; if (x) { qr += x.c; qw += x.w; } });
    const acc = qr + qw ? Math.round(100 * qr / (qr + qw)) : null;
    h += '<div class="card"><div class="row between"><b>' + esc(deck.label) + '</b><span class="small muted">' + due + ' due</span></div>' +
      '<div class="small muted" style="margin-top:6px">Cards learned ' + learned + "/" + cs.length + " &middot; mature " + mat + "</div>" +
      '<div class="bar" style="margin-top:4px"><i style="width:' + (cs.length ? Math.round(100 * learned / cs.length) : 0) + '%"></i></div>' +
      '<div class="small muted" style="margin-top:8px">Quiz accuracy ' + (acc == null ? "&mdash;" : acc + "%") + "</div>" +
      '<div class="bar ' + (acc != null && acc < 60 ? "bad" : "good") + '" style="margin-top:4px"><i style="width:' + (acc || 0) + '%"></i></div></div>';
  }

  /* weakest topics = lowest quiz accuracy among topics with at least 3 attempts */
  const byTopic = {};
  D.quiz.questions.forEach(q => { const x = s.quiz[q.id]; if (!x) return; const k = q.d + " · " + q.t; const b = byTopic[k] || (byTopic[k] = { c: 0, w: 0 }); b.c += x.c; b.w += x.w; });
  const weak = Object.entries(byTopic).filter(([, v]) => v.c + v.w >= 3).map(([k, v]) => [k, v.c / (v.c + v.w)]).sort((a, b) => a[1] - b[1]).slice(0, 5);
  if (weak.length) h += "<h2>Focus here</h2><ul class=\"list\">" + weak.map(([k, a]) => '<li><div class="li"><div class="t"><b>' + esc(k) + '</b></div><div class="r">' + Math.round(100 * a) + "%</div></div></li>").join("") + "</ul>";
  h += '<p style="margin-top:18px"><a class="btn" href="#/progress/settings">Settings &amp; sync</a></p>';
  el.innerHTML = h;
}

function settings(el, ctx) {
  const s = store.get();
  const draw = () => {
    const st = sync.status;
    let h = '<a class="btn ghost sm" href="#/progress" style="margin-left:-8px">&larr; Progress</a><h2 style="margin-top:6px">Settings &amp; sync</h2>';
    h += '<div class="card"><b>Cloud sync</b>';
    if (st.user) {
      h += '<div class="row" style="margin:10px 0">' + (st.user.photo ? '<img class="avatar" src="' + esc(st.user.photo) + '" referrerpolicy="no-referrer" alt="">' : "") + "<span>Signed in as <b>" + esc(st.user.name) + "</b></span></div>" +
        '<p class="small muted">' + (st.syncing ? "Syncing…" : st.last ? "Last synced " + ago(st.last) : "Not synced yet") + ". Progress merges automatically between your phone and laptop; the most recent review of each card wins.</p>" +
        '<div class="row"><button class="btn primary sm" id="syncnow">Sync now</button><button class="btn sm" id="signout">Sign out</button></div>';
    } else {
      h += '<p class="small muted" style="margin:8px 0 12px">Your progress is saved in this browser. Sign in with Google to keep your phone and laptop in sync and back it up in the cloud.</p><button class="btn primary" id="signin">Sign in with Google</button>';
    }
    if (st.error) h += '<p class="small" style="color:var(--bad);margin-top:10px">' + esc(st.error) + "</p>";
    h += "</div>";
    h += '<div class="card"><b>Daily new cards</b><div class="row" style="margin-top:8px"><input type="range" min="0" max="50" step="5" value="' + (s.settings.newPerDay || 15) + '" id="npd" style="flex:1"><b id="npdv">' + (s.settings.newPerDay || 15) + "</b></div>" +
      '<p class="small muted">How many brand-new cards to introduce per day (on top of the ones due for review). 10&ndash;20 is sustainable.</p></div>';
    h += '<div class="card"><b>Backup</b><p class="small muted" style="margin:6px 0 10px">Export your progress as a file, or import one. Importing merges with what you have.</p><div class="row"><button class="btn sm" id="exp">Export</button><label class="btn sm" style="cursor:pointer">Import<input type="file" id="imp" accept="application/json" hidden></label></div></div>';
    h += '<div class="card"><b>Reset</b><p class="small muted" style="margin:6px 0 10px">Erase all progress on this device (and, if you are signed in, the next sync will not restore it unless another device still has it).</p><button class="btn sm" id="reset" style="color:var(--bad)">Reset progress</button></div>';
    el.innerHTML = h;
    const on = (id, fn) => { const x = $("#" + id, el); if (x) x.onclick = fn; };
    on("signin", () => sync.signIn()); on("signout", () => sync.signOut()); on("syncnow", () => sync.syncNow());
    const npd = $("#npd", el);
    npd.oninput = () => { $("#npdv", el).textContent = npd.value; };
    npd.onchange = () => store.commit(x => { x.settings = { newPerDay: +npd.value, t: Date.now() }; });
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
  const off = sync.onStatus(() => { if (document.getElementById("npd")) draw(); else off(); });
}
