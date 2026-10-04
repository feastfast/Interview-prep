import * as store from "../store.js";
import { esc, $, $$ } from "../util.js";
import { icon } from "../ui.js";
import { liveVersions, saveVersion, removeVersion } from "../solutions.js";

const LABELS = ["Brute force", "Better", "Optimal", "Different approach"];

/* The solutions box for one problem. It opens by itself the first time you solve a problem (blank, ready for a first
   version); after that you open it from the problem's "solutions" link and add versions yourself: each has a label,
   time and space complexity, code and notes. Everything is optional. */
export function openLogModal(id, title, ctx, { select = null } = {}) {
  const list = () => liveVersions(store.get().probs[id]);
  let cur = select || (list().length ? list()[0].id : "new");
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  document.body.appendChild(bg);

  const chip = (vid, text) => '<button class="chip' + (vid === cur ? " on" : "") + '" data-v="' + esc(vid) + '">' + esc(text) + "</button>";
  const draw = () => {
    const vs = list();
    let v = cur === "new" ? null : vs.find(x => x.id === cur) || null;
    if (!v) cur = "new";
    const tabs = vs.length ? '<div class="chips vtabs">' + vs.slice().reverse().map((x, i) => chip(x.id, "v" + (i + 1) + (x.label ? " · " + x.label : ""))).join("") + chip("new", "+ New version") + "</div>" : "";
    v = v || { label: "", time: "", space: "", code: "", notes: "" };
    bg.innerHTML = '<div class="modal" role="dialog" aria-label="Your solutions"><div class="modal-h"><span class="modal-ic">' + icon("code", 18) + '</span><div><h3>' + (cur === "new" ? "Save a solution" : "Your solutions") + '</h3><p class="small muted">' + esc(title || id) + '</p></div><button class="iconbtn" id="logx" aria-label="Close">' + icon("close", 18) + "</button></div>" + tabs +
      '<label class="field-l" for="vlabel">Label</label><input class="input" id="vlabel" list="vlabels" autocomplete="off" placeholder="e.g. Brute force, Optimal" value="' + esc(v.label || "") + '"><datalist id="vlabels">' + LABELS.map(l => '<option value="' + l + '">').join("") + "</datalist>" +
      '<div class="vrow"><div><label class="field-l" for="vtime">Time</label><input class="input" id="vtime" autocomplete="off" placeholder="O(n log n)" value="' + esc(v.time || "") + '"></div><div><label class="field-l" for="vspace">Space</label><input class="input" id="vspace" autocomplete="off" placeholder="O(1)" value="' + esc(v.space || "") + '"></div></div>' +
      '<label class="field-l" for="vcode">Code</label><textarea id="vcode" class="mono" rows="8" spellcheck="false" placeholder="Paste your solution from LeetCode…">' + esc(v.code || "") + "</textarea>" +
      '<label class="field-l" for="vnotes">Notes &mdash; understanding, mistakes made</label><textarea id="vnotes" rows="4" placeholder="What was the key insight? What tripped you up?">' + esc(v.notes || "") + "</textarea>" +
      '<div class="modal-f"><span>' + (cur === "new" ? '<span class="small muted">Optional &mdash; you can add it later.</span>' : '<button class="linkbtn danger" id="vdel">Delete this version</button>') + '</span><div class="row"><button class="btn ghost" id="logskip">' + (cur === "new" && !vs.length ? "Add later" : "Cancel") + '</button><button class="btn primary" id="logsave">' + icon("check", 16) + "Save</button></div></div></div>";
    $("#logx", bg).onclick = $("#logskip", bg).onclick = close;
    $("#logsave", bg).onclick = () => { commit(); close(); ctx.toast("Saved."); ctx.rerender(); };
    $$(".vtabs .chip", bg).forEach(b => b.onclick = () => { commit(); cur = b.dataset.v; draw(); });
    const del = $("#vdel", bg);
    if (del) del.onclick = () => { if (!confirm("Delete this version?")) return; removeVersion(id, cur); cur = list().length ? list()[0].id : "new"; draw(); };
    const t = $("#vcode", bg);
    if (t && cur === "new" && matchMedia("(pointer: fine)").matches) setTimeout(() => t.focus(), 60);
  };
  const read = () => ({ label: $("#vlabel", bg).value, time: $("#vtime", bg).value, space: $("#vspace", bg).value, code: $("#vcode", bg).value, notes: $("#vnotes", bg).value });
  const commit = () => {                       // saves what is in the form: a new version, or edits to the open one
    const d = read();
    if (cur === "new") { const vid = saveVersion(id, d); if (vid) cur = vid; return; }
    const v = list().find(x => x.id === cur);
    const same = v && (v.label || "") === d.label.trim() && (v.time || "") === d.time.trim() && (v.space || "") === d.space.trim() && (v.code || "") === d.code && (v.notes || "") === d.notes;
    if (v && !same) saveVersion(id, d, cur);
  };
  const onKey = e => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); close(); ctx.toast("Saved."); ctx.rerender(); }
  };
  const close = () => { document.removeEventListener("keydown", onKey); bg.classList.add("out"); setTimeout(() => bg.remove(), 200); };
  document.addEventListener("keydown", onKey);
  bg.addEventListener("mousedown", e => { if (e.target === bg) close(); });
  draw();
}
