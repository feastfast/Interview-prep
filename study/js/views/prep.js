import * as store from "../store.js";
import { esc, plural, $$ } from "../util.js";
import { icon } from "../ui.js";

/* "Before you solve": the guide pages worth reading for a problem, plus a short card / quiz warm-up on its pattern.
   The mapping lives in data/guides.json (built by study/tools/build_guide_map.py). Pages you have read are
   remembered per topic, so a page that an earlier problem already sent you to is not asked for again. */
const WARM_CARDS = 5, WARM_QUIZ = 3;

const key = (topic, page) => topic + ":" + page;
const pagesOf = ranges => ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
const isRead = (reads, topic, page) => !!(reads[key(topic, page)] && reads[key(topic, page)].r);
const label = ([a, b]) => (a === b ? "" + a : a + "–" + b);

function toRanges(pages) {
  const out = [];
  for (const p of pages.slice().sort((x, y) => x - y)) {
    if (out.length && p === out[out.length - 1][1] + 1) out[out.length - 1][1] = p;
    else out.push([p, p]);
  }
  return out;
}
const pdfHref = (guide, page) => guide.pdf.split("/").map(encodeURIComponent).join("/") + "#page=" + page;

function warmHref(kind, topic, groups, n, ret) {
  const base = kind === "cards" ? "#/cards/session?mode=all" : "#/quiz/session?r=" + Date.now();
  return base + "&decks=" + encodeURIComponent(topic) + "&topics=" + encodeURIComponent(groups.join("|")) + "&n=" + n + "&ret=" + encodeURIComponent(ret);
}

/* HTML for one problem, or "" when the guide has nothing mapped for it. */
export function prepStrip(D, topic, id, ret = "#/plan") {
  const guide = D.guides && D.guides.topics[topic];
  const m = guide && guide.problems[id];
  if (!m) return "";
  const reads = store.get().reads || {};
  const all = pagesOf(m.p), todo = all.filter(p => !isRead(reads, topic, p));
  const seen = all.length - todo.length;
  const nCards = Math.min(WARM_CARDS, D.cards.cards.filter(c => c.d === topic && m.c.includes(c.t)).length);
  const nQuiz = Math.min(WARM_QUIZ, D.quiz.questions.filter(q => q.d === topic && m.q.includes(q.t)).length);

  const links = ranges => ranges.map(r => '<a class="pp" href="' + esc(pdfHref(guide, r[0])) + '" target="_blank" rel="noopener">' + label(r) + "</a>").join(", ");
  const pp = n => (n === 1 ? "p. " : "pp. ");
  const doneRanges = toRanges(all.filter(p => !todo.includes(p)));
  const read = todo.length
    ? "<span>" + pp(todo.length) + links(toRanges(todo)) + '</span><span class="sub">· ' + esc(guide.label) + (seen ? " · already read " + doneRanges.map(label).join(", ") : "") + '</span><button class="linkbtn" data-prep="read">Mark read</button>'
    : '<span class="prep-ok">' + icon("check", 13) + "Read</span><span>" + pp(all.length) + links(m.p) + '</span><span class="sub">· ' + esc(guide.label) + '</span><button class="linkbtn" data-prep="unread">Undo</button>';

  let h = '<div class="prep" data-topic="' + esc(topic) + '" data-id="' + esc(id) + '"><div class="prep-r"><span class="prep-l">Read</span><div class="prep-c">' + read + "</div></div>";
  if (nCards || nQuiz) {
    h += '<div class="prep-r"><span class="prep-l">Warm up</span><div class="prep-c">' +
      (nCards ? '<a class="btn sm" href="' + esc(warmHref("cards", topic, m.c, nCards, ret)) + '">' + icon("cards", 14) + plural(nCards, "card") + "</a>" : "") +
      (nQuiz ? '<a class="btn sm" href="' + esc(warmHref("quiz", topic, m.q, nQuiz, ret)) + '">' + icon("quiz", 14) + plural(nQuiz, "question") + "</a>" : "") + "</div></div>";
  }
  if (m.n) h += '<div class="prep-n">' + esc(m.n) + "</div>";
  return h + "</div>";
}

/* One tap marks every page of the strip read (or, when all were read, clears them). */
export function bindPrep(el, ctx) {
  $$(".prep [data-prep]", el).forEach(b => b.onclick = e => {
    e.preventDefault();
    const box = b.closest(".prep"), topic = box.dataset.topic, m = ctx.D.guides.topics[topic].problems[box.dataset.id];
    const on = b.dataset.prep === "read", now = Date.now();
    store.commit(s => {
      s.reads = s.reads || {};
      for (const p of pagesOf(m.p)) s.reads[key(topic, p)] = { r: on ? 1 : 0, t: now };
    });
    ctx.rerender();
  });
}
