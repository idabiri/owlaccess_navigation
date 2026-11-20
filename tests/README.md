# Repository tests

Run from the repository root (Python 3.10 or newer, standard library only):

```bash
python tests/check_data_integrity.py   # app data copies == data/, source hashes, file manifest (17 checks)
python tests/routing/run_e2e.py        # 10 end-to-end routing scenarios on data/integrated/ with the Python router
```

The app's own 168 tests are in `app/tests/` (run them with `cd app && npm test`).
