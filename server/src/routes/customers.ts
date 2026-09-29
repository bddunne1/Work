import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { hasPermission, requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { enqueueIfSynced } from "../integrations/sync.js";
import { logAudit } from "../lib/audit.js";
import { ConflictError, HttpError } from "../lib/conflictError.js";
import { syncChildren } from "../lib/syncChildren.js";
import { prisma } from "../prisma.js";

const router = Router();

const addressSchema = z.object({
  name: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  notes: z.string().optional(),
});

const shipToLocationSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  address: addressSchema,
});

const noteSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
});

const partMappingSchema = z.object({
  id: z.string().optional(),
  itemNumber: z.string(),
  customerPartNumber: z.string(),
});

const priceOverrideSchema = z.object({
  id: z.string().optional(),
  itemNumber: z.string(),
  customerPartNumber: z.string().default(""),
  description: z.string().default(""),
  price: z.number().finite().nonnegative(),
  pricePerFt: z.number().finite().nonnegative().nullish(),
  length: z.number().finite().nonnegative().nullish(),
  weight: z.number().finite().nonnegative().nullish(),
});

const routingGuideSchema = z
  .object({
    preferredCarrier: z.string().optional(),
    routingAccountNumber: z.string().optional(),
    appointmentRequired: z.boolean().optional(),
    labelingRequirements: z.string().optional(),
    notes: z.string().optional(),
  })
  .nullable()
  .optional();

const customerSchema = z.object({
  name: z.string().min(1),
  accountNumber: z.string().default(""),
  billTo: addressSchema,
  terms: z.string().default(""),
  shipVia: z.string().default(""),
  fob: z.string().default(""),
  rep: z.string().default(""),
  shipCompleteOnly: z.boolean().default(false),
  // Invoices for an exempt customer (a reseller with a certificate on file)
  // carry no tax whatever the order's rate says.
  taxExempt: z.boolean().default(false),
  // Inactive customers stay on file (their history references them) but are
  // not offered on new orders or returns.
  active: z.boolean().default(true),
  // .nullish() not .optional(): Prisma hands back `null` for an unset
  // nullable column, and this same object round-trips through PUT on every
  // save - .optional() alone rejects that `null` with a 400.
  privateLabelName: z.string().nullish(),
  routingGuide: routingGuideSchema,
  shipToLocations: z.array(shipToLocationSchema).default([]),
  notes: z.array(noteSchema).default([]),
  partNumberMap: z.array(partMappingSchema).default([]),
  priceOverrides: z.array(priceOverrideSchema).default([]),
});

// Required on PUT (every fetched record has one), absent on POST.
const updateSchema = customerSchema.extend({ version: z.number().int() });

const include = {
  shipToLocations: true,
  notes: { orderBy: { createdAt: "desc" as const } },
  partNumberMap: true,
  priceOverrides: true,
};

router.use(requireAuth);

// Pages that need to read customers without being "the Customers page":
// order entry and returns pick a customer, labels print ship-to addresses,
// pricing and routing guides are per-customer views.
const CUSTOMER_VIEW_PAGES = ["customers", "order-entry", "returns", "labels", "customer-pricing", "routing-guide", "import"];

router.get("/", async (req: AuthedRequest, res) => {
  const q = String(req.query.q ?? "").trim();
  // `?summary=1` skips the heavy per-customer child tables (price overrides
  // and part-number maps run to hundreds of rows on key accounts) for pages
  // that only need names/addresses - the full list is ~2 MB at 200 customers.
  // The summary (names, bill-to, ship-to) is readable by any signed-in
  // account - the Dashboard counts customers for everyone, and warehouse
  // roles need ship-to addresses - while pricing detail stays gated.
  const summary = req.query.summary === "1" || req.query.summary === "true";
  if (!summary && !CUSTOMER_VIEW_PAGES.some((key) => hasPermission(req.account!, key, "view"))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const customers = await prisma.customer.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { accountNumber: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
    include: summary ? { shipToLocations: true } : include,
  });
  res.json(customers);
});

router.get("/:id", requireAnyPermission(CUSTOMER_VIEW_PAGES, "view"), async (req, res) => {
  const customer = await prisma.customer.findUnique({ where: { id: req.params.id }, include });
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(customer);
});

