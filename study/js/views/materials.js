import { esc, plural, ago, $ } from "../util.js";
import { icon, hue } from "../ui.js";

/* Notes and study guides: every file in the repo's subject folders, listed live from the GitHub API
   (cached in localStorage), so a PDF pushed into a folder shows up here on its own. */
const OWNER = "feastfast", REPO = "Interview-prep", BRANCH = "main";
const CACHE_KEY = "prep-tree-v2";
const META = [
  { dir: "OS", label: "Operating Systems", hint: "Processes, memory, scheduling", h: 250 },
  { dir: "OOPS", label: "OOPS", hint: "Design principles, SOLID", h: 305 },
  { dir: "DBMS", label: "DBMS", hint: "Normalisation, transactions, indexing", h: 200 },
  { dir: "SQL", label: "SQL & PL/SQL", hint: "Oracle SQL, joins, windows, PL/SQL", h: 230 },
  { dir: "Computer Networks", label: "Computer Networks", hint: "OSI, TCP/IP, HTTP", h: 180 },
  { dir: "System Design", label: "System Design", hint: "Scaling, caching, trade-offs", h: 285 },
  { dir: "Software Engineering", label: "Software Engineering", hint: "SDLC, testing, process", h: 150 },
  { dir: "Big Data", label: "Big Data", hint: "Hadoop, Spark, pipelines", h: 80 },
  { dir: "LeetCode", label: "LeetCode / DSA", hint: "Pattern guides and problem sets", h: 45 },
  { dir: "Aptitude", label: "Aptitude", hint: "Quant, logical, verbal", h: 120 },
  { dir: "Project Notes", label: "Project Notes", hint: "Your own projects, explained", h: 340 },
  { dir: "Tools", label: "Tools", hint: "APIs, MCP, tooling", h: 25 },
  { dir: "Might_be_useful", label: "Might Be Useful", hint: "Odds and ends worth keeping", h: 5 },
];
/* Folders that are part of the site itself, not study material. */
const NOT_MATERIAL = new Set(["study"]);
const SKIP = /^(index\.html|readme(\.md)?|license(\.md)?)$/i;

let tree = null, syncedAt = 0, problem = null, fetching = false, fetchedThisSession = false, query = "", lastKey = null;

const titleCase = s => s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, c => c.toUpperCase());
const prettyFile = n => n.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
const bytes = n => !n ? "" : n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB";
const ext = n => (/\.([^.]+)$/.exec(n) || [, ""])[1].toUpperCase();
const fileHref = p => p.split("/").map(encodeURIComponent).join("/");
const metaFor = dir => META.find(m => m.dir === dir);
const hueFor = dir => { const m = metaFor(dir); return m ? m.h : hue(dir); };

function buildTree(blobs) {
  const roots = [], index = {};
  const folder = (name, parentKey, list) => {
    const key = parentKey ? parentKey + "/" + name : name;
    if (index[key]) return index[key];
    const m = parentKey ? null : metaFor(name);
    const node = { name, label: m ? m.label : titleCase(name), hint: m ? m.hint : "", dir: true, kids: [] };
    index[key] = node; list.push(node);
    return node;
  };
  for (const b of blobs) {
    const parts = b.path.split("/");
    if (parts.length < 2 || parts[0][0] === "." || NOT_MATERIAL.has(parts[0])) continue;
    const file = parts[parts.length - 1];
    if (file[0] === "." || SKIP.test(file)) continue;
    let list = roots, key = "";
    for (let i = 0; i < parts.length - 1; i++) { const n = folder(parts[i], key, list); key = key ? key + "/" + parts[i] : parts[i]; list = n.kids; }
    list.push({ name: file, label: prettyFile(file), path: b.path, size: b.size || 0 });
  }
  const ordered = [], seen = new Set();
  for (const m of META) { ordered.push(roots.find(r => r.name === m.dir) || { name: m.dir, label: m.label, hint: m.hint, dir: true, kids: [] }); seen.add(m.dir); }
  roots.filter(r => !seen.has(r.name)).sort((a, b) => a.name.localeCompare(b.name)).forEach(r => ordered.push(r));
  const sortKids = n => { if (!n.kids) return; n.kids.sort((a, b) => (!!a.dir !== !!b.dir ? (a.dir ? -1 : 1) : a.label.localeCompare(b.label, undefined, { sensitivity: "base" }))); n.kids.forEach(sortKids); };
  ordered.forEach(sortKids);
  return ordered;
}
const countFiles = n => (n.dir ? n.kids.reduce((t, k) => t + countFiles(k), 0) : 1);
function nodeAt(path) {
  let list = tree, node = null;
  for (const p of path) { node = list.find(n => n.name === p); if (!node) return null; list = node.kids || []; }
  return node;
}
function everyFile() {
  const out = [];
  const walk = (list, trail, top) => list.forEach(n => n.dir ? walk(n.kids, trail.concat(n.label), top || n.name) : out.push({ node: n, trail, top }));
  walk(tree || [], [], null);
  return out;
}

