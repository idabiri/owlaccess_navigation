#!/usr/bin/env python3
"""
SYNTHETIC / MOCK indoor-map generator for KSU Marietta - BLD001 (H, Academic Building).
Footprint = real (OSM-derived) polygon from buildings.geojson. Everything inside is invented.

usage: generate_indoor.py [uploads_dir] [out_dir]
"""
import json, math, os, sys
from shapely.geometry import box, LineString, Point
from shapely.ops import unary_union

UPLOADS = sys.argv[1] if len(sys.argv) > 1 else "/mnt/user-data/uploads"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/mnt/user-data/outputs/indoor-mapping"
BID = "BLD001"
BNAME = "H - Academic Building"
SCALE, OX, OY, H = 10.0, 150.0, 110.0, 90.0      # 1 SVG unit = 0.1 m ; origin top-left ; y flipped
VBW, VBH = 680, 1120
WALK = 1.2                                          # m/s synthetic
SPEEDS = {"hallway": 1.2, "door": 1.0, "room_interior": 1.2, "entrance_threshold": 1.0,
          "elevator_door": 1.0, "stair_landing": 1.0, "ramp": 0.8, "entrance_steps": 0.4}
NARROW_FACTOR = 0.85
FLOORS = [1, 2, 3]
FLOOR_NAMES = {1: "Ground floor", 2: "Second floor", 3: "Third floor"}

def sx(x): return round(OX + x * SCALE, 1)
def sy(y): return round(OY + (H - y) * SCALE, 1)
def fid(f): return f"{BID}_F{f}"

# ---------------------------------------------------------------- footprint from GeoJSON
LAT0 = 33.937
def to_local(lon, lat): return (lon * 111320 * math.cos(math.radians(LAT0)), lat * 110574)
gj = json.load(open(os.path.join(UPLOADS, "buildings.geojson")))
feat = [f for f in gj["features"] if f["properties"].get("building_id") == BID][0]
ring = feat["geometry"]["coordinates"][0]
loc = [to_local(*c) for c in ring]
x0, y0 = min(p[0] for p in loc), min(p[1] for p in loc)
FOOT = []
for p in loc[:-1]:
    q = (round(p[0] - x0, 1), round(p[1] - y0, 1))
    if not FOOT or q != FOOT[-1]: FOOT.append(q)
assert len(FOOT) == 25, len(FOOT)
LON0, LAT_MIN = min(c[0] for c in ring), min(c[1] for c in ring)
from shapely.geometry import Polygon
F = Polygon(FOOT); assert F.is_valid
U = F.buffer(-0.25, join_style=2)
BOUND = F.exterior

def clip(rect):
    g = box(*rect).intersection(U)
    if g.geom_type != "Polygon":
        g = max(g.geoms, key=lambda p: p.area)
    return g
def ppath(poly):
    pts = list(poly.exterior.coords)[:-1]
    return "M" + " L".join(f"{sx(x)} {sy(y)}" for x, y in pts) + " Z"
def bbox_units(poly):
    pts = [(sx(x), sy(y)) for x, y in poly.exterior.coords]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return round(min(xs), 1), round(min(ys), 1), round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1)
def snap(x, y):
    p = BOUND.interpolate(BOUND.project(Point(x, y)))
    return p.x, p.y

# ---------------------------------------------------------------- hallway definitions (same on every floor)
HALL = [  # idx, name, rect, narrow, synthetic width
    (1, "Main corridor (south)", (11, -1, 14, 19), False, 3.0),
    (2, "West branch corridor", (-1, 19, 11, 21), True, 2.0),
    (3, "Main corridor (central)", (11, 19, 14, 52.9), False, 3.0),
    (4, "East branch corridor (ramp entrance)", (14, 52.9, 28.5, 55.9), False, 3.0),
    (5, "Main corridor (mid-north)", (11, 52.9, 14, 65.5), False, 3.0),
    (6, "East cross corridor", (14, 65.5, 33, 68.5), False, 3.0),
    (7, "Main corridor (north)", (11, 65.5, 14, 76), False, 3.0),
    (8, "East link corridor", (20.5, 55.9, 22.5, 65.5), True, 2.0),
]
SHAFTS = {1: (3.0, 56.5, 6.0, 59.5), 2: (3.0, 59.5, 6.0, 62.5)}   # elevator shafts (inside room xx05)
STAIR_ROOM_SUFFIX = {1: 9, 2: 16}

# ---------------------------------------------------------------- room specs
def R(suffix, name, rtype, rect, door, **kw):
    d = dict(suffix=suffix, name=name, type=rtype, rect=rect, door=door, nav=True, accessible=True,
             kind=None, width=1.2, dest=None, label_pt=None, notes="")
    d.update(kw); return d
def V(x, y, wpx=None): return dict(x=x, y=y, o="v", wp=(wpx if wpx is not None else (12.5 if x < 15 else x - 1.0), y))
def Hh(x, y, wpy): return dict(x=x, y=y, o="h", wp=(x, wpy))

