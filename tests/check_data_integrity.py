#!/usr/bin/env python3
"""Repository data checks (standard library only).  Usage, from the repo root:  python tests/check_data_integrity.py
1. The app's runtime copies in app/public/data/ are identical to the canonical files in data/ (floor SVGs: identical
   once the embedded C2PA Content Credentials block, added when the files were delivered, is removed).
2. The unified routing graph loads, and its counts match what the documentation states.
3. The original GeoJSON sources still have the SHA-256 hashes recorded when the integration was built (entrance_review.json).
4. Every file listed in docs/FILE_MANIFEST.csv exists with the recorded hash (git-ignored reference maps may be absent).
Exit code 1 on any failure."""
import csv, hashlib, json, os, re, sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
P = lambda *a: os.path.join(ROOT, *a)
fails, passes = [], 0
def check(name, ok, detail=""):
    global passes
    if ok: passes += 1; print("PASS", name)
    else: fails.append(name); print("FAIL", name, detail)
def sha(p):
    with open(p, "rb") as f: return hashlib.sha256(f.read()).hexdigest()
def strip_c2pa(b: bytes) -> bytes:
    b = re.sub(rb"<metadata>\s*<c2pa:manifest>.*?</c2pa:manifest>\s*</metadata>\s*", b"", b, flags=re.S)
    return b.replace(b' xmlns:c2pa="http://c2pa.org/manifest"', b"")

# 1. app copies == canonical data
pairs = {"unified_routing_graph.json": "data/integrated/unified_routing_graph.json",
         "indoor_outdoor_connectors.json": "data/integrated/indoor_outdoor_connectors.json",
         "outdoor_edges.json": "data/outdoor/processed/outdoor_edges.json",
         "buildings_marietta.geojson": "data/outdoor/processed/buildings_marietta.geojson"}
for app_f, canon in pairs.items():
    check(f"app/public/data/{app_f} == {canon}", sha(P("app", "public", "data", app_f)) == sha(P(*canon.split("/"))))
for n in (1, 2, 3):
    a = open(P("app", "public", "data", f"floor_{n}.svg"), "rb").read(); c = open(P("data", "indoor", "BLD001", f"floor_{n}.svg"), "rb").read()
    check(f"app/public/data/floor_{n}.svg == data/indoor/BLD001/floor_{n}.svg (ignoring C2PA block)", strip_c2pa(a) == strip_c2pa(c))
check("scenario fixture copies agree", sha(P("app", "tests", "fixtures", "scenarios.json")) == sha(P("tests", "routing", "scenarios.json")))

# 2. unified graph
g = json.load(open(P("data", "integrated", "unified_routing_graph.json"), encoding="utf-8"))
check("unified graph: 580 nodes, 700 edges", (len(g["nodes"]), len(g["edges"])) == (580, 700), (len(g["nodes"]), len(g["edges"])))
ids = {n["node_id"] for n in g["nodes"]}
check("unified graph: every edge references existing nodes", all(e["from_node"] in ids and e["to_node"] in ids for e in g["edges"]))
check("unified graph: 6 obstacles, 7 scenarios", (len(g["obstacles"]), len(g["scenarios"])) == (6, 7))
conn = json.load(open(P("data", "integrated", "indoor_outdoor_connectors.json"), encoding="utf-8"))["connectors"]
linked = [c for c in conn if c.get("outdoor_node_id")]
check("exactly one outdoor<->indoor connector is linked (entrance_2, provisional)", len(linked) == 1 and linked[0]["indoor_feature_id"] == "entrance_2", [c["indoor_feature_id"] for c in linked])

# 3. source GeoJSON unchanged since the integration was built
rev = json.load(open(P("data", "outdoor", "processed", "entrance_review.json"), encoding="utf-8"))
for f, h in rev["source_sha256"].items():
    check(f"source {f} SHA-256 matches entrance_review.json", sha(P("data", "outdoor", "source", f)) == h)

# 4. manifest
missing, changed = [], []
with open(P("docs", "FILE_MANIFEST.csv"), encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        p = P(*r["repo_path"].split("/"))
        if not os.path.exists(p):
            if "git-ignored" not in r["role"]: missing.append(r["repo_path"])
        elif r["role"] != "app" and sha(p) != r["sha256"]: changed.append(r["repo_path"])
check("every non-app file in docs/FILE_MANIFEST.csv is present", not missing, missing[:5])
check("data, audit, script and doc files are unchanged from their originals", not changed, changed[:5])

print(f"\n{passes} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
