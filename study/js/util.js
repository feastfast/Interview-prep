export const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

/* Tiny, safe markdown: ``` fences, `code`, **bold**, *italic*, - lists, blank-line paragraphs. */
export function md(src) {
  if (!src) return "";
  const parts = String(src).split(/(```[\s\S]*?```)/g);
  return parts.map(p => {
    if (p.startsWith("```")) {
      const body = p.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").replace(/\n$/, "");
      return "<pre><code>" + esc(body) + "</code></pre>";
    }
    return p.split(/\n{2,}/).map(block => {
      const lines = block.split("\n");
      if (lines.every(l => /^\s*[-*] /.test(l))) return "<ul>" + lines.map(l => "<li>" + inline(l.replace(/^\s*[-*] /, "")) + "</li>").join("") + "</ul>";
      if (lines.every(l => /^\s*\d+[.)] /.test(l))) return "<ol>" + lines.map(l => "<li>" + inline(l.replace(/^\s*\d+[.)] /, "")) + "</li>").join("") + "</ol>";
      const t = block.trim();
      return t ? "<p>" + lines.map(inline).join("<br>") + "</p>" : "";
    }).join("");
  }).join("");
}
function inline(t) {
  return esc(t)
    .replace(/`([^`]+)`/g, (_, c) => "<code>" + c + "</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=$|[\s).,;:])/g, "$1<em>$2</em>");
}

export function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* Round-robin merge of several lists (keeps topics interleaved). */
export function interleave(lists) {
  const out = [];
  const ls = lists.map(l => l.slice());
  while (ls.some(l => l.length)) for (const l of ls) if (l.length) out.push(l.shift());
  return out;
}

export const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
export const ago = ts => {
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago";
};
export async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return r.json();
}