function loadCache() {
  if (tree) return;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (c && c.blobs) { tree = buildTree(c.blobs); syncedAt = c.at; }
  } catch (e) { /* ignore */ }
}
/* One live refresh per visit keeps well inside GitHub's anonymous rate limit. */
function refresh(onDone) {
  if (fetching || fetchedThisSession) return;
  fetching = true;
  fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/git/trees/" + BRANCH + "?recursive=1", { headers: { Accept: "application/vnd.github+json" } })
    .then(r => { if (!r.ok) throw new Error("GitHub returned " + r.status); return r.json(); })
    .then(data => {
      const blobs = (data.tree || []).filter(n => n.type === "blob").map(n => ({ path: n.path, size: n.size }));
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), blobs })); } catch (e) { /* ignore */ }
      tree = buildTree(blobs); syncedAt = Date.now(); problem = null;
    })
    .catch(err => { problem = tree ? "Showing the list from " + ago(syncedAt) + " — couldn't reach GitHub." : "Couldn't load the file list (" + err.message + ")."; if (!tree) tree = buildTree([]); })
    .finally(() => { fetching = false; fetchedThisSession = true; onDone(); });
}

/* Every material file, for the command palette. */
export function materialFiles() {
  loadCache();
  return everyFile().map(f => ({ label: f.node.label, trail: f.trail.join(" / "), href: fileHref(f.node.path) }));
}

export function render(el, r, ctx) {
  loadCache();
  const path = r.parts.slice(1).map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } });
  const key = path.join("/");
  if (key !== lastKey) { query = ""; lastKey = key; }
  const redraw = () => { if (location.hash.split("?")[0].startsWith("#/materials")) ctx.rerender(); };
  refresh(redraw);
  if (!tree) { el.innerHTML = '<div class="loading"><span class="spinner"></span>Loading your materials…</div>'; return; }
  if (path.length) return folderView(el, path);
  home(el);
}

function fileRow(n, trail, top) {
  return '<li><a class="li frow hued" style="--h:' + hueFor(top) + '" href="' + fileHref(n.path) + '" target="_blank" rel="noopener">' +
    '<span class="ficon"><span>' + esc(ext(n.name) || "FILE") + '</span></span><div class="t"><b>' + esc(n.label) + "</b>" + (trail ? "<small>" + esc(trail) + "</small>" : "") + "</div>" +
    '<div class="r">' + bytes(n.size) + icon("ext", 14) + "</div></a></li>";
}

function searchBox(placeholder) {
  return '<label class="findw">' + icon("search", 16) + '<input type="search" class="find" id="mq" placeholder="' + placeholder + '" autocomplete="off" spellcheck="false" value="' + esc(query) + '"></label>';
}
function results(scope) {
  const term = query.toLowerCase();
  const hits = everyFile().filter(f => (!scope || f.top === scope) && (f.node.label + " " + f.trail.join(" ")).toLowerCase().includes(term));
  if (!hits.length) return '<div class="empty">' + icon("search", 26) + "<b>No match</b>Nothing here is called “" + esc(query) + "”.</div>";
  return '<div class="sec-h"><h2>' + hits.length + (hits.length === 1 ? " match" : " matches") + '</h2></div><ul class="list">' + hits.slice(0, 80).map(f => fileRow(f.node, f.trail.join(" / "), f.top)).join("") + "</ul>";
}
function bindSearch(el, scope, normal) {
  const inp = $("#mq", el), box = $("#mbody", el);
  inp.oninput = () => { query = inp.value.trim(); box.innerHTML = query ? results(scope) : normal(); };
  inp.onkeydown = e => { if (e.key === "Escape" && query) { e.stopPropagation(); inp.value = ""; query = ""; box.innerHTML = normal(); } };
  if (query) { inp.focus(); inp.setSelectionRange(query.length, query.length); }
}

