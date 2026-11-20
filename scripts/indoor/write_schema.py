#!/usr/bin/env python3
import json, os, sys
OUT = sys.argv[1] if len(sys.argv) > 1 else "/mnt/user-data/outputs/indoor-mapping"
S, N, B, I = {"type": "string"}, {"type": "number"}, {"type": "boolean"}, {"type": "integer"}
NS = {"type": ["string", "null"]}
def obj(props, req): return {"type": "object", "properties": props, "required": req}
def fileobj(key, item): return obj({"schema_version": S, "building_id": S, "synthetic": {"const": True}, "disclaimer": S, key: {"type": "array", "items": {"$ref": item}}}, ["schema_version", "synthetic", "disclaimer", key])
defs = {
 "Room": obj({"room_id": S, "building_id": S, "floor_id": S, "room_name": S, "room_type": S, "room_number": NS, "x": N, "y": N, "width": N, "height": N,
              "accessible": B, "synthetic": {"const": True}, "category": {"enum": ["room", "service", "circulation"]}, "navigable": B, "polygon": {"type": "array"}},
             ["room_id", "building_id", "floor_id", "room_name", "room_type", "room_number", "x", "y", "width", "height", "accessible", "synthetic"]),
 "Node": obj({"node_id": S, "building_id": S, "floor_id": S, "node_type": {"enum": ["entrance", "hallway_intersection", "hallway_waypoint", "room_entrance", "elevator", "staircase", "ramp", "restroom", "destination"]},
              "x": N, "y": N, "room_id": NS, "accessible": B, "synthetic": {"const": True}},
             ["node_id", "building_id", "floor_id", "node_type", "x", "y", "room_id", "accessible", "synthetic"]),
 "Edge": obj({"edge_id": S, "from_node": S, "to_node": S, "distance": {"type": "number", "exclusiveMinimum": 0}, "travel_time": {"type": "number", "exclusiveMinimum": 0},
              "edge_type": {"enum": ["hallway", "door", "room_interior", "entrance_threshold", "elevator_door", "stair_landing", "ramp", "entrance_steps"]},
              "accessible": B, "stairs_only": B, "obstacle_status": {"enum": ["none", "pending", "verified", "resolved"]}, "verified": B, "synthetic": {"const": True}},
             ["edge_id", "from_node", "to_node", "distance", "travel_time", "edge_type", "accessible", "stairs_only", "obstacle_status", "verified", "synthetic"]),
 "Connection": obj({"connection_id": S, "building_id": S, "from_floor": S, "to_floor": S, "from_node": S, "to_node": S,
                    "connection_type": {"enum": ["elevator", "staircase", "ramp"]}, "accessible": B, "synthetic": {"const": True}},
                   ["connection_id", "building_id", "from_floor", "to_floor", "from_node", "to_node", "connection_type", "accessible", "synthetic"]),
 "Obstacle": {"allOf": [obj({"obstacle_id": S, "building_id": S, "floor_id": S, "obstacle_type": S, "description": S,
              "status": {"enum": ["pending", "verified", "resolved"]}, "verified": B, "synthetic": {"const": True}},
              ["obstacle_id", "building_id", "floor_id", "obstacle_type", "description", "status", "verified", "synthetic"]),
              {"anyOf": [{"required": ["location_node_id"]}, {"required": ["affected_edge_id"]}]}]},
 "Connector": obj({"connector_id": S, "building_id": S, "indoor_node_id": S, "outdoor_node_id": NS, "connection_type": S, "accessible": B, "synthetic": {"const": True}},
                  ["connector_id", "building_id", "indoor_node_id", "outdoor_node_id", "connection_type", "accessible", "synthetic"]),
 "Building": obj({"building_id": S, "building_name": S, "campus": S, "building_type": S, "source": S, "synthetic": {"const": True}, "floors": {"type": "array"},
                  "exterior_footprint": {"type": "object"}, "coordinate_reference": {"type": "object"}},
                 ["building_id", "building_name", "campus", "building_type", "source", "synthetic", "floors", "exterior_footprint", "coordinate_reference"]),
}
schema = {"$schema": "http://json-schema.org/draft-07/schema#", "title": "KSU Marietta SYNTHETIC indoor mapping schema", "description": "All data is SYNTHETIC / MOCK.",
          "definitions": defs,
          "files": {"rooms.json": fileobj("rooms", "#/definitions/Room"), "nodes.json": fileobj("nodes", "#/definitions/Node"),
                    "edges.json": fileobj("edges", "#/definitions/Edge"), "connections.json": fileobj("connections", "#/definitions/Connection"),
                    "obstacles.json": fileobj("obstacles", "#/definitions/Obstacle"), "connectors.json": fileobj("connectors", "#/definitions/Connector"),
                    "buildings.json": fileobj("buildings", "#/definitions/Building")}}
os.makedirs(os.path.join(OUT, "shared"), exist_ok=True)
json.dump(schema, open(os.path.join(OUT, "shared", "indoor_schema.json"), "w"), indent=2)
print("schema written")
