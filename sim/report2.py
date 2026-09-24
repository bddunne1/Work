#!/usr/bin/env python3
"""Builds docs/review/erp-review-2.html from the round-2 simulation results.

Inputs (sim/): results-roles-base.json (2 analysts), results-roles-3analysts.json
(what-if), scale-baseline.json + scale-fixed.json (one year of history).
Styles are shared with docs/review/erp-review.html.
"""
import json, os, re, html

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "docs", "review", "erp-review-2.html")

def load(name):
    p = os.path.join(HERE, name)
    return json.load(open(p)) if os.path.exists(p) else None

base = load("results-roles-base.json")
whatif = load("results-roles-3analysts.json")
# Original-code timings: round 1's pages plus the pages measured this round.
r1_scale = json.load(open(os.path.join(ROOT, "docs", "review", "data", "scale-baseline.json")))
sc_base_r2 = load("scale-baseline-r2.json")
sc_base = {"pages": {**r1_scale["pages"], **(sc_base_r2["pages"] if sc_base_r2 else {})}}
sc_fixed = load("scale-fixed-r2.json")

r1 = open(os.path.join(ROOT, "docs", "review", "erp-review.html")).read()
style = re.search(r"<style>.*?</style>", r1, re.S).group(0)
fonts = "\n".join(l for l in r1.splitlines() if l.startswith("<link"))

esc = html.escape
nf = lambda n: f"{n:,}"

def role_avg(res):
    out = {}
    for p in res["summary"]["people"].values():
        out.setdefault(p["role"], []).append(p["busyPct"])
    return {k: round(sum(v) / len(v)) for k, v in out.items()}

def kinds(res):
    ev = res["events"]
    c = {}
    for e in ev:
        c[e["kind"]] = c.get(e["kind"], 0) + 1
    return c

def stage(res, key):
    v = res["summary"]["leadTimesMinutes"].get(key)
    return v

def day_block(res):
    a = res["audit"]
    k = kinds(res)
    st = a["orders"]["byStatus"]
    return {
        "entered": sum(res["summary"]["ordersEnteredBy"].values()),
        "checked": k.get("order-checked", 0),
        "allocated": k.get("order-allocated", 0),
        "released": k.get("pick-released", 0),
        "printed": k.get("pick-printed", 0),
        "confirmations": k.get("order-shipped", 0),
        "shipped_orders": st.get("Shipped", 0),
        "backordered": st.get("Backordered", 0),
        "waiting_validation": st.get("Entered", 0),
        "waiting_late": a["waitingValidation"]["fromYesterday"] + a["waitingValidation"]["arrivedBefore3pm"],
        "waiting_after3": a["waitingValidation"]["arrivedAfter3pm"],
        "cancelled": st.get("Cancelled", 0),
        "units_shipped": a["orders"]["shippedUnitsToday"],
        "units_ordered": a["orders"]["orderedUnitsToday"],
        "po_received": k.get("po-received", 0),
        "returns_received": k.get("return-received", 0),
        "returns_issued": k.get("return-issued", 0),
        "new_customers": k.get("customer-created", 0),
        "status_calls": k.get("status-call", 0),
        "quotes": k.get("quote", 0),
        "conflicts": res["summary"]["statusTotals"].get("409", 0),
        "s403": res["summary"]["statusTotals"].get("403", 0),
        "s500": res["summary"]["statusTotals"].get("500", 0),
        "drift": a["inventory"]["docDriftItems"],
        "ledger_drift": a["inventory"]["ledgerDriftItems"],
        "negative": a["inventory"]["negative"],
        "over": a["inventory"]["overcommittedUnits"],
        "cancel_hold": a["cancelledHoldingStock"],
        "movements": a["inventory"]["movementsToday"],
        "p95": res["summary"]["overall"]["p95"],
        "max": res["summary"]["overall"]["max"],
        "mb": res["summary"]["totalMB"],
        "calls": res["summary"]["totalCalls"],
        "entry_to_checked": stage(res, "entryToChecked"),
        "released_to_shipped": stage(res, "releasedToShipped"),
        "entry_to_shipped": stage(res, "entryToShipped"),
    }

B = day_block(base)
W = day_block(whatif) if whatif else None
RB = role_avg(base)
RW = role_avg(whatif) if whatif else {}