def rooms_for(fl):
    c = {}
    common = [
        R(5, "Elevator Lobby", "elevator_lobby", (-1, 56, 11, 63), V(11, 59.5, 12.5), kind="elevator_lobby", width=3.0, label_pt=(8.6, 60.4), label_w=4.4),
        R(6, "Restroom (Men)", "restroom", (-1, 63, 11, 67), V(11, 64.8), kind="restroom",
          notes="Synthetic: standard restroom; accessible-stall assumption unverified."),
        R(7, "Restroom (Women)", "restroom", (-1, 67, 11, 71), V(11, 69.0), kind="restroom",
          notes="Synthetic: standard restroom; accessible-stall assumption unverified."),
        R(8, "Accessible Restroom", "accessible_restroom", (-1, 71, 11, 76), V(11, 73.5), kind="restroom",
          notes="Synthetic designated single-user accessible restroom (unverified)."),
        R(9, "Stairwell 1", "stairwell", (14, -1, 19, 16), V(14, 12.0), kind="stairwell", accessible=False),
        R(10, "Mechanical Room", "service", (19, -1, 26, 16), None, nav=False, accessible=False, kind="service",
          notes="Non-navigable service space; intentionally has no graph nodes."),
        R(16, "Stairwell 2", "stairwell", (14, 68.5, 19, 76), Hh(16.5, 68.5, 67.0), kind="stairwell", accessible=False),
        R(18, "Main Lobby" if fl == 1 else "Open Study Area", "lobby" if fl == 1 else "open_study_area",
          (-1, 76, 20, 91), dict(x=12.5, y=76.0, o="h", wp=(12.5, 75.0)), width=3.0, dest=(8.0, 81.0), label_pt=(7.0, 86.0), kind="lobby"),
        R(19, "Student Collaboration Space" if fl != 2 else "Collaboration Lounge", "collaboration_space",
          (20, 76, 33, 91), dict(x=20.0, y=83.8, o="v", wp=(19.0, 83.8)), dest=(23.0, 83.8), label_pt=(25.0, 80.0)),
    ]
    if fl == 1:
        spec = [
            R(1, "Lecture Hall", "lecture_room", (-1, -1, 11, 19), V(11, 8.0)),
            R(2, "Classroom", "classroom", (-1, 21, 11, 33), V(11, 27.0)),
            R(3, "Classroom", "classroom", (-1, 33, 11, 45), V(11, 39.0)),
            R(4, "Department Office", "department_office", (-1, 45, 11, 56), V(11, 50.5)),
            R(11, "Classroom", "classroom", (14, 16, 26, 28), V(14, 24.0)),
            R(12, "Computer Lab", "computer_lab", (14, 28, 26, 40), V(14, 34.0)),
            R(13, "Advising Reception", "reception", (14, 40, 26, 52.9), V(14, 46.5)),
            R(14, "Study Room", "study_room", (14, 55.9, 20.5, 65.5), Hh(17.0, 55.9, 54.4)),
            R(15, "Classroom", "classroom", (22.5, 55.9, 33, 65.5), V(22.5, 60.7, 21.5)),
            R(17, "Classroom", "classroom", (19, 68.5, 33, 76), Hh(25.5, 68.5, 67.0)),
        ]
    elif fl == 2:
        spec = [
            R(1, "Computer Lab", "computer_lab", (-1, -1, 11, 19), V(11, 8.0)),
            R(2, "Research Lab", "research_lab", (-1, 21, 11, 33), V(11, 27.0)),
            R(3, "Research Lab", "research_lab", (-1, 33, 11, 39), V(11, 36.0)),
            R(20, "Research Lab", "research_lab", (-1, 39, 11, 45), V(11, 42.0)),
            R(4, "Faculty Office Suite", "faculty_office", (-1, 45, 11, 50), V(11, 47.5)),
            R(21, "Faculty Office Suite", "faculty_office", (-1, 50, 11, 56), V(11, 52.5)),
            R(11, "Lecture Hall", "lecture_room", (14, 16, 26, 28), V(14, 24.0)),
            R(12, "Classroom", "classroom", (14, 28, 26, 40), V(14, 34.0)),
            R(13, "Break Room", "break_room", (14, 40, 26, 52.9), V(14, 46.5)),
            R(14, "Conference Room", "conference_room", (14, 55.9, 20.5, 65.5), Hh(17.0, 55.9, 54.4)),
            R(15, "Computer Lab", "computer_lab", (22.5, 55.9, 33, 65.5), V(22.5, 60.7, 21.5)),
            R(17, "Department Office", "department_office", (19, 68.5, 33, 76), Hh(25.5, 68.5, 67.0)),
        ]
    else:
        spec = [
            R(1, "Research Lab", "research_lab", (-1, -1, 11, 19), V(11, 8.0)),
            R(2, "Research Lab", "research_lab", (-1, 21, 11, 33), V(11, 27.0)),
            R(3, "Computer Lab", "computer_lab", (-1, 33, 11, 45), V(11, 39.0)),
            R(4, "Faculty Office Suite", "faculty_office", (-1, 45, 11, 56), V(11, 50.5)),
            R(11, "Conference Room", "conference_room", (14, 16, 26, 21.5), V(14, 18.0)),
            R(21, "Study Room", "study_room", (14, 21.5, 26, 28), V(14, 24.5)),
            R(12, "Research Lab", "research_lab", (14, 28, 26, 40), V(14, 34.0)),
            R(13, "Faculty Office Suite", "faculty_office", (14, 40, 26, 46.5), V(14, 43.2)),
            R(22, "Faculty Office Suite", "faculty_office", (14, 46.5, 26, 52.9), V(14, 49.7)),
            R(14, "Conference Room", "conference_room", (14, 55.9, 20.5, 65.5), Hh(17.0, 55.9, 54.4)),
            R(15, "Research Lab", "research_lab", (22.5, 55.9, 33, 65.5), V(22.5, 60.7, 21.5)),
            R(17, "Classroom", "classroom", (19, 68.5, 33, 76), Hh(25.5, 68.5, 67.0)),
        ]
    out = sorted(common + spec, key=lambda r: r["suffix"])
    for r in out:
        r["room_number"] = f"{fl}{r['suffix']:02d}"
        r["room_id"] = f"room_{r['room_number']}"
        r["full_name"] = (r["name"] if r["kind"] in ("stairwell", "lobby", "service") and r["name"] != "Student Collaboration Space"
                          and r["name"] not in ("Open Study Area",)
                          else r["name"]) + ("" if r["kind"] in ("stairwell", "lobby", "service", "elevator_lobby") and r["name"] in
                                              ("Stairwell 1", "Stairwell 2", "Main Lobby", "Open Study Area", "Mechanical Room") else "")
        r["display"] = r["name"] if r["name"].startswith("Stairwell") else f"{r['name']} {r['room_number']}"
    return out

# ---------------------------------------------------------------- build everything
NODES, EDGES, CONNS, ROOMS, FEATS = [], [], [], [], dict(entrances=[], elevators=[], stairwells=[], ramps=[], doors=[], fountains=[])
SPACES = {}      # floor -> {id: polygon(m)}
DOORS_M = {}     # floor -> [(door_id,x,y,w)]
NMETERS = {}     # node -> (xm, ym)
NODE_BY_ID = {}
SVG_DATA = {}

def add_node(fl, nid, ntype, xm, ym, room_id=None, accessible=True, label=None):
    assert nid not in NODE_BY_ID, nid
    n = dict(node_id=nid, building_id=BID, floor_id=fid(fl), node_type=ntype, x=sx(xm), y=sy(ym), room_id=room_id,
             accessible=accessible, verified=False, synthetic=True, label=label or nid)
    NODES.append(n); NODE_BY_ID[nid] = n; NMETERS[nid] = (xm, ym)
    return nid

ecount = {}
def add_edge(fl, a, b, etype, space_id, accessible=True, stairs_only=False, narrow=False, note=""):
    na, nb = NODE_BY_ID[a], NODE_BY_ID[b]
    dist = math.hypot(na["x"] - nb["x"], na["y"] - nb["y"]) / SCALE
    sp = SPEEDS[etype] * (NARROW_FACTOR if narrow else 1.0)
    ecount[fl] = ecount.get(fl, 0) + 1
    e = dict(edge_id=f"e_f{fl}_{ecount[fl]:03d}", building_id=BID, floor_id=fid(fl), from_node=a, to_node=b,
             distance=round(dist, 2), distance_unit="meters", travel_time=round(dist / sp, 2), edge_type=etype,
             accessible=accessible, stairs_only=stairs_only, obstacle_status="none", obstacle_id=None, verified=False,
             synthetic=True, bidirectional=True, space_id=space_id, potentially_narrow=narrow, notes=note)
    EDGES.append(e); return e

def hall_for_spine(fl, ymid):
    base = (fl - 1) * 8
    if ymid < 19: i = 1
    elif ymid < 52.9: i = 3
    elif ymid < 65.5: i = 5
    else: i = 7
    return f"hallway_{base + i}", i

