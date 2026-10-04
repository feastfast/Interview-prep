import * as store from "./store.js";
import { rawVersions } from "./merge.js";

/* Saved solutions for a problem, newest first (deleted ones hidden). */
export const liveVersions = p => rawVersions(p).filter(v => !v.del).sort((a, b) => (b.c || 0) - (a.c || 0));

const blank = v => !(v.label || v.time || v.space || (v.code || "").trim() || (v.notes || "").trim());

/* Create a version (no vid) or update one. An empty new version is not stored. Returns the version id, or null. */
export function saveVersion(id, draft, vid = null) {
  const now = Date.now();
  let saved = null;
  store.commit(s => {
    const p = s.probs[id];
    if (!p) return;
    const list = rawVersions(p).map(v => Object.assign({}, v));
    const fields = { label: (draft.label || "").trim(), time: (draft.time || "").trim(), space: (draft.space || "").trim(), code: draft.code || "", notes: draft.notes || "" };
    const cur = vid ? list.find(v => v.id === vid) : null;
    if (cur) { Object.assign(cur, fields, { t: now }); saved = cur.id; }
    else if (!blank(fields)) { saved = "v" + now.toString(36) + Math.random().toString(36).slice(2, 5); list.push(Object.assign({ id: saved, c: now, t: now }, fields)); }
    p.versions = list;
    if (saved) p.t = now;
  });
  return saved;
}

export function removeVersion(id, vid) {
  const now = Date.now();
  store.commit(s => {
    const p = s.probs[id];
    if (!p) return;
    p.versions = rawVersions(p).map(v => v.id === vid ? Object.assign({}, v, { del: true, code: "", notes: "", t: now }) : v);
    p.t = now;
  });
}
