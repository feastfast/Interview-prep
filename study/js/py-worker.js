/* Runs the learner's Python in a Web Worker (Pyodide) so an infinite loop can be terminated. */
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");

const HARNESS = `
import json, sys, io, copy, math, traceback

def _norm(x):
    if isinstance(x, tuple): x = list(x)
    if isinstance(x, list): return [_norm(i) for i in x]
    if isinstance(x, dict): return {str(k): _norm(v) for k, v in x.items()}
    if isinstance(x, float):
        if math.isinf(x): return "inf" if x > 0 else "-inf"
        if math.isnan(x): return "nan"
    return x

def _eq(a, b, cmp):
    a, b = _norm(a), _norm(b)
    if cmp == "sorted" and isinstance(a, list) and isinstance(b, list):
        try: return sorted(a) == sorted(b)
        except TypeError: return sorted(map(str, a)) == sorted(map(str, b))
    if cmp == "sortedpairs" and isinstance(a, list) and isinstance(b, list):
        return sorted(map(lambda p: list(p), a)) == sorted(map(lambda p: list(p), b))
    return _close(a, b)

def _close(a, b):
    if isinstance(a, float) or isinstance(b, float):
        try: return abs(float(a) - float(b)) <= 1e-6 * max(1.0, abs(float(b)))
        except Exception: return False
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_close(x, y) for x, y in zip(a, b))
    return a == b

def run(code, spec_json):
    spec = json.loads(spec_json)
    buf = io.StringIO(); old = sys.stdout; sys.stdout = buf
    out = {"results": [], "stdout": "", "error": ""}
    try:
        ns = {"__name__": "__main__"}
        try:
            exec(compile(code, "<your code>", "exec"), ns)
        except BaseException:
            e = sys.exc_info()
            frames = [f for f in traceback.extract_tb(e[2]) if f.filename == "<your code>"]
            out["error"] = "".join(traceback.format_list(frames)) + "".join(traceback.format_exception_only(e[0], e[1]))
            return out
        kind = spec["kind"]
        for case in spec["cases"]:
            r = {"ok": False, "label": case.get("label", ""), "expected": case.get("e"), "got": None, "err": ""}
            try:
                if kind == "func":
                    r["label"] = r["label"] or (", ".join(json.dumps(a) for a in case["a"]))
                    fn = ns.get(spec["fn"])
                    if fn is None:
                        raise NameError("function '%s' is not defined" % spec["fn"])
                    args = copy.deepcopy(case["a"])
                    got = fn(*args)
                    r["got"] = _norm(got)
                    r["ok"] = _eq(got, case["e"], spec.get("cmp", "eq"))
                    r["label"] = r["label"] or (", ".join(json.dumps(a) for a in case["a"]))
                else:
                    cls = ns.get(spec["cls"])
                    if cls is None:
                        raise NameError("class '%s' is not defined" % spec["cls"])
                    obj = cls(*case.get("ctor", []))
                    log, ok = [], True
                    for name, args, exp in case["ops"]:
                        got = getattr(obj, name)(*args)
                        good = True if exp is None else _eq(got, exp, "eq")
                        log.append("%s(%s) -> %s" % (name, ", ".join(json.dumps(a) for a in args), json.dumps(_norm(got))) + ("" if good else "   [expected %s]" % json.dumps(exp)))
                        if not good: ok = False; break
                    r["ok"] = ok; r["got"] = "; ".join(log[-3:]); r["label"] = r["label"] or ("%d operations" % len(case["ops"]))
                    r["expected"] = "all operations return the expected values"
            except BaseException:
                r["err"] = traceback.format_exc(limit=3).strip().splitlines()[-1]
            out["results"].append(r)
    finally:
        sys.stdout = old
        out["stdout"] = buf.getvalue()[:4000]
    return out
`;

let ready = null;
async function boot() {
  const py = await loadPyodide();
  py.runPython(HARNESS);
  return py;
}

self.onmessage = async e => {
  const { id, code, spec } = e.data;
  try {
    if (!ready) { postMessage({ id, status: "loading" }); ready = boot(); }
    const py = await ready;
    postMessage({ id, status: "running" });
    py.globals.set("USER_CODE", code);
    py.globals.set("SPEC_JSON", JSON.stringify(spec));
    const result = py.runPython("json.dumps(run(USER_CODE, SPEC_JSON))");
    postMessage({ id, status: "done", result: JSON.parse(result) });
  } catch (err) {
    postMessage({ id, status: "done", result: { results: [], stdout: "", error: String(err.message || err) } });
  }
};
