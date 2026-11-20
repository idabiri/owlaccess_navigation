# Runtime data (not committed)

The dev server stores shared obstacle reports in `obstacle_reports.json` in this folder, and creates the file when the first report is saved. `npm run demo:reset` empties it and keeps a timestamped backup. Both files are git-ignored because they hold whatever demo users typed.
