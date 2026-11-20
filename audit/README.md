# Audit material

Reports and the raw results behind them, as produced during development. Nothing here was edited for the repository (SHA-256 hashes in `docs/FILE_MANIFEST.csv`). The summary of findings, fixes and open issues is in the main README, under "Audit".

| Folder | Contents |
|---|---|
| `phase1/` | Project inspection report |
| `phase2/` | Independent audit report of the indoor package, static results (98 checks), routing results (26,474 routes), jsdom DOM results, and the two audit scripts |
| `indoor_validation/` | The indoor package's own validation report (64/64) and two example route renderings |
| `phase3_4_integration/` | Entrance review and outdoor graph report, including the table of fixes applied after Phase 2 |
| `phase8_e2e/` | End-to-end scenarios, the original runner, and the Python and TypeScript results (identical) |

The audit scripts hard-code the sandbox paths they were run with (`/mnt/user-data/...`, `/tmp/...`). They are kept as a record, not as runnable tools. `tests/routing/run_e2e.py` is a runnable copy of the Phase 8 runner with repository paths.