def build_floor(fl):
    rooms = rooms_for(fl); base = (fl - 1) * 8
    sp, doors = {}, []
    halls = []
    for idx, name, rect, narrow, wid in HALL:
        poly = clip(rect); hid = f"hallway_{base + idx}"
        sp[hid] = poly; halls.append(dict(id=hid, name=name, poly=poly, narrow=narrow, width=wid, idx=idx))
    for r in rooms:
        r["poly"] = clip(r["rect"]); sp[r["room_id"]] = r["poly"]
    shafts = {}
    for k, rect in SHAFTS.items():
        shafts[k] = box(*rect); sp[f"elevator_{k}@f{fl}"] = shafts[k]
    SPACES[fl] = sp

    P = f"n_f{fl}_"
    # ---- hallway skeleton nodes
    J = {}
    def hn(name, ntype, x, y, room_id=None):
        J[name] = add_node(fl, P + name, ntype, x, y, room_id); return J[name]
    hn("S0", "hallway_waypoint", 12.5, 4.5)
    hn("J1", "hallway_intersection", 12.5, 20.0)
    hn("J2", "hallway_intersection", 12.5, 54.4)
    hn("J3", "hallway_intersection", 12.5, 67.0)
    hn("N0", "hallway_waypoint", 12.5, 75.0)
    hn("C4m", "hallway_waypoint", 6.0, 20.0)
    hn("J4", "hallway_intersection", 21.5, 54.4)
    hn("J5", "hallway_intersection", 21.5, 67.0)
    hn("L2", "hallway_intersection", 12.5, 83.8, f"room_{fl}18")
    hn("L3", "hallway_waypoint", 2.5, 83.8, f"room_{fl}18")
    spine = [("S0", 4.5), ("J1", 20.0), ("J2", 54.4), ("J3", 67.0), ("N0", 75.0)]
    c2 = [("J2", 12.5), ("J4", 21.5)]
    link = [("J4", 54.4), ("J5", 67.0)]
    c3 = [("J3", 12.5), ("J5", 21.5)]

    # ---- rooms: doors / nodes
    for r in rooms:
        rid, num, d = r["room_id"], r["room_number"], r["door"]
        cp = r["poly"]
        x, y, w, h = bbox_units(cp)
        r["bbox"] = (x, y, w, h)
        if not r["nav"]:
            continue
        o = d["o"]; dx, dy = d["x"], d["y"]
        inward = (0, 1) if (o == "h" and r["kind"] != "stairwell" and (r["rect"][1] >= dy - 0.01)) else None
        # inward direction from rect position relative to door
        cx = (r["rect"][0] + r["rect"][2]) / 2; cy = (r["rect"][1] + r["rect"][3]) / 2
        iv = (1 if cx > dx else -1, 0) if o == "v" else (0, 1 if cy > dy else -1)
        r["inward"] = iv
        did = f"door_{num}"
        doors.append((did, dx, dy, r["width"]))
        r["door_id"] = did
        re_id = add_node(fl, P + f"re_{num}", "room_entrance", dx, dy, rid, accessible=r["accessible"])
        r["re"] = re_id
        # hallway/circulation waypoint
        wpx, wpy = d["wp"]
        wp_name = f"wp_{num}"
        if r["kind"] == "lobby":
            wp = J["N0"]
        elif r["suffix"] == 19:
            wp = add_node(fl, P + "L4", "hallway_waypoint", wpx, wpy, f"room_{fl}18")
        else:
            wp = add_node(fl, P + wp_name, "hallway_waypoint", wpx, wpy)
        r["wp"] = wp
        add_edge(fl, re_id, wp, "door", rid, accessible=r["accessible"] or r["kind"] == "stairwell" and False,
                 note="door/opening (synthetic position)")
        # chain membership
        if wpx == 12.5 and r["kind"] != "lobby" and r["suffix"] != 19: spine.append((wp_name, wpy))
        elif wpy == 54.4 and wpx != 12.5: c2.append((wp_name, wpx))
        elif wpx == 21.5: link.append((wp_name, wpy))
        elif wpy == 67.0: c3.append((wp_name, wpx))
        # destination / stair node
        if r["kind"] == "stairwell":
            sxm, sym = dx + iv[0] * 2.5, dy + iv[1] * 2.5
            sk = 1 if r["suffix"] == 9 else 2
            stn = add_node(fl, P + f"stair_{sk}", "staircase", sxm, sym, rid, accessible=False)
            r["stair_node"] = stn
            add_edge(fl, re_id, stn, "stair_landing", rid, accessible=False, stairs_only=True,
                     note="landing leading only to stairs")
        else:
            if r["dest"]: ex, ey = r["dest"]
            else: ex, ey = dx + iv[0] * 3.0, dy + iv[1] * 3.0
            ntype = "restroom" if r["kind"] == "restroom" else "destination"
            dn = add_node(fl, P + f"dest_{num}", ntype, ex, ey, rid, accessible=r["accessible"])
            r["dest_node"] = dn
            add_edge(fl, dn, re_id, "room_interior", rid)
        if r["kind"] == "elevator_lobby":
            for k in (1, 2):
                lw = add_node(fl, P + f"lw{k}", "hallway_waypoint", 8.0, 58.0 if k == 1 else 61.0, rid)
                en = add_node(fl, P + f"elev_{k}", "elevator", 4.5, 58.0 if k == 1 else 61.0, rid)
                add_edge(fl, r["dest_node"], lw, "room_interior", rid)
                add_edge(fl, lw, en, "elevator_door", rid, note=f"elevator_{k} door (synthetic)")
                doors.append((f"door_elev_{k}_f{fl}", 6.0, 58.0 if k == 1 else 61.0, 1.2))

    # ---- hallway chains
    def chain(items, key_is_x, hall_fn):
        # items: (name, coord) ; names -> node ids
        seen, uniq = set(), []
        for nm, c in sorted(items, key=lambda t: t[1]):
            nid = J.get(nm) or P + nm
            if nid in seen: continue
            seen.add(nid); uniq.append((nid, c))
        for (a, ca), (b, cb) in zip(uniq, uniq[1:]):
            hid, narrow = hall_fn((ca + cb) / 2)
            add_edge(fl, a, b, "hallway", hid, narrow=narrow)
    chain(spine, False, lambda m: (hall_for_spine(fl, m)[0], False))
    chain(c2, True, lambda m: (f"hallway_{base + 4}", False))
    chain(link, False, lambda m: (f"hallway_{base + 8}", True))
    chain(c3, True, lambda m: (f"hallway_{base + 6}", False))
    add_edge(fl, J["J1"], J["C4m"], "hallway", f"hallway_{base + 2}", narrow=True)
    # lobby circulation
    re18 = f"{P}re_{fl}18"
    add_edge(fl, re18, J["L2"], "room_interior", f"room_{fl}18")
    add_edge(fl, J["L2"], J["L3"], "room_interior", f"room_{fl}18")
    add_edge(fl, J["L2"], P + "L4", "room_interior", f"room_{fl}18")

    # ---- ground-floor-only: building entrances, ramp
    if fl == 1:
        ents = [
            (1, *snap(0.45, 83.8), "L3", "entrance_threshold", True, "ENT006"),
            (2, *snap(32.0, 67.0), f"{P}wp_117", "entrance_threshold", True, "ENT007"),
            (3, *snap(27.7, 54.4), None, "entrance_threshold", True, "RMP004"),
            (4, *snap(0.64, 20.0), "C4m", "entrance_steps", False, None),
        ]
        for k, ex, ey, target, etype, acc, ref in ents:
            en = add_node(fl, P + f"entrance_{k}", "entrance", ex, ey, None, accessible=acc)
            if k == 3:
                ra = add_node(fl, P + "ramp_a", "ramp", 27.0, 54.4, None)
                rb = add_node(fl, P + "ramp_b", "ramp", 24.5, 54.4, None)
                add_edge(fl, en, ra, "entrance_threshold", f"hallway_{base+4}")
                add_edge(fl, ra, rb, "ramp", f"hallway_{base+4}", note="synthetic interior ramp; slope not modeled")
                add_edge(fl, rb, J["J4"], "hallway", f"hallway_{base+4}")
            else:
                tgt = J[target] if target in J else target
                add_edge(fl, en, tgt, etype, {1: "room_118", 2: f"hallway_{base+6}", 4: f"hallway_{base+2}"}[k],
                         accessible=acc, stairs_only=(not acc),
                         note="exterior steps (synthetic)" if k == 4 else "")
            FEATS["entrances"].append(dict(feature_id=f"entrance_{k}", building_id=BID, floor_id=fid(fl), node_id=P + f"entrance_{k}",
                x=sx(ex), y=sy(ey), accessible=acc, entrance_class=("accessible_entrance" if acc else "standard_entrance_steps"),
                supported_by_reference=(ref is not None), reference_feature_id=ref, verified=False, synthetic=True,
                notes=("Position projected to the nearest exterior wall of the reference footprint from " + ref + " (entrances_ramps.geojson); not verified."
                       if ref else "Synthetic standard entrance with exterior steps; NOT supported by the reference data (demo of a non-accessible entrance).")))
        FEATS["ramps"].append(dict(feature_id="ramp_1", building_id=BID, floor_id=fid(fl), node_ids=[P + "ramp_a", P + "ramp_b"],
            accessible=True, reference_feature_id="RMP004", verified=False, synthetic=True,
            notes="Interior ramp at east vestibule modeled to demonstrate a ramp edge; slope/length NOT real."))

    # ---- fountains (features only)
    for k, (fx, fy) in enumerate([(13.7, 63.0), (13.7, 30.0)], 1):
        FEATS["fountains"].append(dict(feature_id=f"fountain_{(fl-1)*2+k}", building_id=BID, floor_id=fid(fl),
            x=sx(fx), y=sy(fy), accessible=True, verified=False, synthetic=True))
    for did, dx, dy, w in doors:
        owner = did.split("_")[1]
        FEATS["doors"].append(dict(door_id=did, building_id=BID, floor_id=fid(fl), x=sx(dx), y=sy(dy),
            opening_width_synthetic_m=w, accessible=True, verified=False, synthetic=True,
            room_id=(f"room_{owner}" if owner.isdigit() else None)))
    DOORS_M[fl] = doors

    # ---- room records
    for r in rooms:
        x, y, w, h = r["bbox"]
        ROOMS.append(dict(room_id=r["room_id"], building_id=BID, floor_id=fid(fl),
            room_name=r["display"], room_type=r["type"], room_number=r["room_number"], x=x, y=y, width=w, height=h,
            accessible=r["accessible"], synthetic=True,
            category=("service" if r["kind"] == "service" else "room"), navigable=r["nav"], verified=False,
            polygon=[[sx(px), sy(py)] for px, py in list(r["poly"].exterior.coords)[:-1]],
            door_id=r.get("door_id"), entrance_node_id=r.get("re"), destination_node_id=r.get("dest_node") or r.get("stair_node"),
            notes=r["notes"]))
    for h_ in halls:
        x, y, w, hh = bbox_units(h_["poly"])
        ROOMS.append(dict(room_id=h_["id"], building_id=BID, floor_id=fid(fl), room_name=h_["name"], room_type="hallway",
            room_number=None, x=x, y=y, width=w, height=hh, accessible=True, synthetic=True, category="circulation",
            navigable=False, verified=False, polygon=[[sx(px), sy(py)] for px, py in list(h_["poly"].exterior.coords)[:-1]],
            potentially_narrow=h_["narrow"], synthetic_width_m=h_["width"], door_id=None, entrance_node_id=None, destination_node_id=None,
            notes=("SYNTHETIC potentially-narrow hallway (unverified)." if h_["narrow"] else "")))
    SVG_DATA[fl] = dict(rooms=rooms, halls=halls)

