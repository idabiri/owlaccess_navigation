# OwlAccess

OwlAccess finds accessible routes around the KSU Marietta campus, from outside a building to a specific room. You choose walking, step-free or wheelchair, and it gives you step-by-step directions on a map, including elevators between floors. People can also report obstacles like a blocked hallway; a report only changes routes after a reviewer confirms it.

We built it for a hackathon. It is not an official Kennesaw State University service, so please don't rely on it to get around campus.

## What's real

The building outlines and footpaths come from OpenStreetMap. The entrance locations were traced from KSU's accessibility map and haven't been checked in person. Everything inside the Academic Building (rooms, hallways, elevators, stairs) is made up for the demo, and it's the only building with an inside map. The "You" marker just follows the directions; the app doesn't use GPS or track anyone.

## Running it

You need Node.js 18 or newer.

```bash
cd app
npm ci
npm run dev
```

Then open http://localhost:5173. Try planning a route from Classroom 102 to Research Lab 302 with Wheelchair selected.

To run the tests: `npm test` (inside `app`).

## Project layout

- `app/` – the web app (React + TypeScript)
- `data/` – the map and routing data (original GIS files are in `data/outdoor/source/` and are never edited)
- `scripts/` – the scripts that built the data
- `audit/` – our checks of the data and routing, including what's still unresolved
- `docs/` – data sources, the file manifest, demo and deployment notes

More detail about each dataset is in [DATA_DICTIONARY.md](DATA_DICTIONARY.md) and [docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md).

## Credits and license

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License. KSU's published maps were only used as a visual guide and aren't included. This project isn't affiliated with Kennesaw State University.

The code is under the [MIT license](LICENSE). The data is under the [Open Database License](data/LICENSE.md).