people_rows = []
for name, p in base["summary"]["people"].items():
    people_rows.append((p["role"], name, p["busyPct"]))

ROLES = [
    ("Purchasing", 2, "Writes vendor POs, receives trucks and customer returns, keeps vendors and the catalog current, runs cycle counts.",
     "Purchase Orders, Receiving, Vendors, Inventory, Item Catalog, Import (edit). Returns, back orders, capacity, reports (view)."),
    ("Customer Service", 4, "Takes phone orders, answers order-status calls, quotes price and availability, issues RAs, cancels orders at the customer's request.",
     "Order Entry, Sales Order View, Customers, Returns (edit). Open/closed orders, back orders, schedule, shipment history, pricing, routing guide, catalog, inventory, reports (view)."),
    ("Order Entry", 2, "Keys customer POs and prints pick lists and packing slips for picks the analysts have released. Can't validate or release.",
     "Order Entry, Import, Pick & Pack print (edit). Open orders, order view, customers, catalog, inventory (view)."),
    ("Analyst", 2, "Validates and allocates orders, works the back-order queue, releases picks to the floor, and sets ship dates from vendor ETAs.",
     "Validation, Allocation, Back Orders, Release Picks, Schedule, Sales Order View, Reports (edit). POs, receiving, capacity, inventory, catalog, customers, shipment history (view)."),
    ("Logistics", 1, "Confirms what shipped once the floor finishes a pick, generates BOLs, books carrier pickups, runs the end-of-day shipped report.",
     "Open Picks, Shipment History, Schedule, BOL, Labels (edit). Routing guide, capacity, pick & pack, orders, customers, inventory, reports (view)."),
    ("Director", 1, "Oversight: dashboard, analytics, activity log and stock ledger, reports; can do any task.",
     "Admin role (every page, plus Accounts). A Director preset (every page at edit, no Accounts) is also available."),
    ("Sales Manager", 3, "Sets up new accounts, maintains customer records, pricing and routing guides, and reviews their accounts' orders and analytics.",
     "Customers, Customer Pricing, Routing Guide, Analytics, Reports (edit). Orders, back orders, shipments, schedule, catalog, inventory (view)."),
]

def bar_rows(metrics, names, colors, unit=""):
    out = []
    for m in metrics:
        vals = m["v"]
        mx = max([v for v in vals if v is not None] or [1]) or 1
        rows = []
        for i, v in enumerate(vals):
            if v is None:
                continue
            pct = v / mx * 100
            label = f"{nf(v) if isinstance(v, int) else v}{m.get('fmt', unit)}"
            rows.append(
                f'<div class="bar-row" data-tip="{esc(names[i])}: {esc(label)}"><div class="track"><div class="fill{" zero" if v == 0 else ""}" '
                f'style="width:{pct:.2f}%;background:{colors[i]}"></div></div><div class="bar-val">{esc(label)}</div></div>'
            )
        out.append(f'<div class="metric"><div class="metric-name">{esc(m["name"])}<small>{esc(m.get("note", ""))}</small></div><div class="bars">{"".join(rows)}</div></div>')
    return "".join(out)

def fmt_stage(s):
    return f"{s['p50']} min (90% within {s['p90']})" if s else "n/a"

# --- utilization chart: per role, 2 analysts vs 3 analysts --------------
role_order = ["Analyst", "Order Entry", "Logistics", "Customer Service", "Director", "Purchasing", "Sales Manager"]
util_metrics = []
for role in role_order:
    v = [RB.get(role), RW.get(role)] if W else [RB.get(role)]
    util_metrics.append({"name": role, "note": "average busy share of the day", "v": v, "fmt": "%"})
util_names = ["As staffed (2 analysts, 4 CS)", "What-if (3 analysts, 3 CS)"]
util_colors = ["var(--s1)", "var(--s3)"]
util_html = bar_rows(util_metrics, util_names, util_colors)