for fl in FLOORS: build_floor(fl)

# ---------------------------------------------------------------- vertical connections
for k in (1, 2):
    FEATS["elevators"].append(dict(feature_id=f"elevator_{k}", building_id=BID, floors=[fid(f) for f in FLOORS],
        accessible=True, verified=False, synthetic=True, notes="Synthetic elevator; same x/y on every floor."))
for k, suf in ((1, 9), (2, 16)):
    FEATS["stairwells"].append(dict(feature_id=f"stairwell_{k}", building_id=BID, floors=[fid(f) for f in FLOORS],
        accessible=False, stairs_only=True, verified=False, synthetic=True, room_numbers=[f"{f}{suf:02d}" for f in FLOORS]))
for f in (1, 2):
    for kind, ks, acc, tt, dd in (("elevator", (1, 2), True, 25.0, 4.5), ("staircase", (1, 2), False, 14.0, 6.0)):
        for k in ks:
            nm = "elev" if kind == "elevator" else "stair"
            CONNS.append(dict(connection_id=f"conn_{nm}_{k}_f{f}_f{f+1}", building_id=BID, from_floor=fid(f), to_floor=fid(f + 1),
                from_node=f"n_f{f}_{nm}_{k}", to_node=f"n_f{f+1}_{nm}_{k}", connection_type=kind, accessible=acc,
                stairs_only=(kind == "staircase"), travel_time=tt, distance=dd, bidirectional=True, verified=False, synthetic=True,
                feature_id=("elevator_%d" if kind == "elevator" else "stairwell_%d") % k))

# ---------------------------------------------------------------- obstacles (overlay, scenario based)
def eid_between(a, b):
    for e in EDGES:
        if {e["from_node"], e["to_node"]} == {a, b}: return e["edge_id"]
    raise KeyError((a, b))
OBS = []
def obs(i, fl, loc_key, loc_val, otype, desc, status, verified, scen, extra=None):
    d = dict(obstacle_id=i, building_id=BID, floor_id=fid(fl), obstacle_type=otype,
             description="SYNTHETIC DEMO DATA - " + desc, status=status, verified=verified, synthetic=True, scenario_ids=scen)
    d[loc_key] = loc_val
    if extra: d.update(extra)
    OBS.append(d)
obs("OBS-001", 1, "affected_edge_id", eid_between("n_f1_J2", "n_f1_wp_105") if "n_f1_wp_105" in NODE_BY_ID else None,
    "blocked_hallway", "Main corridor (mid-north) blocked between the east-branch junction and the elevator lobby.", "verified", True, ["SCN-BLOCKED-HALLWAY"])
obs("OBS-002", 1, "location_node_id", "n_f1_elev_1", "elevator_unavailable", "Elevator 1 temporarily out of service.", "verified", True,
    ["SCN-ELEVATOR-1-OUT", "SCN-NO-ELEVATOR"], dict(affected_node_ids=[f"n_f{f}_elev_1" for f in FLOORS]))
obs("OBS-003", 1, "location_node_id", "n_f1_elev_2", "elevator_unavailable", "Elevator 2 temporarily out of service.", "verified", True,
    ["SCN-NO-ELEVATOR"], dict(affected_node_ids=[f"n_f{f}_elev_2" for f in FLOORS]))
obs("OBS-004", 1, "affected_edge_id", eid_between("n_f1_re_103", "n_f1_wp_103"), "blocked_doorway",
    "Doorway to Classroom 103 reported blocked (UNVERIFIED, must not block routing).", "pending", False, ["SCN-UNVERIFIED-ONLY"])
obs("OBS-005", 1, "affected_edge_id", eid_between("n_f1_L2", "n_f1_L4"), "construction_area",
    "Simulated construction zone in the lobby east side, isolating the collaboration space.", "verified", True, ["SCN-CONSTRUCTION"])
obs("OBS-006", 2, "affected_edge_id", eid_between("n_f2_J2", "n_f2_wp_205"), "blocked_hallway",
    "Earlier hallway obstruction, now RESOLVED (must not block routing).", "resolved", True, ["SCN-RESOLVED-IGNORED"])
for o in OBS:
    if "affected_edge_id" in o:
        for e in EDGES:
            if e["edge_id"] == o["affected_edge_id"]:
                e["obstacle_id"] = None   # overlay lives in obstacles.json; edge baseline stays 'none'
