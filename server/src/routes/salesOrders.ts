import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { syncChildren } from "../lib/syncChildren.js";
import { prisma } from "../prisma.js";

const router = Router();

// App-facing status strings <-> the Prisma enum, same translation approach
// as vendorPurchaseOrders.ts and returns.ts.
const STATUS_IN = {
  Entered: "ENTERED",
  Checked: "CHECKED",
  Allocated: "ALLOCATED",
  Backordered: "BACKORDERED",
  "Pick & Packed": "PICK_PACKED",
  Shipped: "SHIPPED",
} as const;
const STATUS_OUT: Record<string, string> = {
  ENTERED: "Entered",
  CHECKED: "Checked",
  ALLOCATED: "Allocated",
  BACKORDERED: "Backordered",
  PICK_PACKED: "Pick & Packed",
  SHIPPED: "Shipped",
};
const PICK_PACK_STATUS_IN = { Partial: "PARTIAL", Complete: "COMPLETE" } as const;
const PICK_PACK_STATUS_OUT: Record<string, string> = { PARTIAL: "Partial", COMPLETE: "Complete" };

const SO_COUNTER_KEY = "salesOrder";
const SO_START = 10001;

const addressSchema = z.object({
  name: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  notes: z.string().optional(),
});

const lineItemSchema = z.object({
  id: z.string().optional(),
  item: z.string(),
  description: z.string(),
  um: z.string().default("EA"),
  ordered: z.number().int(),
  rate: z.number(),
  customerPartNumber: z.string().nullish(),
});

const allocationSchema = z
  .object({
    lines: z.array(z.object({ lineItemId: z.string(), allocatedQty: z.number() })),
    fullyAllocated: z.boolean(),
    shipCompleteOnly: z.boolean().optional(),
    decidedAt: z.string(),
  })
  .nullish();

const shipmentLineSchema = z.object({ lineItemId: z.string(), qty: z.number() });

const shipmentRecordSchema = z.object({
  id: z.string().optional(),
  shippedAt: z.string(),
  lines: z.array(shipmentLineSchema),
});

const bolSchema = z
  .object({
    weight: z.string(),
    dimensions: z.string(),
    skidCount: z.string(),
    generatedAt: z.string(),
  })
  .nullish();

const createSchema = z.object({
  poNumber: z.string().default(""),
  orderDate: z.string(),
  dueDate: z.string(),
  customerId: z.string().nullish(),
  shipToLocationId: z.string().nullish(),
  billTo: addressSchema,
  shipTo: addressSchema,
  fob: z.string().default(""),
  shipVia: z.string().default(""),
  terms: z.string().default(""),
  rep: z.string().default(""),
  taxRate: z.number().default(0),
  notes: z.string().default(""),
  lineItems: z.array(lineItemSchema).default([]),
  writtenBy: z.string().nullish(),
  writtenById: z.string().nullish(),
  writtenByColor: z.string().nullish(),
});

const updateSchema = createSchema.extend({
  status: z.enum(["Entered", "Checked", "Allocated", "Backordered", "Pick & Packed", "Shipped"]),
  checkedAt: z.string().nullish(),
  checkedBy: z.string().nullish(),
  checkedByColor: z.string().nullish(),
  allocation: allocationSchema,
  labelPrintedAt: z.string().nullish(),
  pickedAt: z.string().nullish(),
  pendingShipment: z.array(shipmentLineSchema).nullish(),
  pickListPrintedAt: z.string().nullish(),
  packingSlipPrintedAt: z.string().nullish(),
  shipmentHistory: z.array(shipmentRecordSchema).default([]),
  estimatedShipDate: z.string().nullish(),
  pickPackStatus: z.enum(["Partial", "Complete"]).nullish(),
  bol: bolSchema,
});

const include = {
  lineItems: true,
  shipmentHistory: { orderBy: { shippedAt: "asc" as const } },
};

function mapOut<T extends { soNumber: number; status: string; pickPackStatus: string | null }>(order: T) {
  return {
    ...order,
    soNumber: String(order.soNumber),
    status: STATUS_OUT[order.status] ?? order.status,
    pickPackStatus: order.pickPackStatus ? (PICK_PACK_STATUS_OUT[order.pickPackStatus] ?? order.pickPackStatus) : null,
  };
}

// Orders are touched by many different pages (order entry, validation,
// allocation, pick/pack, shipping, BOL...), each gated by its own page-level
// permission client-side (see src/lib/permissions.ts) - there's no single
// page key that fits a server-side requirePermission gate here the way
// there is for items/customers/vendors/POs/returns. Before this migration
// orders were pure localStorage with no server enforcement at all; this
// keeps that same model (any authenticated account can read/write) rather
// than inventing a new authorization scheme as a side effect of moving the
// storage layer.
router.use(requireAuth);