# --- scale chart -----------------------------------------------------------
scale_rows = ""
scale_html = ""
if sc_base and sc_fixed:
    pages = [p for p in sc_fixed["pages"] if p in sc_base["pages"]]
    ms = []
    for p in pages:
        b, f = sc_base["pages"][p], sc_fixed["pages"][p]
        ms.append({"name": p, "note": "15 people open it at once", "v": [round(b["wallMs"] / 1000, 2), round(f["wallMs"] / 1000, 2)], "fmt": " s"})
        scale_rows += (
            f"<tr><td>{esc(p)}</td><td class='num bad'>{b['wallMs']/1000:.1f} s</td><td class='num good'>{f['wallMs']/1000:.2f} s</td>"
            f"<td class='num'>{nf(round(b['mbTransferred']))} MB</td><td class='num'>{f['mbTransferred']} MB</td>"
            f"<td class='num'>{b['healthMaxMs']/1000:.1f} s</td><td class='num'>{f['healthMaxMs']/1000:.2f} s</td>"
            f"<td class='num{' bad' if b['failedCalls'] else ''}'>{b['failedCalls']}</td><td class='num'>{f['failedCalls']}</td></tr>"
        )
    scale_html = bar_rows(ms, ["Original", "Round 2"], ["var(--s1)", "var(--s3)"])

def row(label, key, fmt=nf, bad_if=None):
    b = B[key]
    w = W[key] if W else None
    cls = lambda v: " bad" if bad_if and v is not None and bad_if(v) else ""
    return f"<tr><td>{label}</td><td class='num{cls(b)}'>{fmt(b)}</td>" + (f"<td class='num{cls(w)}'>{fmt(w)}</td>" if W else "") + "</tr>"

people_html = "".join(
    f"<tr><td>{esc(role)}</td><td class='mono'>{esc(name)}</td><td class='num{' bad' if busy >= 90 else ''}'>{busy}%</td></tr>"
    for role, name, busy in sorted(people_rows, key=lambda r: (role_order.index(r[0]) if r[0] in role_order else 99, r[1]))
)

roles_html = "".join(
    f"<tr><td><strong>{esc(n)}</strong></td><td class='num'>{c}</td><td>{esc(d)}</td><td class='muted'>{esc(p)}</td></tr>" for n, c, d, p in ROLES
)

W_head = "<th class='num'>What-if: 3 analysts, 3 CS</th>" if W else ""

whatif_text = ""
if W:
    whatif_text = (
        f"<p>Moving one customer service rep to Analyst (3 CS, 3 analysts) cut the orders still waiting for validation at close from "
        f"<strong>{B['waiting_validation']}</strong> to <strong>{W['waiting_validation']}</strong>, and took fully shipped orders from "
        f"{B['shipped_orders']} to {W['shipped_orders']} ({nf(B['units_shipped'])} to {nf(W['units_shipped'])} units). Analysts went from "
        f"{RB.get('Analyst')}% to {RW.get('Analyst')}% busy, and the three remaining customer service reps from {RB.get('Customer Service')}% to "
        f"{RW.get('Customer Service')}%.</p>"
    )