SCENARIOS = [
    dict(scenario_id="SCN-NORMAL", description="No obstacles applied (baseline).", obstacle_ids=[]),
    dict(scenario_id="SCN-BLOCKED-HALLWAY", description="Verified blocked hallway on floor 1 forces a reroute.", obstacle_ids=["OBS-001"]),
    dict(scenario_id="SCN-ELEVATOR-1-OUT", description="Elevator 1 out of service; elevator 2 still available.", obstacle_ids=["OBS-002"]),
    dict(scenario_id="SCN-NO-ELEVATOR", description="Both elevators out of service: no wheelchair route to upper floors.", obstacle_ids=["OBS-002", "OBS-003"]),
    dict(scenario_id="SCN-UNVERIFIED-ONLY", description="Only a pending/unverified obstacle: must NOT block.", obstacle_ids=["OBS-004"]),
    dict(scenario_id="SCN-CONSTRUCTION", description="Verified construction zone isolates room_119 (no route for anyone).", obstacle_ids=["OBS-005"]),
    dict(scenario_id="SCN-RESOLVED-IGNORED", description="Resolved obstacle: must NOT block.", obstacle_ids=["OBS-006"]),
]

# ---------------------------------------------------------------- connectors (outdoor unassigned)
REF = {"ENT006": ("way/1484121410", 4.4), "ENT007": ("way/225470267", 0.1), "RMP004": ("way/335766008", 2.7)}
CONNECTORS = []
for e in FEATS["entrances"]:
    ref = e["reference_feature_id"]
    c = dict(connector_id=f"conn_out_{e['feature_id']}", building_id=BID, indoor_node_id=e["node_id"], outdoor_node_id=None,
             connection_type=("accessible_entrance" if e["accessible"] else "standard_entrance"), accessible=e["accessible"],
             synthetic=True, status="unassigned", supported_by_reference=e["supported_by_reference"],
             outdoor_reference_feature_id=ref, verified=False)
    if ref:
        way, d = REF[ref]
        c["nearest_sidewalk_way_hint"] = dict(osm_way=way, distance_from_reference_point_m=d, source="sidewalks.geojson")
        c["notes"] = ("outdoor_node_id intentionally null: sidewalks.geojson has no node IDs. Map this connector to your own outdoor graph node. "
                      "Reference point was snapped to the building wall; position uncertainty applies.")
    else:
        c["notes"] = "Synthetic entrance with no reference support; leave unassigned unless a real entrance is confirmed."
    CONNECTORS.append(c)

# ================================================================ SVG
CSS = """
.ip-bg{fill:#ffffff}.ip-fp{fill:#fafafa}
.ip-hall{fill:#eceff1}
.rt-classroom,.rt-lecture_room{fill:#dbeafe}.rt-computer_lab,.rt-research_lab{fill:#e9d5ff}
.rt-faculty_office,.rt-department_office{fill:#e5e7eb}.rt-restroom{fill:#fef9c3}.rt-accessible_restroom{fill:#fde68a}
.rt-lobby,.rt-open_study_area{fill:#ccfbf1}.rt-collaboration_space,.rt-study_room{fill:#d1fae5}.rt-conference_room{fill:#e0e7ff}
.rt-reception{fill:#fed7aa}.rt-break_room{fill:#ffedd5}.rt-stairwell{fill:#f3f4f6}.rt-elevator_lobby{fill:#e0f2fe}.rt-service{fill:url(#hatch_gray)}
.wall-int{fill:none;stroke:#374151;stroke-width:1.6;stroke-linejoin:miter}
.wall-ext{fill:none;stroke:#111827;stroke-width:6;stroke-linejoin:miter}
.door-gap{stroke:#eceff1;stroke-width:4;stroke-linecap:butt}.door-leaf{stroke:#374151;stroke-width:1;fill:none}.door-arc{stroke:#9ca3af;stroke-width:.6;fill:none}
.lbl-name{font:600 7.6px Arial,Helvetica,sans-serif;fill:#111827;text-anchor:middle}.lbl-id{font:400 6.2px Arial,Helvetica,sans-serif;fill:#4b5563;text-anchor:middle}
.stair-tread{stroke:#6b7280;stroke-width:.8}.elev{fill:#fff;stroke:#1f2937;stroke-width:1.4}
.acc-route{fill:none;stroke:#16a34a;stroke-width:1.4;stroke-dasharray:4 3;opacity:.55}
.obs-verified{fill:url(#hatch_red);stroke:#dc2626;stroke-width:1.4}.obs-pending{fill:none;stroke:#dc2626;stroke-width:1.2;stroke-dasharray:3 2}
.obs-resolved{fill:none;stroke:#9ca3af;stroke-width:1;stroke-dasharray:2 2}
.ent-acc{fill:#1d4ed8}.ent-std{fill:#6b7280}.txt-small{font:400 7px Arial,sans-serif;fill:#111827}.txt-title{font:700 15px Arial,sans-serif;fill:#111827}
.txt-banner{font:700 10px Arial,sans-serif;fill:#b91c1c}.txt-note{font:400 7px Arial,sans-serif;fill:#4b5563}
#layer_nav_graph{display:none}
"""
DEFS = """<defs>
<pattern id="hatch_gray" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f3f4f6"/><line x1="0" y1="0" x2="0" y2="6" stroke="#9ca3af" stroke-width="1"/></pattern>
<pattern id="hatch_red" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fee2e2"/><line x1="0" y1="0" x2="0" y2="6" stroke="#dc2626" stroke-width="1.4"/></pattern>
<pattern id="hatch_ramp" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#dcfce7"/><line x1="0" y1="4" x2="4" y2="0" stroke="#16a34a" stroke-width=".8"/></pattern>
<symbol id="sym_wheelchair" viewBox="0 0 24 24"><circle cx="11" cy="4.5" r="2.2" fill="#fff"/><path d="M11 8v6h5l3 6M7.5 11.5a5.2 5.2 0 1 0 7.2 6.2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></symbol>
<symbol id="sym_steps" viewBox="0 0 24 24"><path d="M3 20h5v-4h5v-4h5V8" fill="none" stroke="#fff" stroke-width="2.2"/></symbol>
<symbol id="sym_elev" viewBox="0 0 24 24"><path d="M12 4l4 6H8zM12 20l-4-6h8z" fill="#1f2937"/></symbol>
</defs>"""

def wrap(text, maxc):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) <= maxc: cur = (cur + " " + w).strip()
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    return lines

def door_svg(did, dx, dy, o, inward, w):
    cx, cy = sx(dx), sy(dy)
    wu = w * SCALE
    dirv = (0, 1) if o == "v" else (1, 0)
    iv = (inward[0], -inward[1])
    a = (cx - dirv[0] * wu / 2, cy - dirv[1] * wu / 2); b = (cx + dirv[0] * wu / 2, cy + dirv[1] * wu / 2)
    s = f'<g id="{did}" class="door"><line class="door-gap" x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>'
    if w <= 1.5:
        le = (a[0] + iv[0] * wu, a[1] + iv[1] * wu)
        cr = (le[0]-a[0]) * (b[1]-a[1]) - (le[1]-a[1]) * (b[0]-a[0])
        sw = 1 if cr > 0 else 0
        s += (f'<line class="door-leaf" x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{le[0]:.1f}" y2="{le[1]:.1f}"/>'
              f'<path class="door-arc" d="M{le[0]:.1f} {le[1]:.1f} A{wu:.1f} {wu:.1f} 0 0 {sw} {b[0]:.1f} {b[1]:.1f}"/>')
    return s + "</g>"