router.get("/", async (_req, res) => {
  const orders = await prisma.salesOrder.findMany({ orderBy: { createdAt: "desc" }, include });
  res.json(orders.map(mapOut));
});

router.get("/:soNumber", async (req, res) => {
  const soNumber = parseInt(req.params.soNumber, 10);
  if (!Number.isFinite(soNumber)) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const order = await prisma.salesOrder.findUnique({ where: { soNumber }, include });
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(mapOut(order));
});

// Assigns the S.O. # itself (atomically, via the shared Counter table)
// rather than trusting one the client precomputed - same reasoning as
// vendor PO and RA numbers.
router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const order = await prisma.$transaction(async (tx) => {
    const counter = await tx.counter.upsert({
      where: { key: SO_COUNTER_KEY },
      create: { key: SO_COUNTER_KEY, value: SO_START },
      update: { value: { increment: 1 } },
    });
    return tx.salesOrder.create({
      data: {
        soNumber: counter.value,
        poNumber: data.poNumber,
        orderDate: new Date(data.orderDate),
        dueDate: new Date(data.dueDate),
        customerId: data.customerId,
        shipToLocationId: data.shipToLocationId,
        billTo: data.billTo,
        shipTo: data.shipTo,
        fob: data.fob,
        shipVia: data.shipVia,
        terms: data.terms,
        rep: data.rep,
        taxRate: data.taxRate,
        notes: data.notes,
        status: "ENTERED",
        writtenBy: data.writtenBy,
        writtenById: data.writtenById,
        writtenByColor: data.writtenByColor,
        lineItems: {
          create: data.lineItems.map((l) => ({
            item: l.item,
            description: l.description,
            um: l.um,
            ordered: l.ordered,
            rate: l.rate,
            customerPartNumber: l.customerPartNumber,
          })),
        },
      },
      include,
    });
  });
  res.status(201).json(mapOut(order));
});

router.put("/:soNumber", async (req, res) => {
  const soNumber = parseInt(req.params.soNumber, 10);
  if (!Number.isFinite(soNumber)) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;

  const existing = await prisma.salesOrder.findUnique({ where: { soNumber } });
  if (!existing) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.salesOrder.update({
      where: { soNumber },
      data: {
        poNumber: data.poNumber,
        orderDate: new Date(data.orderDate),
        dueDate: new Date(data.dueDate),
        customerId: data.customerId,
        shipToLocationId: data.shipToLocationId,
        billTo: data.billTo,
        shipTo: data.shipTo,
        fob: data.fob,
        shipVia: data.shipVia,
        terms: data.terms,
        rep: data.rep,
        taxRate: data.taxRate,
        notes: data.notes,
        status: STATUS_IN[data.status],
        writtenBy: data.writtenBy,
        writtenById: data.writtenById,
        writtenByColor: data.writtenByColor,
        checkedAt: data.checkedAt ? new Date(data.checkedAt) : data.checkedAt,
        checkedBy: data.checkedBy,
        checkedByColor: data.checkedByColor,
        allocation: data.allocation === undefined ? undefined : (data.allocation ?? Prisma.JsonNull),
        labelPrintedAt: data.labelPrintedAt ? new Date(data.labelPrintedAt) : data.labelPrintedAt,
        pickedAt: data.pickedAt ? new Date(data.pickedAt) : data.pickedAt,
        pendingShipment:
          data.pendingShipment === undefined ? undefined : (data.pendingShipment ?? Prisma.JsonNull),
        pickListPrintedAt: data.pickListPrintedAt ? new Date(data.pickListPrintedAt) : data.pickListPrintedAt,
        packingSlipPrintedAt: data.packingSlipPrintedAt
          ? new Date(data.packingSlipPrintedAt)
          : data.packingSlipPrintedAt,
        estimatedShipDate: data.estimatedShipDate ? new Date(data.estimatedShipDate) : data.estimatedShipDate,
        pickPackStatus: data.pickPackStatus ? PICK_PACK_STATUS_IN[data.pickPackStatus] : data.pickPackStatus,
        bol: data.bol === undefined ? undefined : (data.bol ?? Prisma.JsonNull),
      },
    });
    await syncChildren(tx.salesOrderLine, soNumber, "soNumber", data.lineItems, (l) => ({
      item: l.item,
      description: l.description,
      um: l.um,
      ordered: l.ordered,
      rate: l.rate,
      customerPartNumber: l.customerPartNumber,
    }));
    await syncChildren(tx.shipmentRecord, soNumber, "soNumber", data.shipmentHistory, (r) => ({
      shippedAt: new Date(r.shippedAt),
      lines: r.lines,
    }));
  });

  const updated = await prisma.salesOrder.findUnique({ where: { soNumber }, include });
  res.json(mapOut(updated!));
});

export default router;