page = f"""<title>Aamstrand ERP Round 2</title>
<meta name="description" content="Round 2: roles redesign, cancellations and returns, item links, stock ledger, paging and import fixes, a new 15-person workday simulation and a staffing what-if.">
{fonts}
{style}
<style>
  td.mono, .mono {{ font-family: var(--mono); font-size: 0.84rem; }}
  .rec {{ border-left: 4px solid var(--ok); background: var(--ok-bg); padding: 14px 16px; border-radius: 0 6px 6px 0; display: flex; flex-direction: column; gap: 8px; }}
  .rec ol {{ margin: 0; padding-left: 1.2em; display: flex; flex-direction: column; gap: 6px; max-width: 76ch; }}
</style>

<div class="wrap">
  <header class="doc-head">
    <div style="display:flex;flex-direction:column;gap:14px">
      <span class="eyebrow">Round 2 · roles, workflow fixes, simulation</span>
      <h1>Aamstrand ERP Round 2</h1>
      <p class="lede">All five next steps you picked are built: history paging, cancellations and returns that restock, item links on every line, a stock ledger with an audit trail, and a reliable import. The app now has your seven roles, and the server enforces who can move an order to each stage. The new 15-person day ended with the books exact. It also showed that two analysts can't keep up with validation, allocation and pick release at 150 orders a day.</p>
    </div>
    <dl class="doc-meta">
      <dt>Prepared</dt><dd>24 Sep 2026</dd>
      <dt>Branch</dt><dd>claude/practical-volta-02z5tg</dd>
      <dt>Round 1</dt><dd>erp-review.html</dd>
      <dt>Migration</dt><dd>1 (additive)</dd>
    </dl>
  </header>

  <section aria-labelledby="summary">
    <div class="section-head"><span class="eyebrow">01 · Summary</span><h2 id="summary">Where it stands</h2></div>
    <div class="verdict">
      <div><span class="eyebrow">Stock and order integrity</span><span class="big good">0 errors</span>
        <p>after a full day: on-hand matches the stock ledger and the documents for all 500 SKUs, nothing went negative, no units were promised twice, and cancelled orders released everything they held. {B['movements']} stock movements were recorded, each with who and why.</p></div>
      <div><span class="eyebrow">Bottleneck</span><span class="big bad">{B['waiting_validation']} orders</span>
        <p>of 210 were still waiting for validation at close. The two analysts were {RB.get('Analyst')}% busy: they validate, allocate and release every pick. Customer service averaged {RB.get('Customer Service')}% and sales managers {RB.get('Sales Manager')}%.</p></div>
      <div><span class="eyebrow">Checks</span><span class="big good">73 / 73</span>
        <p>browser checks passed for every role's pages and key actions. There were 16 of 16 server behavior checks, 0 permission refusals and 0 server errors in the simulated day, and the typecheck and lint are clean.</p></div>
    </div>
    <div class="prose">
      <p><strong>Push to main tonight?</strong> Yes, through a pull request, once you've done the four steps in section 07. The database change is additive, and every workflow was exercised end to end. A few behavior changes are deliberate and will look different to your team (see section 07).</p>
    </div>
  </section>

  <section aria-labelledby="roles">
    <div class="section-head"><span class="eyebrow">02 · Roles</span><h2 id="roles">Seven roles, enforced by the server</h2></div>
    <div class="prose"><p>Each role is a preset on the Accounts page. The server checks the same permissions, so a role can't do more through the API than its screens allow. Status changes are checked step by step:</p>
    <ul>
      <li>Entered → Checked needs Validation.</li>
      <li>Checked → Allocated needs Allocation.</li>
      <li>Allocated → Pick &amp; Packed needs the new <strong>Release Picks</strong> permission.</li>
      <li>Confirming a shipment needs Open Picks.</li>
      <li>Cancelling needs Sales Order View or Allocation.</li>
      <li>Nobody can skip a step.</li>
    </ul>
    <p>Pick &amp; Pack is split in two, so Order Entry can print released picks without releasing them.</p></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Role</th><th class="num">People</th><th>Does</th><th>Access</th></tr></thead>
      <tbody>{roles_html}</tbody></table></div>
    <div class="panel">
      <h3>Roles you may have missed</h3>
      <ul>
        <li><strong>Warehouse floor (pick and pack).</strong> Nobody in the roster physically picks. The sim models the floor as time between printing a pick and logistics confirming it, and logistics keys in any shorts. A Warehouse role on a tablet at the dock could confirm picks and record shorts directly, which would take load off the single logistics person ({RB.get('Logistics')}% busy).</li>
        <li><strong>Accounting / billing.</strong> Nothing invoices shipped orders, applies payments or turns returns into credit memos. You need either this role and module, or an export to your accounting system.</li>
        <li><strong>System admin.</strong> Right now only the Director has the Admin role, which covers account management. A second admin avoids a single point of failure for password resets and new hires.</li>
        <li><strong>Sales managers' lead capture.</strong> The app has no leads, quotes or follow-ups. Sales managers can only add a customer once it's won. This gap is on the to-do list.</li>
      </ul>
    </div>
  </section>

  <section aria-labelledby="sim">
    <div class="section-head"><span class="eyebrow">03 · Simulation</span><h2 id="sim">A day with the new team</h2></div>
    <div class="prose">
      <p>The 15 people above worked one 8-hour day, compressed into 12 minutes, against the real API. The load was the same as round 1: 150 new orders plus 60 left over from yesterday, the top 20 customers placing 80% of them, and 10% of orders with 20 or more lines. How each role spent the day:</p>
      <ul>
        <li><strong>Order entry</strong> keyed 55% of the orders and printed picks.</li>
        <li><strong>Customer service</strong> took the phone orders, plus status calls, quotes, returns and cancellations.</li>
        <li><strong>Analysts</strong> validated, allocated and released picks.</li>
        <li><strong>The warehouse floor</strong> took 10 minutes plus about 1.5 minutes per line to pick an order after printing.</li>
        <li><strong>Logistics</strong> confirmed shipments, booked pickups, generated BOLs and ran the end-of-day report.</li>
        <li><strong>Purchasing</strong> received trucks and returns, wrote POs and ran cycle counts.</li>
        <li><strong>Sales managers</strong> opened new accounts and worked their existing ones.</li>
      </ul>
      <p>Busy time is what each person spent on tasks. Idle time is waiting for work to show up.</p>
    </div>

    <figure class="chart" style="margin:0" aria-label="Busy share by role">
      <div class="legend" aria-hidden="true">
        <span><span class="key" style="background:var(--s1)"></span>{util_names[0]}</span>
        {'<span><span class="key" style="background:var(--s3)"></span>' + util_names[1] + '</span>' if W else ''}
      </div>
      {util_html}
    </figure>

    <div class="table-wrap"><table>
      <thead><tr><th>End of day</th><th class='num'>As staffed</th>{W_head}</tr></thead>
      <tbody>
        {row("Orders entered (order entry / customer service)", "entered")}
        {row("Orders validated", "checked")}
        {row("Allocation decisions", "allocated")}
        {row("Picks released to the floor", "released")}
        {row("Shipments confirmed", "confirmations")}
        {row("Orders fully shipped", "shipped_orders")}
        {row("Units shipped", "units_shipped")}
        {row("Waiting for validation at close: arrived before 3 pm or yesterday", "waiting_late", bad_if=lambda v: v > 10)}
        {row("Waiting for validation at close: arrived after 3 pm", "waiting_after3")}
        {row("Backordered (waiting on stock)", "backordered")}
        {row("Orders cancelled by customer service", "cancelled")}
        {row("Vendor PO receipts / returns received", "po_received", fmt=lambda v: nf(v))}
        {row("Order-status calls answered", "status_calls")}
        {row("Price & availability quotes", "quotes")}
        {row("New customers set up", "new_customers")}
        {row("SKUs where on-hand ≠ documents", "drift", bad_if=lambda v: v > 0)}
        {row("SKUs where on-hand ≠ stock ledger", "ledger_drift", bad_if=lambda v: v > 0)}
        {row("SKUs with negative stock", "negative", bad_if=lambda v: v > 0)}
        {row("Units promised twice", "over", bad_if=lambda v: v > 0)}
        {row("Cancelled orders still holding stock", "cancel_hold", bad_if=lambda v: v > 0)}
        {row("Permission refusals / server errors", "s403", fmt=lambda v: nf(v))}
        {row("Collisions refused with a message (409)", "conflicts")}
        {row("Slowest request of the day", "max", fmt=lambda v: f"{v} ms")}
      </tbody></table></div>
    <p class="muted" style="font-size:0.9rem">There were no server errors in either run. The 409s are the app refusing an action after someone else got there first, most often "this order already moved on" when two analysts reach for the top of the same queue. Nothing is written in that case; the person reloads and picks the next order.</p>

    <div class="two-col">
      <div class="panel">
        <h3>How long each step waited (as staffed)</h3>
        <ul>
          <li><strong>Entered → validated:</strong> {fmt_stage(B['entry_to_checked'])} for the orders that got validated at all.</li>
          <li><strong>Pick released → confirmed shipped:</strong> {fmt_stage(B['released_to_shipped'])}. That's floor time plus logistics.</li>
          <li><strong>Entered → shipped, same day:</strong> {fmt_stage(B['entry_to_shipped'])}.</li>
        </ul>
        <p class="muted">Once an order is validated it moves quickly: allocation and release each happen within minutes. The wait is almost entirely at validation.</p>
      </div>
      <div class="panel">
        <h3>Everyone's day (as staffed)</h3>
        <div class="table-wrap"><table><thead><tr><th>Role</th><th>Person</th><th class="num">Busy</th></tr></thead><tbody>{people_html}</tbody></table></div>
      </div>
    </div>

    <div class="callout">
      <p><strong>Staffing:</strong> at about 8 minutes of analyst time per order (validation, allocation and release, from the assumptions below), 150 orders a day needs about 2.5 analysts. Clearing a 60-order backlog on top of that needs 3.5. Customer service and sales management have the most slack.</p>
    </div>
    {whatif_text}
    <p class="muted" style="font-size:0.9rem">These conclusions depend on my time assumptions for each task. Validating takes 1 minute plus 9 seconds per line, allocating 1 minute plus 15 seconds per line, and releasing 1 minute plus 6 seconds per line. Time a few real orders; if your analysts are faster, the gap shrinks. Other options besides hiring: let customer service validate the phone orders they took (a one-line preset change), or skip separate validation for small repeat orders from key accounts.</p>
  </section>

  <section aria-labelledby="scale">
    <div class="section-head"><span class="eyebrow">04 · Scale</span><h2 id="scale">A year of orders, round 2</h2></div>
    <div class="prose"><p>This is the same test as round 1: 37,800 shipped orders in the database, with 15 people opening a page at the same moment. The middle of three runs is shown. This round adds the pages that were still downloading the entire history.</p></div>
    <figure class="chart" style="margin:0" aria-label="Scale test"><div class="legend" aria-hidden="true"><span><span class="key" style="background:var(--s1)"></span>Original</span><span><span class="key" style="background:var(--s3)"></span>Round 2</span></div>{scale_html}</figure>
    <div class="table-wrap"><table><thead><tr><th>15 people open…</th><th class="num">Original: wait</th><th class="num">Round 2: wait</th><th class="num">Original: downloaded</th><th class="num">Round 2: downloaded</th><th class="num">Original: server frozen</th><th class="num">Round 2: server frozen</th><th class="num">Original: failed</th><th class="num">Round 2: failed</th></tr></thead><tbody>{scale_rows}</tbody></table></div>
  </section>

  <section aria-labelledby="built">
    <div class="section-head"><span class="eyebrow">05 · Built</span><h2 id="built">What changed this round</h2></div>
    <div class="two-col">
      <div class="panel"><h3>Step 2 · Paging</h3><p>A paged order search (status, customer, item, PO, and order and ship dates) and server-side analytics replace the full-history downloads on these pages:</p><ul><li>Open and Closed Orders</li><li>Shipment History</li><li>Analytics</li><li>Reports (capped at 5,000 rows, with a notice)</li><li>Item Profile</li><li>Item Quick Report (which now matches the exact item)</li></ul><p>Order Entry, Pricing and Returns load a slim customer list and fetch one customer's price sheet when it's picked. Schedule Shipments, Product Labels and the Settings number check no longer load history either.</p></div>
      <div class="panel"><h3>Step 4 · Cancel and restock</h3><ul><li><strong>Cancel Order</strong> needs a reason, releases allocated and packed stock, and takes the order out of every queue.</li><li><strong>Receive Return</strong> puts each line marked restock back on hand, and logs damaged lines as scrap.</li><li>An RA tied to an S.O. can't return more than that order shipped.</li><li>An RA can no longer be marked Received by a plain save.</li></ul></div>
      <div class="panel"><h3>Step 5 · Item links</h3><ul><li>Order, PO and return lines carry the catalog item's id, and existing lines were backfilled.</li><li>Unknown items are rejected when an order is saved, with the item named.</li><li>Renaming an item carries its orders, POs, returns, customer prices and part numbers with it.</li><li>An item with history can't be deleted.</li></ul></div>
      <div class="panel"><h3>Step 6 · Audit trail</h3><ul><li>Every change to on-hand (ship, undo, receive, return, count, edit) writes a stock-ledger row in the same transaction, with who did it and which document caused it.</li><li>The Activity Log records order, PO, return, item, customer and vendor events, with filters and a Stock ledger tab.</li><li>Item Profile shows the item's stock history.</li></ul></div>
      <div class="panel"><h3>Step 7 · Import</h3><ul><li>Rows are saved one at a time; a failure never stops the run.</li><li>Each row gets a result, and failed rows can be downloaded as a CSV.</li><li>Existing records and duplicates within the file are skipped.</li><li>Amounts like "$1,234.50" parse; anything else is a row error.</li><li>The button is locked while saving, and view-only accounts can't import.</li></ul></div>
      <div class="panel"><h3>Roles and workflow rules</h3><ul><li>Seven presets.</li><li>A separate Release Picks permission.</li><li>Each status change is checked, with no skipping steps.</li><li>An order's lines are frozen once stock is committed (unallocate first to change them).</li><li>Stale screens are refused.</li></ul></div>
    </div>
  </section>

  <section aria-labelledby="verify">
    <div class="section-head"><span class="eyebrow">06 · Verification</span><h2 id="verify">How it was checked</h2></div>
    <div class="prose"><ul>
      <li><strong>Types and lint:</strong> the frontend and API typecheck and lint clean. The only warnings are 2 older ones in <code>authContext.tsx</code>.</li>
      <li><strong>Server behavior, 16 of 16:</strong>
        <ul>
          <li>unknown items are rejected</li>
          <li>order entry can't validate</li>
          <li>skipping steps is refused</li>
          <li>lines are frozen once allocated</li>
          <li>cancel releases stock</li>
          <li>an RA can't exceed what shipped</li>
          <li>ship −5 and restock +3 (with 2 scrapped) balance</li>
          <li>a return can't be received twice</li>
          <li>ship, return and count adjustments appear in the ledger</li>
          <li>a rename carries order lines along</li>
          <li>an item with history can't be deleted</li>
          <li>the order audit trail is recorded</li>
        </ul></li>
      <li><strong>Browser, 73 of 73:</strong>
        <ul>
          <li>logistics ships, and purchasing receives a PO and a return, in the real UI</li>
          <li>customer service cancels an order</li>
          <li>order entry can't release picks</li>
          <li>a stale allocation page refuses to act</li>
          <li>the stock ledger appears on Item Profile</li>
          <li>66 page loads across the 7 roles with no console errors</li>
        </ul></li>
      <li><strong>Paging, 41 of 41:</strong> the new search and analytics results match the old client-side calculations on 37,808 orders.</li>
      <li><strong>Import:</strong> 26 parser checks, plus an end-to-end run. It covered a simulated failure mid-import, a double-click, re-importing a partly failed file, and a view-only account.</li>
    </ul>
    <p class="muted">The simulation also caught one regression I introduced while merging: the analytics query broke after I excluded cancelled orders. It was fixed before the run reported here.</p></div>
  </section>

  <section aria-labelledby="main">
    <div class="section-head"><span class="eyebrow">07 · Main</span><h2 id="main">Pushing to main for tonight's tests</h2></div>
    <div class="rec">
      <p><strong>Recommendation: merge through a pull request tonight</strong>, after these four steps:</p>
      <ol>
        <li><strong>Back up the database</strong> (<code>pg_dump -Fc</code>). The new migration is additive: a new status value, new columns and a new stock-ledger table, with existing lines linked to items automatically. Still, keep a backup.</li>
        <li><strong>Apply the migration</strong> with <code>cd server &amp;&amp; npx prisma migrate deploy</code>, then restart the API.</li>
        <li><strong>Re-apply a role preset to each account</strong> on the Accounts page. Existing accounts keep their old permissions, and anyone who releases picks now needs the new Release Picks permission.</li>
        <li><strong>Change the <code>admin</code> password.</strong></li>
      </ol>
      <p>Behavior your team will notice:</p>
      <ul>
        <li>Allocation won't reserve more than is free.</li>
        <li>Orders with items that aren't in the catalog are refused.</li>
        <li>Allocated orders can't have their lines edited until they're unallocated.</li>
        <li>Only logistics (Open Picks / Shipment History) can confirm or undo shipments.</li>
        <li>An RA is received with the Receive Return button.</li>
      </ul>
    </div>
  </section>

  <section aria-labelledby="open">
    <div class="section-head"><span class="eyebrow">08 · Still open</span><h2 id="open">What's left</h2></div>
    <div class="prose"><p>The shared to-do list tracks the remaining next steps (admin password and policy, HTTPS on one address, and running the simulation regularly), the open bugs and the role gaps; status and notes can be updated right on the page. The same bugs are logged in the repo at <code>docs/review/open-bugs.md</code>.</p></div>
  </section>

  <footer>Raw results: <code>docs/review/data/round2/</code>. The simulation scripts are in <code>sim/</code>. To re-run: restore the seeded snapshot, restart the API, then run <code>SIM_MINUTES=12 node sim/day.mjs</code>; add <code>SIM_SWAP="cs.priya:analyst"</code> for the what-if.</footer>
</div>
<script>
  // tooltips are CSS-only; nothing to initialise
</script>
"""
open(OUT, "w").write(page)
print("wrote", OUT)
