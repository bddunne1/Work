# ERP review — 24 Sep 2026

- `erp-review.html` — the full report (code review findings, 15-user workday
  simulation, one-year scale test, what was changed). Open it in a browser.
  Published copy: https://claude.ai/artifact/GVRBZGQBNYjDKn3Bi4oug7
- `data/` — raw simulation output:
  - `results-presets-baseline.json` — run A: original code, app's permission presets
  - `results-workaround-baseline.json` — run B: original code + extra permissions needed to ship/receive
  - `results-presets-fixed.json` — run C: fixed code, same presets
  - `scale-baseline.json` / `scale-fixed.json` — 15 concurrent page loads with 12 months of history

Re-run with the scripts in `sim/` (see the report's "Running it yourself" section).
