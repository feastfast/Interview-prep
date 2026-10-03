"""Builds study/data/guides.json: for each problem, the study-guide pages to read before solving it and the
flashcard / quiz groups to warm up with.

    python study/tools/build_guide_map.py            # every spec in study/tools/guide_specs/
    python study/tools/build_guide_map.py heap       # just one topic

A spec (guide_specs/<topic>.json) lists the guide's patterns (essential pages + card/quiz groups), how the
pattern labels in problems.json map to them, and manual entries for problems that have no label. A problem's
pages are its pattern essentials plus the guide section whose heading names the problem (by LeetCode number
or title). The script validates page numbers against the PDF and group names against cards.json / quiz.json.
Requires PyMuPDF (pip install pymupdf).
"""
import glob
import json
import os
import re
import sys

import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
STUDY = os.path.dirname(HERE)
ROOT = os.path.dirname(STUDY)
DATA = os.path.join(STUDY, "data")
ALIASES = {"arrays-hashing": "arrays", "arrays": "arrays", "heap-priority-queue": "heap", "priority-queue": "heap", "dp": "dynamic-programming"}
HEAD = re.compile(r"^(Part \d+\b|\d+\.\d+\s|\d+[A-Z]\.\s)")


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


def slug(s):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def lc_number(s):
    m = re.search(r"(\d+)", str(s or ""))
    return int(m.group(1)) if m else 0


def pool_for(topic, plan, problems):
    """The problems the planner can show for a topic: curated list entries plus problems.json ones for that topic."""
    by_app = {p["id"]: p for p in problems}
    out = {}
    for e in plan["lists"].get(topic, []):
        if e.get("app"):
            p = by_app.get(e["app"])
            if p:
                out[p["id"]] = {"id": p["id"], "title": p["title"], "lc": lc_number(p.get("lc")), "label": p.get("pattern")}
        else:
            out["lc-%s" % e["lc"]] = {"id": "lc-%s" % e["lc"], "title": e["title"], "lc": int(e["lc"]), "label": None}
    for p in problems:
        if (ALIASES.get(slug(p.get("topicLabel") or p["topic"])) or slug(p.get("topicLabel") or p["topic"])) == topic and p["id"] not in out:
            out[p["id"]] = {"id": p["id"], "title": p["title"], "lc": lc_number(p.get("lc")), "label": p.get("pattern")}
    return list(out.values())


def sections(pages, head=HEAD):
    """[(first_page, last_page, heading_text)] for every heading, in reading order."""
    heads = []
    for pno, text in enumerate(pages, 1):
        lines = text.splitlines()
        off = 0
        for i, line in enumerate(lines):
            s = line.strip()
            if head.match(s):
                nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
                # a wrapped heading continues on the next line; a container heading is followed by its first child heading
                heads.append((pno, off, s if head.match(nxt) else s + " " + nxt))
            off += len(line) + 1
    out = []
    for k, (p, _, txt) in enumerate(heads):
        if k + 1 < len(heads):
            np_, noff, _ = heads[k + 1]
            end = np_ if noff >= 250 else np_ - 1      # next heading near the top of its page: this one ended before it
            end = max(end, p)
        else:
            end = len(pages)
        out.append((p, end, txt))
    return out


def ranges(pages):
    pages = sorted(set(pages))
    out = []
    for p in pages:
        if out and p == out[-1][1] + 1:
            out[-1][1] = p
        else:
            out.append([p, p])
    return out


