import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { isoDate } from "../lib/dates.js";
import { auditIn, logAudit } from "../lib/audit.js";
import { ConflictError, HttpError } from "../lib/conflictError.js";
import { OPEN_INBOUND_STATUSES } from "../lib/inbound.js";
import { requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { idempotent } from "../middleware/idempotency.js";
import { prisma } from "../prisma.js";

// Inbound shipments (sprint 4): one record per container or inbound
// shipment from a vendor, linked to the vendor PO lines it carries, so
// purchasing and the back order queue can see when more product arrives.
// Receiving stays on the PO (POST /api/vendor-purchase-orders/:po/receive);
// a receipt that completes every PO line a shipment carries marks it
// RECEIVED (lib/inbound.ts).
const router = Router();

const STATUS_OUT: Record<string, string> = {
  BOOKED: "Booked",
  IN_TRANSIT: "In Transit",
  AT_PORT: "At Port",
  ARRIVED: "Arrived",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};
const STATUS_IN = Object.fromEntries(Object.entries(STATUS_OUT).map(([k, v]) => [v, k])) as Record<string, DbStatus>;
type DbStatus = "BOOKED" | "IN_TRANSIT" | "AT_PORT" | "ARRIVED" | "RECEIVED" | "CANCELLED";
const statusSchema = z.enum(["Booked", "In Transit", "At Port", "Arrived", "Received", "Cancelled"]);

const lineSchema = z.object({
  vendorPoLineId: z.string().min(1),
  qty: z.number().int().positive(),
});

const createSchema = z.object({
  reference: z.string().trim().min(1).max(100),
  carrier: z.string().trim().max(100).default(""),
  vendorId: z.string().nullish(),
  status: statusSchema.optional(),
  etd: isoDate.nullish(),
  eta: isoDate.nullish(),
  notes: z.string().max(5000).default(""),
  lines: z.array(lineSchema).max(500).default([]),
});

const updateSchema = createSchema.extend({ version: z.number().int() });
const setStatusSchema = z.object({ version: z.number().int(), status: statusSchema });

// Who may see inbound shipments: the page itself, plus the pages that show
// arrivals as context (purchase orders, receiving, the back order queue).
const VIEW_PAGES = ["inbound-shipments", "purchase-orders", "receiving", "back-orders"];
const PAGE = "inbound-shipments";

const include = {
  vendor: { select: { id: true, name: true } },
  lines: {
    include: {
      vendorPoLine: { select: { id: true, poNumber: true, itemNumber: true, description: true, orderedQty: true, receivedQty: true } },
    },
  },
} satisfies Prisma.InboundShipmentInclude;

type Row = Prisma.InboundShipmentGetPayload<{ include: typeof include }>;

function day(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function mapOut(s: Row) {
  return {
    id: s.id,
    reference: s.reference,
    carrier: s.carrier,
    vendorId: s.vendorId,
    vendorName: s.vendor?.name ?? null,
    status: STATUS_OUT[s.status] ?? s.status,
    etd: day(s.etd),
    eta: day(s.eta),
    arrivedAt: s.arrivedAt,
    notes: s.notes,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    version: s.version,
    lines: s.lines.map((l) => ({
      id: l.id,
      vendorPoLineId: l.vendorPoLineId,
      qty: l.qty,
      poNumber: l.vendorPoLine.poNumber,
      itemNumber: l.vendorPoLine.itemNumber,
      description: l.vendorPoLine.description,
      orderedQty: l.vendorPoLine.orderedQty,
      receivedQty: l.vendorPoLine.receivedQty,
    })),
    poNumbers: [...new Set(s.lines.map((l) => l.vendorPoLine.poNumber))].sort(),
    units: s.lines.reduce((sum, l) => sum + l.qty, 0),
  };
}

// The lines must exist; a shipment with no vendor takes the vendor of the
// POs it carries, and every line must belong to that vendor's POs.
async function checkLines(tx: Prisma.TransactionClient, vendorId: string | null | undefined, lines: { vendorPoLineId: string; qty: number }[]): Promise<string | null> {
  const ids = [...new Set(lines.map((l) => l.vendorPoLineId))];
  if (ids.length !== lines.length) throw new HttpError(400, "A PO line appears twice on this shipment.");
  if (ids.length === 0) return vendorId ?? null;
  const poLines = await tx.vendorPoLine.findMany({ where: { id: { in: ids } }, select: { id: true, vendorPo: { select: { vendorId: true, poNumber: true } } } });
  if (poLines.length !== ids.length) throw new HttpError(400, "A PO line on this shipment no longer exists - reload and try again.");
  const vendors = new Set(poLines.map((l) => l.vendorPo.vendorId));
  const resolved = vendorId ?? (vendors.size === 1 ? poLines[0].vendorPo.vendorId : null);
  if (resolved) {
    const foreign = poLines.filter((l) => l.vendorPo.vendorId !== resolved);
    if (foreign.length > 0) throw new HttpError(400, `${foreign.map((l) => l.vendorPo.poNumber).join(", ")} belongs to a different vendor than this shipment.`);
  }
  return resolved;
}

function arrivedAtFor(status: DbStatus, current: Date | null): Date | null {
  if (status === "ARRIVED" || status === "RECEIVED") return current ?? new Date();
  if (status === "CANCELLED") return current;
  return null;
}

router.use(requireAuth);

// `?open=1` keeps only shipments still expected (not received or cancelled);
// `q` matches the reference, carrier or vendor name; `poNumber` lists the
// shipments carrying a line of that PO; `page` pages the result. Sorted by
// ETA, soonest first, with no ETA last.
router.get("/", requireAnyPermission(VIEW_PAGES, "view"), async (req, res) => {
  const openOnly = req.query.open === "1" || req.query.open === "true";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const poNumber = typeof req.query.poNumber === "string" ? req.query.poNumber.trim() : "";
  const where: Prisma.InboundShipmentWhereInput = {
    ...(openOnly ? { status: { in: [...OPEN_INBOUND_STATUSES] } } : {}),
    ...(q
      ? {
          OR: [
            { reference: { contains: q, mode: "insensitive" } },
            { carrier: { contains: q, mode: "insensitive" } },
            { vendor: { name: { contains: q, mode: "insensitive" } } },
            { lines: { some: { vendorPoLine: { poNumber: { contains: q, mode: "insensitive" } } } } },
          ],
        }
      : {}),
    ...(poNumber ? { lines: { some: { vendorPoLine: { poNumber } } } } : {}),
  };
  const orderBy: Prisma.InboundShipmentOrderByWithRelationInput[] = [{ eta: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }];
  const page = Number(req.query.page);
  if (Number.isInteger(page) && page > 0) {
    const pageSize = Math.min(Math.max(1, Number(req.query.pageSize) || 50), 500);
    const [rows, total] = await Promise.all([
      prisma.inboundShipment.findMany({ where, orderBy, include, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.inboundShipment.count({ where }),
    ]);
    res.json({ rows: rows.map(mapOut), total, page, pageSize });
    return;
  }
  const rows = await prisma.inboundShipment.findMany({ where, orderBy, include });
  res.json(rows.map(mapOut));
});

router.get("/:id", requireAnyPermission(VIEW_PAGES, "view"), async (req, res) => {
  const row = await prisma.inboundShipment.findUnique({ where: { id: req.params.id }, include });
  if (!row) {
    res.status(404).json({ error: "Inbound shipment not found" });
    return;
  }
  res.json(mapOut(row));
});

router.post("/", requirePermission(PAGE, "edit"), idempotent("inbound-shipment"), async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const status: DbStatus = data.status ? STATUS_IN[data.status] : "BOOKED";
  const row = await prisma.$transaction(async (tx) => {
    const vendorId = await checkLines(tx, data.vendorId, data.lines);
    const created = await tx.inboundShipment.create({
      data: {
        reference: data.reference,
        carrier: data.carrier,
        vendorId,
        status,
        etd: data.etd ? new Date(data.etd) : null,
        eta: data.eta ? new Date(data.eta) : null,
        arrivedAt: arrivedAtFor(status, null),
        notes: data.notes,
        lines: { create: data.lines.map((l) => ({ vendorPoLineId: l.vendorPoLineId, qty: l.qty })) },
      },
      include,
    });
    await auditIn(tx, req.account!, "INBOUND_SHIPMENT_CREATED", "inbound-shipment", created.id, created.reference, {
      status: STATUS_OUT[created.status],
      eta: day(created.eta),
      lines: created.lines.length,
      pos: [...new Set(created.lines.map((l) => l.vendorPoLine.poNumber))],
    });
    return created;
  });
  res.status(201).json(mapOut(row));
});

// Version-checked like a vendor PO: the whole record, lines replaced with
// what was sent.
router.put("/:id", requirePermission(PAGE, "edit"), async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const id = req.params.id;
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ version: number; status: string; arrivedAt: Date | null }[]>`SELECT "version", "status"::text AS "status", "arrivedAt" FROM "InboundShipment" WHERE "id" = ${id} FOR UPDATE`;
      if (rows.length === 0) throw new HttpError(404, "Inbound shipment not found");
      if (rows[0].version !== data.version) throw new ConflictError();
      const status: DbStatus = data.status ? STATUS_IN[data.status] : (rows[0].status as DbStatus);
      const vendorId = await checkLines(tx, data.vendorId, data.lines);
      await tx.inboundShipmentLine.deleteMany({ where: { shipmentId: id } });
      await tx.inboundShipment.update({
        where: { id },
        data: {
          reference: data.reference,
          carrier: data.carrier,
          vendorId,
          status,
          etd: data.etd ? new Date(data.etd) : null,
          eta: data.eta ? new Date(data.eta) : null,
          arrivedAt: arrivedAtFor(status, rows[0].arrivedAt),
          notes: data.notes,
          version: { increment: 1 },
          lines: { create: data.lines.map((l) => ({ vendorPoLineId: l.vendorPoLineId, qty: l.qty })) },
        },
      });
      await auditIn(tx, req.account!, "INBOUND_SHIPMENT_UPDATED", "inbound-shipment", id, data.reference, {
        status: STATUS_OUT[status],
        ...(rows[0].status !== status ? { from: STATUS_OUT[rows[0].status] } : {}),
        eta: data.eta ?? null,
        lines: data.lines.length,
      });
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message, conflict: true });
      return;
    }
    throw err;
  }
  const updated = await prisma.inboundShipment.findUnique({ where: { id }, include });
  res.json(mapOut(updated!));
});

