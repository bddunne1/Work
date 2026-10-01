import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { prisma } from "../prisma.js";

// The Dashboard's numbers, computed here so a login that may not read the
// order list (or its prices) still sees how the day is going (B-10): how
// many orders wait in each queue, how many are late, and today's totals.
//
//   GET /api/dashboard/summary?today=YYYY-MM-DD&midnight=<ISO>
//
// `today` and `midnight` are the browser's local day, so "ship by today" and
// "shipped today" follow the person's clock, not the server's.
const router = Router();
router.use(requireAuth);

const OPEN = ["ENTERED", "CHECKED", "ALLOCATED", "BACKORDERED", "PICK_PACKED"] as const;

interface QueueSummary {
  count: number;
  late: number;
  oldest: string | null;
}

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function summarize(entries: { late: boolean; since: Date | string | null | undefined }[]): QueueSummary {
  let oldest: number | null = null;
  for (const e of entries) {
    const t = e.since ? new Date(e.since).getTime() : NaN;
    if (Number.isFinite(t) && (oldest === null || t < oldest)) oldest = t;
  }
  return { count: entries.length, late: entries.filter((e) => e.late).length, oldest: oldest === null ? null : new Date(oldest).toISOString() };
}

router.get("/summary", async (req: AuthedRequest, res) => {
  const todayRaw = String(req.query.today ?? "");
  const today = /^\d{4}-\d{2}-\d{2}$/.test(todayRaw) ? todayRaw : new Date().toISOString().slice(0, 10);
  const midnightRaw = new Date(String(req.query.midnight ?? ""));
  const midnight = Number.isNaN(midnightRaw.getTime()) ? new Date(`${today}T00:00:00.000Z`) : midnightRaw;

  const lineSelect = { select: { id: true, catalogItem: { select: { weight: true } } } };
  const [open, shippedToday, pulls] = await Promise.all([
    prisma.salesOrder.findMany({
      where: { status: { in: [...OPEN] } },
      select: {
        soNumber: true, status: true, dueDate: true, estimatedShipDate: true, createdAt: true, checkedAt: true,
        allocation: true, pickedAt: true, pendingShipment: true, pickListPrintedAt: true, packingSlipPrintedAt: true,
        lineItems: lineSelect,
      },
    }),
    prisma.shipmentRecord.findMany({
      where: { shippedAt: { gte: midnight } },
      select: { soNumber: true, lines: true, salesOrder: { select: { lineItems: lineSelect } } },
    }),
    // Cancelled after printing, not yet pulled back off the floor (A-23).
    prisma.salesOrder.findMany({ where: { status: "CANCELLED", pullRequestedAt: { not: null }, pullAcknowledgedAt: null }, select: { pullRequestedAt: true } }),
  ]);

  type Open = (typeof open)[number];
  const weightOf = (lines: { id: string; catalogItem: { weight: unknown } | null }[]) =>
    new Map(lines.map((l) => [l.id, l.catalogItem?.weight == null ? 0 : Number(l.catalogItem.weight)]));
  const shipBy = (o: Open) => dateOnly(o.estimatedShipDate ?? o.dueDate) ?? "";
  const late = (o: Open) => shipBy(o) < today;
  const staged = (o: Open) => (o.pendingShipment as { lineItemId: string; qty: number }[] | null) ?? [];
  const isStaged = (o: Open) => o.status === "PICK_PACKED" && staged(o).some((l) => l.qty > 0);
  const printed = (o: Open) => Boolean(o.pickListPrintedAt && o.packingSlipPrintedAt);
  const allocated = (o: Open) => ((o.allocation as { lines?: { allocatedQty: number }[]; decidedAt?: string } | null)?.lines ?? []).some((l) => l.allocatedQty > 0);
  const entry = (o: Open, since: Date | string | null | undefined) => ({ late: late(o), since });

  const queues = {
    validate: summarize(open.filter((o) => o.status === "ENTERED").map((o) => entry(o, o.createdAt))),
    allocate: summarize(open.filter((o) => o.status === "CHECKED").map((o) => entry(o, o.checkedAt ?? o.createdAt))),
    backorder: summarize(open.filter((o) => o.status === "BACKORDERED").map((o) => entry(o, null))),
    release: summarize(open.filter((o) => o.status === "ALLOCATED" && allocated(o)).map((o) => entry(o, (o.allocation as { decidedAt?: string } | null)?.decidedAt))),
    print: summarize(open.filter((o) => isStaged(o) && !printed(o)).map((o) => entry(o, o.pickedAt))),
    ship: summarize(open.filter((o) => isStaged(o) && printed(o)).map((o) => entry(o, [o.pickListPrintedAt, o.packingSlipPrintedAt].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0]))),
    pull: summarize(pulls.map((p) => ({ late: false, since: p.pullRequestedAt }))),
  };

  let shippedUnits = 0;
  let shippedWeight = 0;
  const shippedOrders = new Set<number>();
  for (const rec of shippedToday) {
    shippedOrders.add(rec.soNumber);
    const weights = weightOf(rec.salesOrder.lineItems);
    for (const l of rec.lines as { lineItemId: string; qty: number }[]) {
      shippedUnits += l.qty;
      shippedWeight += l.qty * (weights.get(l.lineItemId) ?? 0);
    }
  }
  const floor = open.filter(isStaged);
  let floorWeight = 0;
  for (const o of floor) {
    const weights = weightOf(o.lineItems);
    for (const l of staged(o)) floorWeight += l.qty * (weights.get(l.lineItemId) ?? 0);
  }

  res.json({
    today,
    queues,
    todayStats: {
      due: open.filter((o) => shipBy(o) === today).length,
      late: open.filter(late).length,
      shippedOrders: shippedOrders.size,
      shippedUnits,
      shippedWeight: Math.round(shippedWeight),
      floor: floor.length,
      floorWeight: Math.round(floorWeight),
    },
  });
});

export default router;