def build(spec_path, plan, problems, cards, quiz):
    spec = json.load(open(spec_path, encoding="utf-8"))
    topic = spec["topic"]
    doc = fitz.open(os.path.join(ROOT, spec["pdf"]))
    pages = [p.get_text() for p in doc]
    head = re.compile(spec["heading"]) if spec.get("heading") else HEAD
    secs = sections(pages, head)
    card_groups = {(c["d"], c["t"]) for c in cards["cards"]}
    quiz_groups = {(q["d"], q["t"]) for q in quiz["questions"]}
    problems_out, problems_report, errors = {}, [], []

    for key, pat in spec["patterns"].items():
        for a, b in pat["essence"]:
            if not 1 <= a <= b <= len(pages):
                errors.append("pattern %s: pages %s-%s are outside the %d-page PDF" % (key, a, b, len(pages)))
        for c in pat["cards"]:
            if (topic, c) not in card_groups:
                errors.append("pattern %s: no card group %r in deck %s" % (key, c, topic))
        for q in pat["quiz"]:
            if (topic, q) not in quiz_groups:
                errors.append("pattern %s: no quiz group %r in deck %s" % (key, q, topic))

    for pr in pool_for(topic, plan, problems):
        manual = spec.get("assign", {}).get(pr["id"], {})
        if manual.get("patterns"):
            read_keys = warm_keys = manual["patterns"]
        elif pr["label"] in spec["labels"]:
            m = spec["labels"][pr["label"]]
            read_keys, warm_keys = (m["read"], m["warm"]) if isinstance(m, dict) else (m, m)
        else:
            errors.append("%s (%s): pattern label %r has no mapping" % (pr["id"], pr["title"], pr["label"]))
            continue
        pg = set()
        for k in read_keys:
            for a, b in spec["patterns"][k]["essence"]:
                pg.update(range(a, b + 1))
        home = [s for s in secs if (pr["lc"] and re.search(r"(LeetCode|LC)\s*#?%d\b" % pr["lc"], s[2])) or pr["title"].lower() in s[2].lower()]
        home = [s for s in home if not any(s[2].startswith(x) for x in manual.get("ignore", []))]
        for a, b, _ in home:
            pg.update(range(a, b + 1))
        for a, b in manual.get("pages", []):
            pg.update(range(a, b + 1))
        entry = {"p": ranges(pg)}
        cg = [c for k in warm_keys for c in spec["patterns"][k]["cards"]]
        qg = [q for k in warm_keys for q in spec["patterns"][k]["quiz"]]
        entry["c"], entry["q"] = list(dict.fromkeys(cg)), list(dict.fromkeys(qg))
        if manual.get("note"):
            entry["n"] = manual["note"]
        if not home and not manual.get("pages") and not manual.get("note") and pr["id"] not in spec.get("assign", {}):
            errors.append("%s (%s): the guide has no section for it; add an assign entry with a note" % (pr["id"], pr["title"]))
        problems_out[pr["id"]] = entry
        problems_report.append((pr["id"], pr["title"], pr["label"] or "(curated)", entry["p"], len(pg), [h[2][:40] for h in home]))
    return topic, {"label": spec["label"], "pdf": spec["pdf"], "pages": len(pages), "problems": problems_out}, problems_report, errors


def main():
    only = set(sys.argv[1:])
    plan, probs = load("plan.json"), load("problems.json")["problems"]
    cards, quiz = load("cards.json"), load("quiz.json")
    out_path = os.path.join(DATA, "guides.json")
    result = json.load(open(out_path, encoding="utf-8")) if os.path.exists(out_path) else {"v": 1, "topics": {}}
    failed = False
    for spec_path in sorted(glob.glob(os.path.join(HERE, "guide_specs", "*.json"))):
        if only and os.path.splitext(os.path.basename(spec_path))[0] not in only:
            continue
        topic, entry, report, errors = build(spec_path, plan, probs, cards, quiz)
        print("== %s (%d problems)" % (topic, len(report)))
        for pid, title, label, rng, n, heads in report:
            print("  %-22s %-38s %-28s %-22s %2d pp  %s" % (pid, title[:38], label[:28], ",".join("%d-%d" % (a, b) if a != b else str(a) for a, b in rng), n, heads))
        for e in errors:
            print("  ERROR:", e)
        failed = failed or bool(errors)
        if not errors:
            result["topics"][topic] = entry
    if failed:
        sys.exit("not written: fix the errors above")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", out_path)


if __name__ == "__main__":
    main()
