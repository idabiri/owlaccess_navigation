# Judge demo: KSU Marietta accessible navigation

About 4 minutes, then questions. One app, **OwlAccess**, on two screens: **the laptop** (presenter) and **a phone** (the same app opened on its **Reviewer** tab).
Every number below was checked against the app's own router on 2026-11-19.

---

## The night before

- [ ] Phone charged; laptop charger packed.
- [ ] Laptop and phone can share a **personal hotspot** (recommended for judging: only your two devices are on that network, and venue Wi-Fi often blocks devices from reaching each other).
- [ ] Run the tests once: in `ksu_marietta_integration/app`, `npm test` → **108 passed**.

## 15 minutes before

1. **Connect the laptop to the phone's hotspot** (or to the same Wi-Fi as the phone).
2. **Start the app** (leave this terminal open):
   ```bash
   cd ksu_marietta_integration/app
   npm run dev
   ```
3. **Clear old reports** (in a second terminal, same folder):
   ```bash
   npm run demo:reset
   ```
4. **Find the laptop's address**, any one of:
   - the `Network:` line printed by `npm run dev` (use the one that is *not* `172.27.…`, a virtual adapter);
   - `ipconfig` → "Wireless LAN adapter Wi-Fi" → **IPv4 Address**;
   - in the app: open the **Reviewer** tab in the side panel: it shows the phone link.
5. **On the phone**, open `http://<that address>:5173/review`. It opens OwlAccess with the **Reviewer (0)** tab selected (on a phone the tabs are a bar at the bottom of the screen).
   If Windows asks whether to allow Node.js through the firewall, allow it on **Private** networks only.
6. **On the laptop**, open `http://localhost:5173`. Close other tabs. Browser zoom 110–125 % if the room is large.
7. Do **not** rehearse Scene 3 after the reset (it creates a report). If you did, run `npm run demo:reset` again.

---

## The script

### Scene 1: "Get me to my lab in a wheelchair" (≈45 s)

| Do | Judges see |
|---|---|
| **Starting location:** `Outdoor ENT007 (provisional)` · **Destination:** `Research Lab 302 (room_302)` · **Mode:** Wheelchair · **Calculate route** | **92.0 m · 2 min 4 s · Floors 1, 2, 3**, turn-by-turn steps, "Take elevator 1 from floor 1 to floor 2…" |
| Press **Next »** three times | Outdoors → Floor 1 (green line to the elevator) → Floor 2 → Floor 3 (green line to Research Lab 302) |

**Say:** "One route from the sidewalk to a third-floor lab. Wheelchair mode never uses stairs, so it takes the elevator, and every limitation is listed under the route."

### Scene 2: "What if the elevators are out?" (≈40 s)

| Do | Judges see |
|---|---|
| **Start:** `Classroom 102` · **Destination:** `Research Lab 302` · Wheelchair · **Demo obstacle scenario:** `SCN-NO-ELEVATOR` · Calculate | Red **"No accessible route found. NO_ACCESSIBLE_ROUTE"**, "Verified obstacles in effect: OBS-002, OBS-003" |
| Switch **Mode** to Walking · Calculate | Route found: **59.0 m · 1 min 9 s**, using the stairs |
| Set the scenario back to **None** | |

**Say:** "When there is no step-free way, we say so plainly. We never send a wheelchair user toward stairs."

### Scene 3: Report → suggestion → human verification on a phone → reroute (≈90 s)