function home(el) {
  const total = tree.reduce((t, n) => t + countFiles(n), 0);
  const synced = syncedAt ? " · synced " + ago(syncedAt) : "";
  let h = '<header class="page-h rise"><div><div class="eyebrow">Library</div><h1>Materials</h1><p class="lead" style="margin-bottom:0">Notes and study guides for every subject &mdash; ' + plural(tree.length, "subject") + " · " + plural(total, "file") + synced + ".</p></div></header>";
  if (problem) h += '<div class="banner warn">' + icon("alert", 15) + "<span>" + esc(problem) + "</span></div>";
  h += searchBox("Search all notes and guides");
  const grid = () => '<div class="mgrid stagger">' + tree.map(n => {
    const c = countFiles(n);
    return '<a class="mtile hued' + (c ? "" : " dim") + '" style="--h:' + hueFor(n.name) + '" href="#/materials/' + encodeURIComponent(n.name) + '">' +
      '<span class="mtile-ic">' + icon("book", 18) + '</span><div class="mtile-t"><b>' + esc(n.label) + "</b><small>" + esc(n.hint || "") + "</small></div>" +
      '<span class="mtile-n">' + (c ? plural(c, "file") : "empty") + "</span></a>";
  }).join("") + "</div>";
  el.innerHTML = h + '<div id="mbody">' + (query ? results(null) : grid()) + "</div>";
  bindSearch(el, null, grid);
}

function folderView(el, path) {
  const here = nodeAt(path);
  const top = path[0];
  let h = '<a class="backlink" href="#/materials' + (path.length > 1 ? "/" + path.slice(0, -1).map(encodeURIComponent).join("/") : "") + '">' + icon("back", 16) + (path.length > 1 ? esc((nodeAt(path.slice(0, -1)) || {}).label || "Back") : "Materials") + "</a>";
  if (!here) { el.innerHTML = h + '<div class="empty">' + icon("alert", 28) + "<b>Not found</b>No folder called <code>" + esc(path.join("/")) + "</code>.</div>"; return; }
  const c = countFiles(here);
  const crumbs = path.length > 1 ? '<div class="crumbs">' + path.map((p, i) => '<a href="#/materials/' + path.slice(0, i + 1).map(encodeURIComponent).join("/") + '">' + esc((nodeAt(path.slice(0, i + 1)) || {}).label || p) + "</a>").join(icon("arrow", 12)) + "</div>" : "";
  h += '<header class="thead hued" style="--h:' + hueFor(top) + '">' + crumbs + '<div class="thead-t"><span class="tdot lg"></span><h1>' + esc(here.label) + "</h1></div>" + (here.hint ? "<p>" + esc(here.hint) + "</p>" : "") +
    '<div class="thead-s"><div><b>' + c + "</b><span>" + (c === 1 ? "file" : "files") + "</span></div>" + (here.kids.some(k => k.dir) ? "<div><b>" + here.kids.filter(k => k.dir).length + "</b><span>folders</span></div>" : "") + "</div></header>";
  if (problem) h += '<div class="banner warn">' + icon("alert", 15) + "<span>" + esc(problem) + "</span></div>";
  if (c > 6) h += searchBox("Search in " + here.label);
  const list = () => {
    if (!here.kids.length) return '<div class="empty">' + icon("archive", 28) + "<b>Nothing here yet</b>Drop a PDF in <code>" + esc(path.join("/")) + "/</code> and push &mdash; it shows up here on its own.</div>";
    return '<ul class="list stagger">' + here.kids.map(n => n.dir
      ? '<li><a class="li hued" style="--h:' + hueFor(top) + '" href="#/materials/' + path.concat(n.name).map(encodeURIComponent).join("/") + '"><span class="ficon dir">' + icon("topics", 16) + '</span><div class="t"><b>' + esc(n.label) + "</b><small>" + plural(countFiles(n), "file") + '</small></div><div class="r">' + icon("arrow", 14) + "</div></a></li>"
      : fileRow(n, "", top)).join("") + "</ul>";
  };
  el.innerHTML = h + '<div id="mbody">' + (query && c > 6 ? results(top) : list()) + "</div>";
  if (c > 6) bindSearch(el, top, list);
}