def entrance_svg(k, e, floorrooms):
    ex, ey = e["x"], e["y"]
    ent = [x for x in FEATS["entrances"] if x["feature_id"] == f"entrance_{k}"][0]
    out = {1: (-1, 0), 2: (1, 0), 3: (1, 0), 4: (-1, 0)}[k]
    px, py = ex + out[0] * 16, ey
    cls = "ent-acc" if ent["accessible"] else "ent-std"
    sym = "sym_wheelchair" if ent["accessible"] else "sym_steps"
    gap = (f'<line class="door-gap" style="stroke:#fff;stroke-width:8" x1="{ex}" y1="{ey-7}" x2="{ex}" y2="{ey+7}"/>')
    tl = "start" if out[0] > 0 else "end"
    lx = px + out[0] * 10
    return (f'<g id="entrance_{k}" data-accessible="{str(ent["accessible"]).lower()}" data-verified="false">{gap}'
            f'<line x1="{ex}" y1="{ey}" x2="{px}" y2="{py}" stroke="#374151" stroke-width="1"/>'
            f'<circle class="{cls}" cx="{px}" cy="{py}" r="8"/><use href="#{sym}" x="{px-6}" y="{py-6}" width="12" height="12"/>'
            f'<text class="txt-small" x="{lx}" y="{py+2.5}" text-anchor="{tl}">entrance_{k}</text>'
            f'<text class="txt-note" x="{lx}" y="{py+11}" text-anchor="{tl}">{"accessible" if ent["accessible"] else "steps / standard"}</text></g>')