| Do | Judges see |
|---|---|
| **Laptop.** Start `Elevator Lobby 105` · Destination `Advising Reception 113` · **Wheelchair** · scenario None · Calculate | **22.0 m · 19 s**, Floor 1, a short straight route |
| Above the floor plan: **Report an obstacle** (the side panel switches to the **Report** tab) → in *"Or choose the location on Floor 1 from a list"* pick **`Hallway 5: junction J2 – outside Elevator Lobby 105`** → **Use this location** (or tap that corridor on the plan) | Blue **!** on the corridor; the form opens with the cursor already in "Describe it" |
| Type: `Cleaning cart blocking half the corridor, too narrow for my wheelchair` | Suggestion: **Blocked hallway · Blocks wheelchair users · high confidence**, "Because of: corridor, cart, narrow, half the corridor, wheelchair" |
| **Use suggestion** → **Submit report** | Orange **?** on the map, *Waiting for review (1)* in the Report tab, **Reviewer (1)** on the tab, and the route **still 22.0 m** |
| **Phone.** Within 3 s it shows **Reviewer (1)** → **Review RPT-…** → severity is already *Blocks wheelchair users* → **Verify obstacle** | Phone: "RPT-… verified. New routes take this into account." |
| **Laptop.** Wait up to 3 s, touch nothing | Green notice **"Route recalculated after a review on another device: 22.0 m / 19 s → 55.0 m / 48 s"**, red **✕** on the corridor, the green line now goes around it |
| *Optional:* Mode → Walking · Calculate | 22.0 m: the reviewer said it blocks *wheelchair users*, so walkers can still pass |

**Say:** "Anyone can report. The suggestion only helps fill in the form. A report changes nothing until a person verifies it, and the severity they confirm decides who is rerouted."

### Scene 4: The obstacle is cleared (≈20 s)

| Do | Judges see |
|---|---|
| (Back to Wheelchair and Calculate if you showed Walking.) **Phone:** **Mark RPT-… resolved** | Laptop within 3 s: **"… 55.0 m / 48 s → 22.0 m / 19 s"**; the report moves to *Closed* |

### Optional extras (≈20 s each)

- **Honest about coverage:** *Building* → `Design 2 Building — outdoor only` → the map zooms to it, highlighted, with "has no indoor map yet".
- **Keyboard-only reporting:** Tab to *Report an obstacle*, press Enter, pick the place from the list. Focus jumps into the form.
- **Unverified never blocks:** scenario `SCN-UNVERIFIED-ONLY`, Classroom 102 → Research Lab 302, wheelchair: same route as normal (102.0 m).

---

## If something goes wrong

| Problem | Fix |
|---|---|
| Phone page will not load | Same network as the laptop? Address changed (check `ipconfig` again)? Venue Wi-Fi blocking devices: switch to the phone hotspot. **Fallback:** do the review on the laptop itself: open the **Reviewer** tab. The map and route stay on screen. |
| Phone says "Can't reach the laptop" | Is `npm run dev` still running? Then reload the phone page. |
| Laptop did not update after the phone verified | Wait 3 s; switch to the laptop tab (it checks again when shown); press **Calculate route** once. |
| Old reports on screen | `npm run demo:reset`. Pages update within a few seconds. |
| Route looks wrong | Check **Demo obstacle scenario** is *None* and **Avoid verified obstacles** is ticked. |
| Anything else | Reload the page. Reports live on the laptop, so nothing is lost. |

## Honest answers to likely questions

- **Is this the real KSU building?** The building outline, the sidewalks and the entrance points come from real map data (OpenStreetMap via QGIS and KSU's accessibility map). **The interior floor plans are synthetic** demo layouts, labelled as such on every screen.
- **Is the classification real AI?** No. It is **rule-based keyword matching** that runs offline, clearly labelled. It only suggests; a person decides. The suggestion step is one function, so a language model could replace it later.
- **Who can verify reports?** In the local demo anyone on the Reviewer tab; it says "no sign-in". On the public site (see DEPLOY.md) reviewing needs a shared reviewer passcode; a real service would need staff accounts.
- **Can a fake report block a route?** No. Pending and rejected reports never affect routing (covered by automated tests). Only a verified report blocks, and only for the people its confirmed severity applies to.
- **How accessible are the outdoor paths?** Unknown beyond steps: the source data only marks steps, and the app says so. Only one building entrance (ENT007, entrance 2) is connected to the indoor routes so far, and it is provisional.
- **Where is the data kept?** In one JSON file on the laptop, shared over the local network only. Nothing goes to the internet; no API keys or paid services.
- **How do you know it works?** 108 automated tests, including routing checked against a second, independent (Python) implementation, the review and safety rules, and the server API.

## After the demo

- Stop the app: **Ctrl + C** in the `npm run dev` terminal.
- Turn off the hotspot.
