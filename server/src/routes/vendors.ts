import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { logAudit } from "../lib/audit.js";
import { ConflictError } from "../lib/conflictError.js";
import { canSeeCost } from "../lib/orderView.js";
import { prisma } from "../prisma.js";

const router = Router();

// .nullish() not .optional() on the top-level fields: Prisma hands back
// `null` for an unset nullable column, and this same object round-trips
// through PUT on every save - .optional() alone rejects that `null` with a
// 400. (addressLine2/notes inside address stay .optional() since address
// itself is one JSON blob the app always writes with those keys present,
// never a column Prisma can hand back null for individually.)
const vendorSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  address: z
    .object({
      name: z.string(),
      addressLine1: z.string(),
      addressLine2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      zip: z.string(),
      notes: z.string().optional(),
    })
    .nullish(),
  // Vendor profile (sprint 5).
  accountNumber: z.string().max(100).nullish(),
  terms: z.string().max(100).nullish(),
  leadTimeDays: z.number().int().min(0).max(3650).nullish(),
  website: z.string().max(300).nullish(),
  notes: z.string().max(5000).optional(),
  active: z.boolean().optional(),
});

const noteSchema = z.object({ text: z.string().trim().min(1).max(5000) });

const OPEN_PO_STATUSES = ["OPEN", "PARTIALLY_RECEIVED"] as const;
const CLOSED_PO_STATUSES = ["RECEIVED", "CLOSED"] as const;

router.use(requireAuth);

// The vendor profile page (sprint 5): the vendor, its open POs with the
// outstanding quantity and value, closed PO count and last PO date, the
// open balance (outstanding value on open POs, ordered less received at
// line cost), the items that prefer it with on hand, on PO and last cost,
// and its notes. Values are left out for an account that may not see cost.
router.get("/:id/profile", requirePermission("vendors", "view"), async (req: AuthedRequest, res) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id }, include: { vendorNotes: { orderBy: { createdAt: "desc" } } } });
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  const showCost = canSeeCost(req.account!);
  const [openPos, closedPoCount, lastPo, items] = await Promise.all([
    prisma.vendorPurchaseOrder.findMany({ where: { vendorId: vendor.id, status: { in: [...OPEN_PO_STATUSES] } }, orderBy: [{ expectedDate: { sort: "asc", nulls: "last" } }, { orderDate: "asc" }], include: { lines: true } }),
    prisma.vendorPurchaseOrder.count({ where: { vendorId: vendor.id, status: { in: [...CLOSED_PO_STATUSES] } } }),
    prisma.vendorPurchaseOrder.findFirst({ where: { vendorId: vendor.id }, orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }], select: { orderDate: true, poNumber: true } }),
    prisma.item.findMany({ where: { preferredVendorId: vendor.id }, orderBy: { itemNumber: "asc" }, select: { id: true, itemNumber: true, description: true, qtyOnHand: true, qtyOnPurchaseOrder: true, qtyReserved: true, cost: true } }),
  ]);
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const poRows = openPos.map((po) => {
    let outstandingQty = 0;
    let outstandingValue = 0;
    for (const l of po.lines) {
      const out = Math.max(0, l.orderedQty - l.receivedQty);
      outstandingQty += out;
      outstandingValue += out * Number(l.cost);
    }
    return {
      poNumber: po.poNumber,
      orderDate: day(po.orderDate),
      expectedDate: day(po.expectedDate),
      status: po.status === "OPEN" ? "Open" : "Partially Received",
      lines: po.lines.length,
      outstandingQty,
      outstandingValue: showCost ? Math.round(outstandingValue * 100) / 100 : null,
    };
  });
  const openBalance = poRows.reduce((sum, r) => sum + (r.outstandingValue ?? 0), 0);
  const { vendorNotes, ...rest } = vendor;
  res.json({
    vendor: rest,
    openPos: poRows,
    closedPoCount,
    lastPoDate: day(lastPo?.orderDate),
    lastPoNumber: lastPo?.poNumber ?? null,
    openBalance: showCost ? Math.round(openBalance * 100) / 100 : null,
    items: items.map((i) => ({ ...i, cost: showCost ? (i.cost === null ? null : Number(i.cost)) : undefined })),
    notes: vendorNotes,
  });
});

// Dated notes, saved to VendorNote (not the free-text field) with who wrote them.
router.post("/:id/notes", requirePermission("vendors", "edit"), async (req: AuthedRequest, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  const note = await prisma.vendorNote.create({ data: { vendorId: vendor.id, text: parsed.data.text, author: req.account!.username } });
  logAudit(req.account!, "VENDOR_NOTE_ADDED", "vendor", vendor.id, vendor.name, { noteId: note.id });
  res.status(201).json(note);
});

router.delete("/:id/notes/:noteId", requirePermission("vendors", "edit"), async (req: AuthedRequest, res) => {
  const gone = await prisma.vendorNote.deleteMany({ where: { id: req.params.noteId, vendorId: req.params.id } });
  if (gone.count > 0) logAudit(req.account!, "VENDOR_NOTE_DELETED", "vendor", req.params.id, null, { noteId: req.params.noteId });
  res.status(204).end();
});

router.get("/", requirePermission("vendors", "view"), async (_req, res) => {
  const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
  res.json(vendors);
});

router.post("/", requirePermission("vendors", "edit"), async (req: AuthedRequest, res) => {
  const parsed = vendorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { address, ...rest } = parsed.data;
  const vendor = await prisma.vendor.create({ data: { ...rest, address: address ?? Prisma.JsonNull } });
  logAudit(req.account!, "VENDOR_CREATED", "vendor", vendor.id, vendor.name);
  res.status(201).json(vendor);
});

// version required even though every other field stays optional (this
// endpoint is technically partial-update, though the frontend always sends
// the whole fetched record) - there's no prior version to compare a field
// that's genuinely absent against, so the check would be meaningless there.
router.put("/:id", requirePermission("vendors", "edit"), async (req: AuthedRequest, res) => {
  const parsed = vendorSchema.partial().extend({ version: z.number().int() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { address, version, ...rest } = parsed.data;

  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  const result = await prisma.vendor.updateMany({
    where: { id: req.params.id, version },
    data: { ...rest, address: address === undefined ? undefined : (address ?? Prisma.JsonNull), version: { increment: 1 } },
  });
  if (result.count === 0) {
    res.status(409).json({ error: new ConflictError().message, conflict: true });
    return;
  }

  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (vendor) logAudit(req.account!, "VENDOR_UPDATED", "vendor", vendor.id, vendor.name);
  res.json(vendor);
});

router.delete("/:id", requirePermission("vendors", "edit"), async (req: AuthedRequest, res) => {
  // A missing row is fine (already gone); anything else - notably a
  // foreign-key violation because orders/POs still reference it - goes to
  // the error handler as a 409 instead of a false "deleted" 204.
  const doomed = await prisma.vendor.delete({ where: { id: req.params.id } }).catch((err) => {
    if (err?.code === "P2025") return null;
    throw err;
  });
  if (doomed) logAudit(req.account!, "VENDOR_DELETED", "vendor", doomed.id, doomed.name);
  res.status(204).end();
});

export default router;