def svg_for(fl):
    d = SVG_DATA[fl]; rooms, halls = d["rooms"], d["halls"]
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {VBW} {VBH}" '
         f'width="{VBW}" height="{VBH}" id="floorplan_{BID}_f{fl}" data-building-id="{BID}" data-floor-id="{fid(fl)}" '
         f'data-floor-number="{fl}" data-synthetic="true" data-units-per-meter="{SCALE:g}" data-origin="top-left">']
    s.append(f'<title>{BID} {BNAME} - {FLOOR_NAMES[fl]} - SYNTHETIC / MOCK interior</title>')
    s.append('<desc>SYNTHETIC / MOCK DATA. Exterior footprint approximated from buildings.geojson; every interior element is invented. '
             'Coordinates: SVG units, origin top-left, x right, y down, 10 units = 1 m, north = up.</desc>')
    s.append(f"<style>{CSS}</style>{DEFS}")
    s.append(f'<rect id="background" class="ip-bg" width="{VBW}" height="{VBH}"/>')
    s.append('<g id="layer_annotations">')
    s.append(f'<text class="txt-title" x="24" y="36">{BID} - {BNAME}</text>')
    s.append(f'<text class="txt-title" x="24" y="58" style="font-size:12px;font-weight:600">Floor {fl} - {FLOOR_NAMES[fl]}</text>')
    s.append('<text class="txt-banner" x="24" y="78">SYNTHETIC / MOCK INTERIOR - NOT AN OFFICIAL KSU PLAN - ACCESSIBILITY UNVERIFIED</text>')
    s.append('<g id="north_arrow"><polygon points="70,130 62,160 70,153 78,160" fill="#111827"/><text x="70" y="124" text-anchor="middle" class="txt-small" style="font-weight:700;font-size:10px">N</text></g>')
    sb = sy(-2.5) + 0
    s.append(f'<g id="scale_bar"><line x1="{OX}" y1="{OY+H*SCALE+40}" x2="{OX+100}" y2="{OY+H*SCALE+40}" stroke="#111827" stroke-width="2"/>'
             f'<text class="txt-small" x="{OX}" y="{OY+H*SCALE+54}">10 m (synthetic scale: 10 units = 1 m)</text></g>')
    s.append(f'<text class="txt-note" x="24" y="{VBH-22}">Footprint: approximate, from buildings.geojson ({feat["properties"]["id"]}); interior, doors, elevators, stairs and accessibility flags are generated placeholders.</text>')
    s.append('</g>')
    s.append(f'<g id="layer_footprint"><path id="footprint" class="ip-fp" d="{ppath(F)}"/></g>')
    s.append('<g id="layer_hallways">' + "".join(
        f'<path id="{h["id"]}" class="ip-hall" data-potentially-narrow="{str(h["narrow"]).lower()}" d="{ppath(h["poly"])}"><title>{h["name"]}</title></path>' for h in halls) + '</g>')
    s.append('<g id="layer_rooms">' + "".join(
        f'<path id="{r["room_id"]}" class="rt-{r["type"]}" data-room-type="{r["type"]}" data-accessible="{str(r["accessible"]).lower()}" d="{ppath(r["poly"])}"><title>{r["display"]}</title></path>' for r in rooms) + '</g>')
    walls = "".join(f'<path id="wall_{r["room_id"]}" class="wall-int" d="{ppath(r["poly"])}"/>' for r in rooms)
    walls += "".join(f'<path id="wall_elevator_{k}" class="wall-int" d="{ppath(SPACES[fl][f"elevator_{k}@f{fl}"])}"/>' for k in (1, 2))
    s.append(f'<g id="layer_walls_interior">{walls}</g>')
    s.append(f'<g id="layer_walls_exterior"><path id="exterior_wall" class="wall-ext" d="{ppath(F)}"/></g>')
    # doors
    ds = []
    for r in rooms:
        if r["nav"]:
            dd = r["door"]; ds.append(door_svg(r["door_id"], dd["x"], dd["y"], dd["o"], r["inward"], r["width"]))
    for k in (1, 2):
        yy = 58.0 if k == 1 else 61.0
        ds.append(door_svg(f"door_elev_{k}_f{fl}", 6.0, yy, "v", (-1, 0), 1.2).replace('w="1.2"', ""))
    s.append('<g id="layer_doors">' + "".join(ds) + "</g>")
    # stairs
    st = []
    for r in rooms:
        if r["kind"] == "stairwell":
            k = 1 if r["suffix"] == 9 else 2
            b = r["poly"].bounds
            x0_, x1_, y0_, y1_ = sx(b[0]) + 6, sx(b[2]) - 6, sy(b[3]) + 4, sy(max(b[1], 5.6)) - 4
            if k == 1: y0_ += 8
            lines = "".join(f'<line class="stair-tread" x1="{x0_:.1f}" y1="{yy:.1f}" x2="{x1_:.1f}" y2="{yy:.1f}"/>'
                            for yy in [y0_ + i * (y1_ - y0_) / 9 for i in range(10)])
            st.append(f'<g id="stairwell_{k}" data-stairs-only="true" data-accessible="false">{lines}'
                      f'<text class="txt-note" x="{(x0_+x1_)/2:.1f}" y="{y0_-1:.1f}" text-anchor="middle">UP/DN</text></g>')
    s.append('<g id="layer_stairs">' + "".join(st) + "</g>")
    # elevators
    el = []
    for k, rect in SHAFTS.items():
        x_, y_ = sx(rect[0]), sy(rect[3])
        wu, hu = (rect[2] - rect[0]) * SCALE, (rect[3] - rect[1]) * SCALE
        el.append(f'<g id="elevator_{k}" data-accessible="true"><rect class="elev" x="{x_}" y="{y_}" width="{wu:.1f}" height="{hu:.1f}"/>'
                  f'<use href="#sym_elev" x="{x_+wu/2-8:.1f}" y="{y_+hu/2-8:.1f}" width="16" height="16"/>'
                  f'<text class="txt-note" x="{x_+wu/2:.1f}" y="{y_+hu-3:.1f}" text-anchor="middle">E{k}</text></g>')
    s.append('<g id="layer_elevators">' + "".join(el) + "</g>")
    if fl == 1:
        s.append(f'<g id="layer_ramps"><g id="ramp_1" data-accessible="true"><rect x="{sx(24.8)}" y="{sy(55.7)}" width="{2.6*SCALE:.1f}" height="{2.7*SCALE:.1f}" fill="url(#hatch_ramp)" stroke="#16a34a" stroke-width="1"/>'
                 f'<text class="txt-note" x="{sx(26.1)}" y="{sy(52.6)}" text-anchor="middle">ramp_1</text></g></g>')
    else:
        s.append('<g id="layer_ramps"></g>')
    # accessibility layer
    ac = []
    if fl == 1:
        for k in (1, 2, 3, 4):
            e = [x for x in FEATS["entrances"] if x["feature_id"] == f"entrance_{k}"][0]
            ac.append(entrance_svg(k, e, rooms))
    for fo in [x for x in FEATS["fountains"] if x["floor_id"] == fid(fl)]:
        ac.append(f'<g id="{fo["feature_id"]}"><circle cx="{fo["x"]}" cy="{fo["y"]}" r="3.2" fill="#60a5fa" stroke="#1e40af" stroke-width=".8"/></g>')
    for r in rooms:
        if r["type"] == "accessible_restroom":
            b = r["poly"].bounds
            ac.append(f'<g id="icon_accessible_{r["room_id"]}"><circle class="ent-acc" cx="{sx(b[0])+14:.1f}" cy="{sy(b[3])+14:.1f}" r="7"/><use href="#sym_wheelchair" x="{sx(b[0])+8:.1f}" y="{sy(b[3])+8:.1f}" width="12" height="12"/></g>')
    # accessible network (green)
    pl = []
    for e in EDGES:
        if e["floor_id"] == fid(fl) and e["accessible"] and e["edge_type"] in ("hallway", "ramp", "entrance_threshold") and not str(e["space_id"]).startswith("room_"):
            a, b = NODE_BY_ID[e["from_node"]], NODE_BY_ID[e["to_node"]]
            pl.append(f'<line x1="{a["x"]}" y1="{a["y"]}" x2="{b["x"]}" y2="{b["y"]}"/>')
    ac.append('<g id="accessible_routes" class="acc-route">' + "".join(pl) + "</g>")
    s.append('<g id="layer_accessibility">' + "".join(ac) + "</g>")
    # obstacles
    ob = []
    for o in OBS:
        if o["floor_id"] != fid(fl): continue
        cls = {"verified": "obs-verified", "pending": "obs-pending", "resolved": "obs-resolved"}[o["status"]]
        if "affected_edge_id" in o:
            e = [x for x in EDGES if x["edge_id"] == o["affected_edge_id"]][0]
            a, b = NODE_BY_ID[e["from_node"]], NODE_BY_ID[e["to_node"]]
            mx, my = (a["x"] + b["x"]) / 2, (a["y"] + b["y"]) / 2
            if e["edge_type"] == "hallway" and abs(a["x"] - b["x"]) < 1:
                shape = f'<rect class="{cls}" x="{mx-13:.1f}" y="{min(a["y"],b["y"])+4:.1f}" width="26" height="{abs(a["y"]-b["y"])-8:.1f}"/>'
            elif e["edge_type"] == "hallway":
                shape = f'<rect class="{cls}" x="{min(a["x"],b["x"])+4:.1f}" y="{my-13:.1f}" width="{abs(a["x"]-b["x"])-8:.1f}" height="26"/>'
            else:
                shape = f'<circle class="{cls}" cx="{mx:.1f}" cy="{my:.1f}" r="9"/>'
        else:
            n = NODE_BY_ID[o["location_node_id"]]
            shape = f'<circle class="{cls}" cx="{n["x"]}" cy="{n["y"]}" r="11"/><path class="{cls}" d="M{n["x"]-6} {n["y"]-6}L{n["x"]+6} {n["y"]+6}M{n["x"]+6} {n["y"]-6}L{n["x"]-6} {n["y"]+6}"/>'
        ob.append(f'<g id="obstacle_{o["obstacle_id"]}" data-status="{o["status"]}" data-verified="{str(o["verified"]).lower()}" data-synthetic="true" data-type="{o["obstacle_type"]}">{shape}</g>')
    s.append('<g id="layer_obstacles">' + "".join(ob) + "</g>")
    # labels
    lb = []
    for r in rooms + [dict(room_id=h["id"], display="", poly=h["poly"], kind="hall", label_pt=None, nav=False, narrow=h["narrow"], hname=h["name"]) for h in halls if False]:
        b = r["poly"].bounds
        wu = (b[2] - b[0]) * SCALE; hu = (b[3] - b[1]) * SCALE
        if r.get("label_pt"): lx, ly = sx(r["label_pt"][0]), sy(r["label_pt"][1])
        else:
            cp = r["poly"].centroid
            lx, ly = sx(cp.x), sy(cp.y)
            if r["suffix"] in (9, 16): lx += 0; ly += 0
        maxc = max(6, int((r.get("label_w", wu / SCALE)) * SCALE / 4.4))
        name_lines = wrap(r["display"], maxc)
        total = len(name_lines) + 1
        ly0 = ly - (total - 1) * 4.5
        t = "".join(f'<text class="lbl-name" x="{lx:.1f}" y="{ly0 + i*8.4:.1f}">{ln}</text>' for i, ln in enumerate(name_lines))
        t += f'<text class="lbl-id" x="{lx:.1f}" y="{ly0 + len(name_lines)*8.4:.1f}">{r["room_id"]}</text>'
        lb.append(f'<g id="label_{r["room_id"]}">{t}</g>')
    for h in halls:
        b = h["poly"].bounds; cp = h["poly"].centroid
        if h["idx"] in (3, 5, 4, 6, 8, 2):
            vert = (b[3] - b[1]) > (b[2] - b[0])
            lx, ly = sx(cp.x), sy(cp.y)
            tr = f' transform="rotate(-90 {lx:.1f} {ly:.1f})"' if vert else ""
            lb.append(f'<g id="label_{h["id"]}"><text class="lbl-id" x="{lx:.1f}" y="{ly+2:.1f}"{tr}>{h["id"]}</text></g>')
    s.append('<g id="layer_labels">' + "".join(lb) + "</g>")
    # nav graph (hidden)
    ng = [f'<line id="svgedge_{e["edge_id"]}" x1="{NODE_BY_ID[e["from_node"]]["x"]}" y1="{NODE_BY_ID[e["from_node"]]["y"]}" x2="{NODE_BY_ID[e["to_node"]]["x"]}" y2="{NODE_BY_ID[e["to_node"]]["y"]}" stroke="#7c3aed" stroke-width="1"/>'
          for e in EDGES if e["floor_id"] == fid(fl)]
    ng += [f'<circle id="svgnode_{n["node_id"]}" cx="{n["x"]}" cy="{n["y"]}" r="2.2" fill="#7c3aed"/>' for n in NODES if n["floor_id"] == fid(fl)]
    s.append('<g id="layer_nav_graph" data-hint="debug layer; hidden by default. Set display:inline to inspect">' + "".join(ng) + "</g>")
    s.append('<g id="route_layer" fill="none" stroke="#16a34a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></g>')
    # legend
    lg = [f'<g id="layer_legend" transform="translate(560,110)"><text class="txt-small" style="font-weight:700" y="0">Legend (prototype)</text>']
    items = [("#dbeafe", "Classroom / lecture"), ("#e9d5ff", "Laboratory"), ("#e5e7eb", "Office"), ("#fef9c3", "Restroom"),
             ("#ccfbf1", "Lobby / open study"), ("#d1fae5", "Study / collaboration"), ("#e0e7ff", "Conference"), ("#ffedd5", "Break room"),
             ("#eceff1", "Hallway"), ("#e0f2fe", "Elevator lobby"), ("#f3f4f6", "Stairwell")]
    for i, (c, t) in enumerate(items):
        lg.append(f'<rect x="0" y="{10+i*15}" width="12" height="10" fill="{c}" stroke="#374151" stroke-width=".6"/><text class="txt-small" x="18" y="{18.5+i*15}">{t}</text>')
    y = 10 + len(items) * 15 + 8
    lg.append(f'<line x1="0" y1="{y+5}" x2="12" y2="{y+5}" stroke="#16a34a" stroke-width="1.6" stroke-dasharray="4 3"/><text class="txt-small" x="18" y="{y+8}">Accessible route (synthetic)</text>')
    lg.append(f'<rect x="0" y="{y+16}" width="12" height="10" fill="url(#hatch_red)" stroke="#dc2626"/><text class="txt-small" x="18" y="{y+24}">Obstacle (verified)</text>')
    lg.append(f'<rect x="0" y="{y+31}" width="12" height="10" fill="none" stroke="#dc2626" stroke-dasharray="3 2"/><text class="txt-small" x="18" y="{y+39}">Obstacle (pending)</text>')
    lg.append(f'<circle cx="6" cy="{y+54}" r="6" class="ent-acc"/><text class="txt-small" x="18" y="{y+57}">Accessible entrance</text>')
    lg.append(f'<circle cx="6" cy="{y+69}" r="6" class="ent-std"/><text class="txt-small" x="18" y="{y+72}">Standard entrance (steps)</text>')
    lg.append(f'<rect x="0" y="{y+80}" width="12" height="12" fill="#fff" stroke="#1f2937"/><text class="txt-small" x="18" y="{y+90}">Elevator</text>')
    lg.append(f'<circle cx="6" cy="{y+104}" r="3.2" fill="#60a5fa" stroke="#1e40af" stroke-width=".8"/><text class="txt-small" x="18" y="{y+107}">Water fountain</text></g>')
    s.append("".join(lg))
    s.append("</svg>")
    return "\n".join(s)

