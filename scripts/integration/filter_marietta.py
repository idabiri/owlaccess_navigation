#!/usr/bin/env python3
"""Keep only Marietta-campus components (on_marietta_campus == true) in outdoor_nodes.json / outdoor_edges.json.
Reads the full-site files from full_sites/ and never edits them. usage: filter_marietta.py <integration_dir>"""
import json, sys, collections
D = sys.argv[1]
N = json.load(open(f"{D}/full_sites/outdoor_nodes.json")); E = json.load(open(f"{D}/full_sites/outdoor_edges.json"))
keep = {n["node_id"] for n in N["nodes"] if n["on_marietta_campus"]}
nodes = [n for n in N["nodes"] if n["node_id"] in keep]; edges = [e for e in E["edges"] if e["from_node"] in keep and e["to_node"] in keep]
dropped_e = [e for e in E["edges"] if (e["from_node"] in keep) != (e["to_node"] in keep)]
assert not dropped_e, "an edge straddles the filter boundary"
meta = {k: v for k, v in N.items() if k != "nodes"}; meta["scope"] = "Marietta campus only (components within 2 km of BLD001); full-site files are in full_sites/"
json.dump(dict(**meta, nodes=nodes), open(f"{D}/outdoor_nodes.json", "w"), indent=1); json.dump(dict(**meta, edges=edges), open(f"{D}/outdoor_edges.json", "w"), indent=1)
comps = collections.Counter(n["component_id"] for n in nodes)
print("nodes", len(N["nodes"]), "->", len(nodes), "| edges", len(E["edges"]), "->", len(edges), "| length_m", round(sum(e["distance"] for e in edges if e["edge_type"] != "entrance_link")), "| components", dict(comps))