// Moves the shipment along (or cancels it) without resending the record.
router.post("/:id/status", requirePermission(PAGE, "edit"), async (req: AuthedRequest, res) => {
  const parsed = setStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const id = req.params.id;
  const status = STATUS_IN[parsed.data.status];
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ version: number; status: string; arrivedAt: Date | null; reference: string }[]>`SELECT "version", "status"::text AS "status", "arrivedAt", "reference" FROM "InboundShipment" WHERE "id" = ${id} FOR UPDATE`;
      if (rows.length === 0) throw new HttpError(404, "Inbound shipment not found");
      if (rows[0].version !== parsed.data.version) throw new ConflictError();
      await tx.inboundShipment.update({ where: { id }, data: { status, arrivedAt: arrivedAtFor(status, rows[0].arrivedAt), version: { increment: 1 } } });
      await auditIn(tx, req.account!, "INBOUND_SHIPMENT_STATUS_CHANGED", "inbound-shipment", id, rows[0].reference, { from: STATUS_OUT[rows[0].status], to: STATUS_OUT[status] });
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message, conflict: true });
      return;
    }
    throw err;
  }
  const updated = await prisma.inboundShipment.findUnique({ where: { id }, include });
  res.json(mapOut(updated!));
});

router.delete("/:id", requirePermission(PAGE, "edit"), async (req: AuthedRequest, res) => {
  const existing = await prisma.inboundShipment.findUnique({ where: { id: req.params.id }, select: { id: true, reference: true, status: true } });
  if (!existing) {
    res.status(404).json({ error: "Inbound shipment not found" });
    return;
  }
  // Lines go with it (ON DELETE CASCADE).
  await prisma.inboundShipment.delete({ where: { id: existing.id } });
  logAudit(req.account!, "INBOUND_SHIPMENT_DELETED", "inbound-shipment", existing.id, existing.reference, { status: STATUS_OUT[existing.status] });
  res.status(204).end();
});

export default router;
