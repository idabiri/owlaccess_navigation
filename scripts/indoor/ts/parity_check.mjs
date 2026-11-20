import fs from "fs"; import { route } from "./indoorRouting.js";
const B="/mnt/user-data/outputs/indoor-mapping/buildings/BLD001/"; const L=n=>JSON.parse(fs.readFileSync(B+n));
const ob=L("obstacles.json"), ft=L("features.json").features;
const d={nodes:L("nodes.json").nodes,edges:L("edges.json").edges,connections:L("connections.json").connections,obstacles:ob.obstacles,scenarios:ob.scenarios,rooms:L("rooms.json").rooms,entrances:Object.fromEntries(ft.entrances.map(e=>[e.feature_id,e.node_id]))};
const cases=[["entrance_1","room_102",false,null],["entrance_1","room_102",true,null],["room_102","room_117",true,null],["room_102","room_117",true,"SCN-BLOCKED-HALLWAY"],["room_102","room_117",false,"SCN-BLOCKED-HALLWAY"],
["room_101","room_212",true,null],["room_101","room_212",false,null],["room_101","room_212",true,"SCN-ELEVATOR-1-OUT"],["entrance_1","room_212",true,"SCN-NO-ELEVATOR"],["entrance_1","room_212",false,"SCN-NO-ELEVATOR"],
["entrance_4","room_102",true,null],["entrance_4","room_102",false,null],["entrance_3","room_115",true,null],["entrance_2","room_314",true,null],["room_102","room_119",true,"SCN-CONSTRUCTION"],["room_102","room_119",false,"SCN-CONSTRUCTION"],["room_102","room_103",false,"SCN-UNVERIFIED-ONLY"]];
console.log(JSON.stringify(cases.map(([a,b,w,s])=>{const r=route(d,a,b,{wheelchair:w,scenario:s??undefined});return [a,b,w,s,r.found?[r.travelTimeS,r.distanceM,r.usesStairs,r.usesElevator,r.nodes.length]:r.reason]})));
