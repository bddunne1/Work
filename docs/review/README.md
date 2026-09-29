# ERP review

## Sprint 1 — 29 Sep 2026
- Merged to main as #5. The master review's list and narrative are updated
  with what sprint 1 closed (24 items) and partly closed (3). Screens under
  `screens/sprint1/`; the day simulation re-run on the sprint 1 code is in
  `data/round6/` (0 drift, 0 500s, 409s down from 60 to 44, 90 waiting at
  close against 91 in round 2).

## Sprint plan — 29 Sep 2026
- `erp-sprint-plan.html`: sprints 0 to 3 from the master review's work plan
  expanded into tasks, each with the file it touches, the test that proves
  it, a size, the decisions needed before starting and the order to do them
  in. Published copy: https://claude.ai/artifact/Q8Nsez1F3WDdPyGTPuCT6L

## Master review — 28 Sep 2026
- `erp-master-review.html`: the working document. All five rounds reconciled
  into one list of 104 items with current status (closed, partial, open) and
  the exact next step for each, a five-round summary table, where the system
  stands, a sprint plan, the checklist for deploying the round-5 branch, the
  decisions only the owner can make, and the numbers to watch. Work from this
  page; the round reports below are the record behind it. Published copy:
  https://claude.ai/artifact/PUT2qC86iT2tub6k8RVimA
- `open-bugs.md`: regenerated from the same list (open and partial items by
  theme).

## Round 5 — 28 Sep 2026
- `erp-review-5.html`: architecture and security review of the whole codebase
  after the round-3 merge: what holds up, 21 new findings (R5-01 to R5-21, four
  rated High), a six-step redesign plan with the findings each step closes, and
  the accounting question (build AR/AP/GL here, or own invoicing and keep
  QuickBooks as the ledger; the report recommends the latter). Static code
  review only; no new simulation figures. Published copy:
  https://claude.ai/artifact/5LXfpa9geWniE7XhcHVt59

## Round 4 — 25 Sep 2026
- `erp-review-4.html`: a fresh code review (39 bugs/vulnerabilities, 14
  inefficiencies) and an order-flow analysis with what to condense, automate,
  redesign and lay out differently, plus a roadmap. No code changes. The
  findings are also listed in `open-bugs.md`. Published copy:
  https://claude.ai/artifact/MoFZWNDa9PXNcbCcb14Uzo

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
1. Fresh database: `cd server && npx prisma migrate deploy && ADMIN_PASSWORD=Sim-Director-2026 npm run seed`,
   start the API. (The sim scripts read `SIM_ADMIN_PASSWORD`, default `Sim-Director-2026`.)
2. `node sim/seed.mjs` (15 staff with the app's role presets, 500 SKUs,
   200 customers, vendors, open POs), then snapshot with `pg_dump -Fc`.
3. For each run: restore the snapshot, **restart the API** (a restore under a
   running API leaves it with stale type ids), then `SIM_MINUTES=12 node sim/day.mjs`.
   Add `SIM_SWAP="cs.priya:analyst"` to try a different staffing mix.
4. `python3 sim/report2.py` rebuilds the round-2 report from the result files.