# ================================================================ write files
def wjson(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh: json.dump(obj, fh, indent=2, ensure_ascii=False)

BDIR = os.path.join(OUT, "buildings", BID)
DISC = "SYNTHETIC / MOCK DATA. Not official KSU architectural plans. Interior elements and accessibility attributes are generated and NOT field-verified."
for fl in FLOORS:
    with open(os.path.join(BDIR, f"floor_{fl}.svg"), "w") as fh: fh.write(svg_for(fl))

def wrap_file(key, items, **extra):
    d = dict(schema_version="1.0.0", building_id=BID, synthetic=True, disclaimer=DISC, coordinate_system="local-svg-units (10 units = 1 m, origin top-left, y down)")
    d.update(extra); d[key] = items; return d

wjson(os.path.join(BDIR, "rooms.json"), wrap_file("rooms", ROOMS))
wjson(os.path.join(BDIR, "nodes.json"), wrap_file("nodes", NODES))
wjson(os.path.join(BDIR, "edges.json"), wrap_file("edges", EDGES, distance_unit="meters",
      note="obstacle_status is the baseline ('none'). Dynamic obstacles are an overlay from obstacles.json."))
wjson(os.path.join(BDIR, "connections.json"), wrap_file("connections", CONNS))
wjson(os.path.join(BDIR, "obstacles.json"), wrap_file("obstacles", OBS, scenarios=SCENARIOS,
      rule="Apply an obstacle only if status=='verified' AND verified==true AND it belongs to the active scenario. pending/resolved/unverified never block."))
wjson(os.path.join(BDIR, "connectors.json"), wrap_file("connectors", CONNECTORS,
      note="outdoor_node_id is null everywhere on purpose. See documentation/generation_notes.md."))
wjson(os.path.join(BDIR, "features.json"), wrap_file("features", FEATS))

nroom = sum(1 for r in ROOMS if r["category"] == "room")
meta = dict(schema_version="1.0.0", building_id=BID, building_name=BNAME, synthetic=True, disclaimer=DISC,
    floors=[dict(floor_id=fid(f), floor_number=f, name=FLOOR_NAMES[f], svg=f"floor_{f}.svg") for f in FLOORS],
    counts=dict(rooms=nroom, hallways=sum(1 for r in ROOMS if r["category"] == "circulation"), nodes=len(NODES), edges=len(EDGES),
                vertical_connections=len(CONNS), obstacles=len(OBS), scenarios=len(SCENARIOS)),
    svg=dict(viewBox=f"0 0 {VBW} {VBH}", units_per_meter=SCALE, origin="top-left", north="up"),
    georeference_hint=dict(note="Derived from buildings.geojson for FUTURE use only; not used by indoor routing. Local meters are x east, y north from the footprint's SW bounding-box corner.",
        origin_lon=LON0, origin_lat=LAT_MIN, meters_per_degree_lon=round(111320 * math.cos(math.radians(LAT0)), 2), meters_per_degree_lat=110574,
        svg_to_local_m=dict(x="(svg_x - %g) / %g" % (OX, SCALE), y="%g - (svg_y - %g) / %g" % (H, OY, SCALE)), rotation_deg=0),
    source=dict(footprint="buildings.geojson", osm_id=feat["properties"]["id"], osm_levels=feat["properties"]["building:levels"],
        entrances="entrances_ramps.geojson (ENT006, ENT007, RMP004; all verified=false)"),
    footprint_geometry="approximate (OSM-derived polygon, vertices rounded to 0.1 m, none removed)")
wjson(os.path.join(BDIR, "metadata.json"), meta)

fp_units = [[sx(x), sy(y)] for x, y in FOOT]
buildings = wrap_file("buildings", [dict(building_id=BID, building_name=BNAME, campus="KSU Marietta", building_type="academic",
    source="buildings.geojson (OSM-derived footprint) + synthetic interior", synthetic=True,
    floors=[fid(f) for f in FLOORS], exterior_footprint=dict(type="Polygon", units="svg", coordinates=[fp_units + [fp_units[0]]], precision="approximate"),
    coordinate_reference=dict(type="local", name="BLD001-local-svg", units_per_meter=SCALE, origin="top-left", x="right", y="down", north="up"))])
buildings.pop("building_id")
wjson(os.path.join(OUT, "shared", "buildings.json"), buildings)
wjson(os.path.join(OUT, "shared", "building_index.json"), dict(schema_version="1.0.0", synthetic=True, disclaimer=DISC, buildings=[
    dict(building_id="BLD001", building_name="H - Academic Building", path="buildings/BLD001", indoor_generated=True, floors=3),
    dict(building_id="BLD002", building_name="I2 - Design 2 Building", path=None, indoor_generated=False, reason="skipped at user request (indoor_mapping=False)"),
    dict(building_id="BLD003", building_name="Q - Engineering Technology Center", path=None, indoor_generated=False, reason="skipped at user request (indoor_mapping=False)")]))
print("generated", meta["counts"])
