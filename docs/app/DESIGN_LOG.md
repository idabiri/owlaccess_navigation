# OwlAccess design log

Changes approved in the It design studio (`design-studio/studio.html`). Each approved setting lives in
`app/src/design/design.json`, which the app reads; Discard in the studio returns to the latest entry here.

## 2026-11-19 19:13: approved

Settings:

| Setting | Value |
|---|---|
| `accent` | `#1152d4` |
| `routeColor` | `#f17300` |
| `pendingColor` | `#7a3c67` |
| `verifiedColor` | `#b91c1c` |
| `panelSide` | `left` |
| `panelWidth` | `380` |
| `density` | `comfortable` |
| `radius` | `7` |
| `fontScale` | `1.05` |
| `mapContrast` | `standard` |
| `reportCards` | `detailed` |
| `mobileMapHeight` | `55` |
| `heroLayout` | `split` |
| `navStyle` | `bar` |
| `cardStyle` | `elevated` |
| `planLayout` | `single` |
| `suggestionCards` | `detailed` |
| `suggestionsMap` | `right` |

Also in place (code changes requested through the studio's feedback box, not design.json):
- Owl logo in the site header and map view (`app/src/assets/owl-logo.svg`, provided SVG checked: drawing paths only, cropped to the owl).
- Step-by-step navigation on /navigate (directions panel synced with the map, simulated position marker labelled as a demo).
- Turn wording: "Slightly turn left/right" instead of "Bear left/right".

Accessibility note at approval: route colour `#f17300` has 2.7:1 contrast on the map background (WCAG asks 3:1 for
graphics) and white text on it 2.9:1 (4.5:1 for text). A darker orange such as `#c55a00` would pass both.
