# ERP review

## Round 3 — 25 Sep 2026
- `erp-review-3.html`: change report for everything since the round-2 merge:
  Pick & Pack renamed to Release Orders and rebuilt (tabs, bulk release, inline
  line quantities), scroll windows for long lists, the role-aware Dashboard,
  fixes, testing and what to try. Screenshots in `round3/`. Published copy:
  https://claude.ai/artifact/F4bYMBaGVZJPRqkwPkN5Dd
- `../design/release-orders/`: the three layout options for Release Orders
  (A release list, B waves, C board) with mockups and the recommendation.

## Round 2 — 24 Sep 2026
- `erp-review-2.html`: roles redesign, steps 2/4/5/6/7, the new 15-person workday
  simulation with a staffing what-if, the one-year scale test, and the checklist
  for merging to main. Published copy: https://claude.ai/artifact/X4Aqvsy1wczeiSwfhHiBtx
- `open-bugs.md`: running log of known open defects.
- `todo.html`: the shared to-do list page (live copy with editable status:
  https://claude.ai/artifact/XSgiB7gPhEWoufPbgTP1rZ).
- `data/round2/`: raw results (two staffing scenarios, scale test).

## Round 1 — 24 Sep 2026
- `erp-review.html`: code review findings, the original 15-user simulation and
  the scale test. Published copy: https://claude.ai/artifact/GVRBZGQBNYjDKn3Bi4oug7
- `data/`: round-1 raw results.

## Re-running the simulation
1. Fresh database: `cd server && npx prisma migrate deploy && npm run seed`, start the API.
2. `node sim/seed.mjs` (15 staff with the app's role presets, 500 SKUs,
   200 customers, vendors, open POs), then snapshot with `pg_dump -Fc`.
3. For each run: restore the snapshot, **restart the API** (a restore under a
   running API leaves it with stale type ids), then `SIM_MINUTES=12 node sim/day.mjs`.
   Add `SIM_SWAP="cs.priya:analyst"` to try a different staffing mix.
4. `python3 sim/report2.py` rebuilds the round-2 report from the result files.