router.post("/", requirePermission("customers", "edit"), async (req: AuthedRequest, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const customer = await prisma.customer.create({
    data: {
      name: data.name,
      accountNumber: data.accountNumber,
      billTo: data.billTo,
      terms: data.terms,
      shipVia: data.shipVia,
      fob: data.fob,
      rep: data.rep,
      shipCompleteOnly: data.shipCompleteOnly,
      taxExempt: data.taxExempt,
      active: data.active,
      privateLabelName: data.privateLabelName,
      routingGuide: data.routingGuide === undefined ? undefined : (data.routingGuide ?? Prisma.JsonNull),
      shipToLocations: { create: data.shipToLocations.map((l) => ({ label: l.label, address: l.address })) },
      notes: { create: data.notes.map((n) => ({ text: n.text })) },
      partNumberMap: {
        create: data.partNumberMap.map((m) => ({
          itemNumber: m.itemNumber,
          customerPartNumber: m.customerPartNumber,
        })),
      },
      priceOverrides: {
        create: data.priceOverrides.map((p) => ({
          itemNumber: p.itemNumber,
          customerPartNumber: p.customerPartNumber,
          description: p.description,
          price: p.price,
          pricePerFt: p.pricePerFt ?? null,
          length: p.length ?? null,
          weight: p.weight ?? null,
        })),
      },
    },
    include,
  });
  logAudit(req.account!, "CUSTOMER_CREATED", "customer", customer.id, customer.name);
  res.status(201).json(customer);
});

router.put("/:id", requirePermission("customers", "edit"), async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const id = req.params.id;

  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.customer.updateMany({
        where: { id, version: data.version },
        data: {
          name: data.name,
          accountNumber: data.accountNumber,
          billTo: data.billTo,
          terms: data.terms,
          shipVia: data.shipVia,
          fob: data.fob,
          rep: data.rep,
          shipCompleteOnly: data.shipCompleteOnly,
          taxExempt: data.taxExempt,
          active: data.active,
          privateLabelName: data.privateLabelName,
          routingGuide: data.routingGuide === undefined ? undefined : (data.routingGuide ?? Prisma.JsonNull),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConflictError();
      // Keep QuickBooks' copy current if it has one.
      await enqueueIfSynced(tx, "customer", id);

      await syncChildren(tx.shippingLocation, id, "customerId", data.shipToLocations, (l) => ({
        label: l.label,
        address: l.address,
      }));
      await syncChildren(tx.customerNote, id, "customerId", data.notes, (n) => ({ text: n.text }));
      await syncChildren(tx.customerPartMapping, id, "customerId", data.partNumberMap, (m) => ({
        itemNumber: m.itemNumber,
        customerPartNumber: m.customerPartNumber,
      }));
      await syncChildren(tx.customerPriceOverride, id, "customerId", data.priceOverrides, (p) => ({
        itemNumber: p.itemNumber,
        customerPartNumber: p.customerPartNumber,
        description: p.description,
        price: p.price,
        pricePerFt: p.pricePerFt ?? null,
        length: p.length ?? null,
        weight: p.weight ?? null,
      }));
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message, conflict: true });
      return;
    }
    throw err;
  }

  const updated = await prisma.customer.findUnique({ where: { id }, include });
  logAudit(req.account!, "CUSTOMER_UPDATED", "customer", id, data.name, {
    ...(existing.name !== data.name ? { renamedFrom: existing.name } : {}),
    priceOverrides: data.priceOverrides.length,
  });
  res.json(updated);
});

router.delete("/:id", requirePermission("customers", "edit"), async (req: AuthedRequest, res) => {
  // A customer with history keeps it: orders, returns, invoices and credit
  // memos all point at the row (the foreign keys are RESTRICT since sprint
  // 1). Say so, with the counts, and point at the inactive flag (R4-06).
  const id = req.params.id;
  const [orders, returns, invoices, creditMemos] = await Promise.all([
    prisma.salesOrder.count({ where: { customerId: id } }),
    prisma.returnAuthorization.count({ where: { customerId: id } }),
    prisma.invoice.count({ where: { customerId: id } }),
    prisma.creditMemo.count({ where: { customerId: id } }),
  ]);
  const history = [
    [orders, "order"],
    [returns, "return"],
    [invoices, "invoice"],
    [creditMemos, "credit memo"],
  ].filter(([n]) => Number(n) > 0) as [number, string][];
  if (history.length > 0) {
    const parts = history.map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`);
    throw new HttpError(409, `This customer has ${parts.join(", ")} on file and can't be deleted. Mark it inactive instead - it then disappears from Order Entry and Returns but its history stays.`, { conflict: true });
  }
  // A missing row is fine (already gone); anything else goes to the error
  // handler as a 409 instead of a false "deleted" 204.
  const doomed = await prisma.customer.delete({ where: { id } }).catch((err) => {
    if (err?.code === "P2025") return null;
    throw err;
  });
  if (doomed) logAudit(req.account!, "CUSTOMER_DELETED", "customer", doomed.id, doomed.name);
  res.status(204).end();
});

export default router;
